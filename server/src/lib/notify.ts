import webpush from 'web-push';
import { q, one } from './db.js';
import { config } from './config.js';
import { render } from './i18n.js';

export const pushConfigured = Boolean(config.vapidPublic && config.vapidPrivate);
if (pushConfigured) webpush.setVapidDetails(config.vapidSubject, config.vapidPublic, config.vapidPrivate);

/** Set by the Discord module once the bot is logged in. */
type DiscordSender = (target: { channelId?: string; userId?: string }, text: string) => Promise<void>;
let discordSender: DiscordSender | null = null;
export const setDiscordSender = (fn: DiscordSender | null) => { discordSender = fn; };
export const discordReady = () => discordSender !== null;

export interface Message {
  kind: string; title?: string; body?: string; link?: string; eventId?: number | null;
  /** Template key + params: rendered in each recipient's language (see lib/i18n.ts) */
  tkey?: string; params?: Record<string, string | number>;
  /** Prevents duplicates, e.g. "reminder:12" → one reminder per user per event */
  dedupe?: string; scheduledFor?: Date;
}

/** Users who should hear about something in a scope (kingdom = everyone, alliance = members). */
export async function audienceFor(scope: 'kingdom' | 'alliance', allianceId: number | null): Promise<number[]> {
  const rows = scope === 'kingdom'
    ? await q<{ id: number }>('SELECT id FROM users WHERE deleted_at IS NULL')
    : await q<{ id: number }>(
      `SELECT u.id FROM users u JOIN alliance_members am ON am.user_id = u.id
        WHERE am.alliance_id = $1 AND u.deleted_at IS NULL`, [allianceId]);
  return rows.map((r) => r.id);
}

/** Queue a message on every channel each user has switched on. */
export async function notifyUsers(userIds: number[], m: Message) {
  if (!userIds.length) return;
  const users = await q<{ id: number; language: string; notify_site: boolean; notify_push: boolean; notify_discord: boolean; discord_user_id: string | null }>(
    `SELECT id, language, notify_site, notify_push, notify_discord, discord_user_id FROM users
      WHERE id = ANY($1) AND deleted_at IS NULL`, [userIds],
  );
  for (const u of users) {
    const text = textFor(m, u.language);
    const channels: ('site' | 'push' | 'discord')[] = [];
    if (u.notify_site) channels.push('site');
    if (u.notify_push) channels.push('push');
    if (u.notify_discord && u.discord_user_id) channels.push('discord');
    for (const ch of channels) {
      await q(
        `INSERT INTO notifications (user_id, channel, kind, title, body, link, event_id, dedupe_key, status, sent_at, scheduled_for)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [u.id, ch, m.kind, text.title, text.body, m.link ?? null, m.eventId ?? null,
          m.dedupe ? `${m.dedupe}:${ch}:${u.id}` : null,
          ch === 'site' ? 'sent' : 'pending', ch === 'site' ? new Date() : null, m.scheduledFor ?? new Date()],
      );
    }
  }
}

function textFor(m: Message, lang: string) {
  const r = m.tkey ? render(lang, m.tkey, m.params) : null;
  return { title: r?.title ?? m.title ?? '', body: r?.body ?? m.body ?? '' };
}

/** Queue a post to the configured Discord announcement channel (if any). Channel posts use English. */
export async function notifyDiscordChannel(m: Message) {
  const s = await one<{ value: { channel_id?: string; enabled?: boolean } }>(
    `SELECT value FROM integration_settings WHERE key = 'discord'`,
  );
  if (!s?.value?.enabled || !s.value.channel_id) return;
  await q(
    `INSERT INTO notifications (user_id, channel, kind, title, body, link, event_id, dedupe_key, scheduled_for)
     VALUES (NULL,'discord',$1,$2,$3,$4,$5,$6,$7) ON CONFLICT (dedupe_key) DO NOTHING`,
    [m.kind, textFor(m, 'en').title, textFor(m, 'en').body, m.link ?? null, m.eventId ?? null,
      m.dedupe ? `${m.dedupe}:channel` : null, m.scheduledFor ?? new Date()],
  );
}

/** Deliver due push/Discord notifications. Failures are recorded, never hidden. */
export async function deliverPending() {
  const due = await q<any>(
    `SELECT n.*, u.discord_user_id FROM notifications n LEFT JOIN users u ON u.id = n.user_id
      WHERE n.status = 'pending' AND n.scheduled_for <= now() ORDER BY n.id LIMIT 100`,
  );
  const settings = await one<{ value: { channel_id?: string } }>(`SELECT value FROM integration_settings WHERE key = 'discord'`);
  for (const n of due) {
    try {
      const text = `**${n.title}**${n.body ? `\n${n.body}` : ''}${n.link ? `\n${config.appUrl}${n.link}` : ''}`;
      if (n.channel === 'push') {
        if (!pushConfigured) throw new Error('Browser push is not configured on the server.');
        const subs = await q<{ id: number; endpoint: string; keys: any }>(
          'SELECT id, endpoint, keys FROM push_subscriptions WHERE user_id = $1', [n.user_id]);
        if (!subs.length) throw new Error('No browser has allowed notifications for this account.');
        let delivered = 0;
        for (const s of subs) {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys },
              JSON.stringify({ title: n.title, body: n.body, link: n.link }));
            delivered++;
          } catch (e: any) {
            if (e?.statusCode === 404 || e?.statusCode === 410) await q('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
          }
        }
        if (!delivered) throw new Error('Every browser subscription rejected the message.');
      } else if (n.channel === 'discord') {
        if (!discordSender) throw new Error('Discord bot is not connected.');
        if (n.user_id) {
          if (!n.discord_user_id) throw new Error('Member has not linked Discord.');
          await discordSender({ userId: n.discord_user_id }, text);
        } else {
          if (!settings?.value?.channel_id) throw new Error('No Discord channel is configured.');
          await discordSender({ channelId: settings.value.channel_id }, text);
        }
      }
      await q(`UPDATE notifications SET status = 'sent', sent_at = now(), error = NULL WHERE id = $1`, [n.id]);
    } catch (e: any) {
      await q(`UPDATE notifications SET status = 'failed', error = $2 WHERE id = $1`, [n.id, String(e?.message ?? e).slice(0, 500)]);
    }
  }
  return due.length;
}
