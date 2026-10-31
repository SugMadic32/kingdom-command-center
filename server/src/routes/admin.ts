import { Router } from 'express';
import { z } from 'zod';
import { q, one } from '../lib/db.js';
import { h, bad, intParam, notFound, forbidden } from '../lib/http.js';
import { requireAuth, requireAdmin, requirePerm, randomToken, sha256, isAdmin, isAllianceLeader } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { config } from '../lib/config.js';
import { discordReady, pushConfigured } from '../lib/notify.js';
import { emailInfo, sendEmail, emailHtml } from '../lib/email.js';

export const adminRouter = Router();
adminRouter.use(requireAuth);

const PERMS = ['event_manager', 'data_curator', 'alliance_manager', 'announcement_manager', 'integration_manager', 'appointment_manager'] as const;

adminRouter.get('/users', requireAdmin, h(async (req, res) => {
  const term = `%${String(req.query.q ?? '').slice(0, 60)}%`;
  res.json({ users: await q(
    `SELECT u.id, u.email, u.display_name, u.ingame_name, u.kingdom_role, u.created_at, u.notify_email, u.notify_email_user_choice,
            COALESCE(ARRAY(SELECT permission FROM user_permissions p WHERE p.user_id = u.id ORDER BY permission), '{}') AS permissions,
            a.tag AS alliance_tag, am.rank
       FROM users u LEFT JOIN alliance_members am ON am.user_id = u.id LEFT JOIN alliances a ON a.id = am.alliance_id
      WHERE u.deleted_at IS NULL AND (u.display_name ILIKE $1 OR u.ingame_name ILIKE $1 OR u.email ILIKE $1)
      ORDER BY u.kingdom_role = 'admin' DESC, u.kingdom_role = 'officer' DESC, u.display_name LIMIT 200`, [term]) });
}));

adminRouter.patch('/users/:id/role', requireAdmin, h(async (req, res) => {
  const id = intParam(req.params.id);
  const { role } = z.object({ role: z.enum(['member', 'officer', 'admin']) }).parse(req.body);
  const u = await one<{ kingdom_role: string }>('SELECT kingdom_role FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!u) throw notFound('Member');
  if (u.kingdom_role === 'admin' && role !== 'admin') {
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE kingdom_role = 'admin' AND deleted_at IS NULL`);
    if ((n?.n ?? 0) <= 1) throw bad('The kingdom needs at least one admin.');
  }
  await q('UPDATE users SET kingdom_role = $2 WHERE id = $1', [id, role]);
  if (role === 'member') await q('DELETE FROM user_permissions WHERE user_id = $1', [id]);
  await audit(req.user!.id, 'set_role', 'user', id, { from: u.kingdom_role, to: role });
  res.json({ ok: true });
}));

adminRouter.put('/users/:id/permissions', requireAdmin, h(async (req, res) => {
  const id = intParam(req.params.id);
  const { permissions } = z.object({ permissions: z.array(z.enum(PERMS)).max(PERMS.length) }).parse(req.body);
  const u = await one<{ kingdom_role: string }>('SELECT kingdom_role FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!u) throw notFound('Member');
  if (u.kingdom_role === 'member' && permissions.length) throw bad('Make this player an officer before granting permissions.');
  const before = (await q<{ permission: string }>('SELECT permission FROM user_permissions WHERE user_id = $1', [id])).map((r) => r.permission);
  await q('DELETE FROM user_permissions WHERE user_id = $1', [id]);
  for (const p of permissions) await q('INSERT INTO user_permissions (user_id, permission, granted_by) VALUES ($1,$2,$3)', [id, p, req.user!.id]);
  await audit(req.user!.id, 'set_permissions', 'user', id, { before, after: permissions });
  res.json({ ok: true });
}));

/** Account recovery without email infrastructure: the admin hands the link to the player privately. */
adminRouter.post('/users/:id/reset-link', requireAdmin, h(async (req, res) => {
  const id = intParam(req.params.id);
  if (!(await one('SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL', [id]))) throw notFound('Member');
  const token = randomToken();
  await q(`INSERT INTO password_resets (token_hash, user_id, created_by, expires_at) VALUES ($1,$2,$3, now() + interval '24 hours')`,
    [sha256(token), id, req.user!.id]);
  await audit(req.user!.id, 'issue_reset_link', 'user', id);
  res.json({ url: `${config.appUrl}/reset-password?token=${token}`, expires_in_hours: 24 });
}));

// ---------- Kingdom settings ----------
adminRouter.get('/kingdom-settings', requireAdmin, h(async (_req, res) => {
  const s = await one<{ value: any }>(`SELECT value FROM integration_settings WHERE key = 'kingdom'`);
  res.json({ share_default: s?.value?.share_default !== false, email_default: s?.value?.email_default !== false });
}));
adminRouter.put('/kingdom-settings', requireAdmin, h(async (req, res) => {
  const b = z.object({ share_default: z.boolean(), email_default: z.boolean() }).partial().parse(req.body);
  await q(`INSERT INTO integration_settings (key, value, updated_by) VALUES ('kingdom',$1,$2)
           ON CONFLICT (key) DO UPDATE SET value = integration_settings.value || EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, [b, req.user!.id]);
  await audit(req.user!.id, 'update', 'integration', 'kingdom', b);
  res.json({ ok: true });
}));

// ---------- Email on/off for members (a member's own "off" is always respected) ----------
adminRouter.put('/users/:id/notify-email', requireAdmin, h(async (req, res) => {
  const id = intParam(req.params.id);
  const { on } = z.object({ on: z.boolean() }).parse(req.body);
  const u = await one<{ email: string | null; notify_email_user_choice: boolean | null }>('SELECT email, notify_email_user_choice FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!u) throw notFound('Member');
  if (on && u.notify_email_user_choice === false) throw bad('This member turned email off themselves. Only they can turn it back on.');
  if (on && !u.email) throw bad('This member has no email address.');
  await q('UPDATE users SET notify_email = $2 WHERE id = $1', [id, on]);
  await audit(req.user!.id, on ? 'email_on' : 'email_off', 'user', id);
  res.json({ ok: true });
}));

adminRouter.post('/notify-email/all', requireAdmin, h(async (req, res) => {
  const { on } = z.object({ on: z.boolean() }).parse(req.body);
  const changed = on
    ? await q(`UPDATE users SET notify_email = TRUE WHERE deleted_at IS NULL AND email IS NOT NULL AND notify_email = FALSE
                 AND notify_email_user_choice IS DISTINCT FROM FALSE RETURNING id`)
    : await q(`UPDATE users SET notify_email = FALSE WHERE deleted_at IS NULL AND notify_email = TRUE RETURNING id`);
  const skipped = on ? (await one<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE deleted_at IS NULL AND notify_email_user_choice = FALSE`))?.n ?? 0 : 0;
  await audit(req.user!.id, on ? 'email_on_all' : 'email_off_all', 'user', null, { changed: changed.length, skipped });
  res.json({ changed: changed.length, skipped });
}));

// ---------- Integrations ----------
adminRouter.get('/integrations', requirePerm('integration_manager'), h(async (_req, res) => {
  const discord = await one(`SELECT value, updated_at FROM integration_settings WHERE key = 'discord'`);
  res.json({
    discord: {
      settings: discord?.value ?? { enabled: false, channel_id: '' },
      token_present: Boolean(config.discordToken),   // never the token itself
      app_id_present: Boolean(config.discordAppId),
      guild_id: config.discordGuildId || null,
      connected: discordReady(),
    },
    push: { configured: pushConfigured },
    email: emailInfo(),
  });
}));

adminRouter.put('/integrations/discord', requirePerm('integration_manager'), h(async (req, res) => {
  const b = z.object({ enabled: z.boolean(), channel_id: z.string().regex(/^\d{0,25}$/, 'must be a numeric Discord channel ID') }).parse(req.body);
  if (b.enabled && !b.channel_id) throw bad('Add the announcement channel ID before turning Discord posts on.');
  await q(`INSERT INTO integration_settings (key, value, updated_by) VALUES ('discord',$1,$2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [b, req.user!.id]);
  await audit(req.user!.id, 'update', 'integration', 'discord', b);
  res.json({ ok: true });
}));

adminRouter.post('/integrations/email-test', requirePerm('integration_manager'), h(async (req, res) => {
  const me = await one<{ email: string | null }>('SELECT email FROM users WHERE id = $1', [req.user!.id]);
  if (!me?.email) throw bad('Your account has no email address.');
  try {
    await sendEmail(me.email, 'Test email from Kingdom Command Center', 'If you can read this, email notifications work.',
      emailHtml('Test email', 'If you can read this, email notifications work.', config.appUrl, 'Open the Command Center', 'Sent from Admin console › Integrations.'));
  } catch (e: any) { throw bad(String(e?.message ?? e)); }
  res.json({ ok: true, to: me.email });
}));

adminRouter.get('/deliveries', requirePerm('integration_manager'), h(async (req, res) => {
  const status = ['pending', 'sent', 'failed', 'skipped'].includes(String(req.query.status)) ? String(req.query.status) : null;
  res.json({ deliveries: await q(
    `SELECT n.id, n.channel, n.kind, n.title, n.status, n.error, n.scheduled_for, n.sent_at, u.display_name AS recipient
       FROM notifications n LEFT JOIN users u ON u.id = n.user_id
      WHERE n.channel <> 'site' AND ($1::text IS NULL OR n.status = $1)
      ORDER BY n.id DESC LIMIT 200`, [status]) });
}));

adminRouter.post('/deliveries/:id/retry', requirePerm('integration_manager'), h(async (req, res) => {
  await q(`UPDATE notifications SET status = 'pending', error = NULL, scheduled_for = now() WHERE id = $1 AND status = 'failed'`,
    [intParam(req.params.id)]);
  res.json({ ok: true });
}));

// ---------- Audit history ----------
/** Admins see everything; alliance R4/R5 see their own alliance's log. */
adminRouter.get('/audit', h(async (req, res) => {
  const u = req.user!;
  const allianceOnly = !isAdmin(u);
  if (allianceOnly && !(u.alliance_id && isAllianceLeader(u, u.alliance_id))) throw forbidden();
  const before = req.query.before ? Number(req.query.before) : null;
  const type = req.query.type ? String(req.query.type).slice(0, 40) : null;
  const rows = await q(
    `SELECT a.*, u.display_name AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE ($1::bigint IS NULL OR a.id < $1) AND ($2::text IS NULL OR a.record_type = $2)
        AND ($3::int IS NULL OR a.alliance_id = $3)
      ORDER BY a.id DESC LIMIT 100`, [before, type, allianceOnly ? u.alliance_id : null]);
  res.json({ logs: rows, scope: allianceOnly ? 'alliance' : 'kingdom' });
}));
