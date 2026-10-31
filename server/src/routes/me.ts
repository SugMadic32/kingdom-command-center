import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { q, one, tx } from '../lib/db.js';
import { h, bad, intParam, notFound } from '../lib/http.js';
import { requireAuth, randomToken, destroySession } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { toCsv } from '../lib/csv.js';
import { validTimeZone } from './auth.js';
import { config } from '../lib/config.js';
import { pushConfigured } from '../lib/notify.js';
import { emailConfigured } from '../lib/email.js';
import { saveInventory, saveBuildings, inventorySchema, buildingsSchema } from '../lib/memberData.js';

export const meRouter = Router();
meRouter.use(requireAuth);

// ---------- Profile & preferences ----------
meRouter.get('/profile', h(async (req, res) => {
  const p = await one(
    `SELECT id, email, display_name, ingame_name, time_zone, language, share_inventory, share_buildings,
            notify_site, notify_push, notify_discord, notify_email, reminder_minutes, discord_user_id IS NOT NULL AS discord_linked
       FROM users WHERE id = $1`, [req.user!.id]);
  res.json({ profile: p, push_public_key: pushConfigured ? config.vapidPublic : null, email_configured: emailConfigured() });
}));

meRouter.patch('/profile', h(async (req, res) => {
  const b = z.object({
    display_name: z.string().trim().min(2).max(40),
    ingame_name: z.string().trim().max(40).nullable(),
    time_zone: z.string().max(60),
    language: z.enum(['en', 'ko', 'fr', 'id']),
    share_inventory: z.boolean(),
    share_buildings: z.boolean(),
    notify_site: z.boolean(),
    notify_push: z.boolean(),
    notify_discord: z.boolean(),
    notify_email: z.boolean(),
    reminder_minutes: z.number().int().min(5).max(1440),
  }).partial().parse(req.body);
  if (b.time_zone && !validTimeZone(b.time_zone)) throw bad('time_zone: unknown time zone');
  const keys = Object.keys(b);
  if (!keys.length) return res.json({ ok: true });
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  await q(`UPDATE users SET ${sets} WHERE id = $1`, [req.user!.id, ...keys.map((k) => (b as any)[k])]);
  if (b.notify_email !== undefined) await q('UPDATE users SET notify_email_user_choice = $2 WHERE id = $1', [req.user!.id, b.notify_email]);
  res.json({ ok: true });
}));

// ---------- Inventory ----------
meRouter.get('/inventory', h(async (req, res) => {
  const rows = await q(
    `SELECT r.key, r.name, r.kind, r.deferred, r.verified, COALESCE(mi.amount, 0) AS amount, mi.updated_at
       FROM resource_types r LEFT JOIN member_inventory mi ON mi.resource_key = r.key AND mi.user_id = $1
      ORDER BY r.sort`, [req.user!.id]);
  res.json({ inventory: rows });
}));

meRouter.put('/inventory', h(async (req, res) => {
  await saveInventory(req.user!.id, inventorySchema.parse(req.body), req.user!.id);
  res.json({ ok: true });
}));

// ---------- Building levels ----------
meRouter.get('/buildings', h(async (req, res) => {
  const rows = await q(
    `SELECT b.id, b.key, b.name, b.max_level, COALESCE(mb.level, 0) AS level, COALESCE(mb.notes,'') AS notes, mb.updated_at
       FROM game_buildings b LEFT JOIN member_buildings mb ON mb.building_id = b.id AND mb.user_id = $1
      ORDER BY b.name`, [req.user!.id]);
  res.json({ buildings: rows });
}));

meRouter.put('/buildings', h(async (req, res) => {
  await saveBuildings(req.user!.id, buildingsSchema.parse(req.body), req.user!.id);
  res.json({ ok: true });
}));

// ---------- Goals ----------
meRouter.get('/goals', h(async (req, res) => {
  res.json({ goals: await q('SELECT * FROM goals WHERE user_id = $1 ORDER BY done, due_date NULLS LAST, id', [req.user!.id]) });
}));
meRouter.post('/goals', h(async (req, res) => {
  const b = z.object({ title: z.string().trim().min(1).max(200), due_date: z.string().date().nullable().optional() }).parse(req.body);
  const g = await one('INSERT INTO goals (user_id, title, due_date) VALUES ($1,$2,$3) RETURNING *', [req.user!.id, b.title, b.due_date ?? null]);
  res.status(201).json({ goal: g });
}));
meRouter.patch('/goals/:id', h(async (req, res) => {
  const b = z.object({ done: z.boolean().optional(), title: z.string().trim().min(1).max(200).optional() }).parse(req.body);
  const g = await one(
    `UPDATE goals SET done = COALESCE($3, done), title = COALESCE($4, title) WHERE id = $1 AND user_id = $2 RETURNING *`,
    [intParam(req.params.id), req.user!.id, b.done ?? null, b.title ?? null]);
  if (!g) throw notFound('Goal');
  res.json({ goal: g });
}));
meRouter.delete('/goals/:id', h(async (req, res) => {
  await q('DELETE FROM goals WHERE id = $1 AND user_id = $2', [intParam(req.params.id), req.user!.id]);
  res.json({ ok: true });
}));

// ---------- Notifications ----------
meRouter.get('/notifications', h(async (req, res) => {
  const rows = await q(
    `SELECT id, kind, title, body, link, event_id, read_at, created_at FROM notifications
      WHERE user_id = $1 AND channel = 'site' ORDER BY created_at DESC LIMIT 100`, [req.user!.id]);
  const unread = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND channel = 'site' AND read_at IS NULL`, [req.user!.id]);
  res.json({ notifications: rows, unread: unread?.n ?? 0 });
}));
meRouter.post('/notifications/read', h(async (req, res) => {
  const b = z.object({ ids: z.array(z.number().int()).max(500).optional() }).parse(req.body ?? {});
  if (b.ids?.length) {
    await q(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL`, [req.user!.id, b.ids]);
  } else {
    await q(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [req.user!.id]);
  }
  res.json({ ok: true });
}));

// ---------- Browser push ----------
meRouter.post('/push/subscribe', h(async (req, res) => {
  if (!pushConfigured) throw bad('Browser notifications are not set up on this server yet.');
  const b = z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(200) }),
  }).parse(req.body);
  await q(
    `INSERT INTO push_subscriptions (user_id, endpoint, keys) VALUES ($1,$2,$3)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, keys = EXCLUDED.keys`,
    [req.user!.id, b.endpoint, b.keys]);
  await q('UPDATE users SET notify_push = TRUE WHERE id = $1', [req.user!.id]);
  res.json({ ok: true });
}));
meRouter.post('/push/unsubscribe', h(async (req, res) => {
  await q('DELETE FROM push_subscriptions WHERE user_id = $1', [req.user!.id]);
  await q('UPDATE users SET notify_push = FALSE WHERE id = $1', [req.user!.id]);
  res.json({ ok: true });
}));

// ---------- Discord account link ----------
meRouter.post('/discord/link-code', h(async (req, res) => {
  const code = randomToken(6).replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase().padEnd(8, 'X');
  await q(`UPDATE users SET discord_link_code = $2, discord_link_expires = now() + interval '15 minutes' WHERE id = $1`,
    [req.user!.id, code]);
  res.json({ code, expires_in_minutes: 15 });
}));
meRouter.post('/discord/unlink', h(async (req, res) => {
  await q('UPDATE users SET discord_user_id = NULL, notify_discord = FALSE WHERE id = $1', [req.user!.id]);
  res.json({ ok: true });
}));

// ---------- Data export & account deletion ----------
meRouter.get('/export.json', h(async (req, res) => {
  const id = req.user!.id;
  const data = {
    exported_at: new Date().toISOString(),
    profile: await one(`SELECT email, display_name, ingame_name, time_zone, language, created_at FROM users WHERE id = $1`, [id]),
    inventory: await q('SELECT resource_key, amount, updated_at FROM member_inventory WHERE user_id = $1', [id]),
    buildings: await q(`SELECT b.name, mb.level, mb.notes FROM member_buildings mb JOIN game_buildings b ON b.id = mb.building_id WHERE mb.user_id = $1`, [id]),
    plans: await q('SELECT name, items, assumptions, dataset_version_id, result, created_at FROM upgrade_plans WHERE owner_id = $1', [id]),
    goals: await q('SELECT title, due_date, done FROM goals WHERE user_id = $1', [id]),
    availability: await q('SELECT event_id, slot_id, submitted_at FROM availability WHERE user_id = $1', [id]),
  };
  res.setHeader('Content-Disposition', 'attachment; filename="my-kingdom-data.json"');
  res.json(data);
}));

meRouter.get('/inventory.csv', h(async (req, res) => {
  const rows = await q<{ name: string; amount: number }>(
    `SELECT r.name || CASE WHEN r.kind = 'speedup' THEN ' (minutes)' ELSE '' END AS name, COALESCE(mi.amount,0) AS amount FROM resource_types r
       LEFT JOIN member_inventory mi ON mi.resource_key = r.key AND mi.user_id = $1 ORDER BY r.sort`, [req.user!.id]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="inventory.csv"');
  res.send(toCsv([['Resource', 'Amount'], ...rows.map((r) => [r.name, r.amount])]));
}));

meRouter.post('/delete-account', h(async (req, res) => {
  const b = z.object({ password: z.string().max(200), confirm: z.literal('DELETE') }).parse(req.body);
  const u = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [req.user!.id]);
  if (!u || !(await bcrypt.compare(b.password, u.password_hash))) throw bad('Password is incorrect.');
  const id = req.user!.id;
  const admins = await one<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE kingdom_role = 'admin' AND deleted_at IS NULL`);
  if (req.user!.kingdom_role === 'admin' && (admins?.n ?? 0) <= 1) {
    throw bad('Transfer the admin role to another member before deleting the only admin account.');
  }
  await tx(async (c) => {
    for (const t of ['member_inventory', 'member_buildings', 'goals', 'availability', 'attendance', 'push_subscriptions',
      'user_permissions', 'alliance_members', 'member_checklist', 'notifications', 'sessions']) {
      await c.query(`DELETE FROM ${t} WHERE user_id = $1`, [id]);
    }
    await c.query('DELETE FROM upgrade_plans WHERE owner_id = $1', [id]);
    // Keep the row so audit history stays readable, but remove personal details
    await c.query(
      `UPDATE users SET email = NULL, password_hash = NULL, display_name = 'Deleted member', ingame_name = NULL,
              discord_user_id = NULL, kingdom_role = 'member', deleted_at = now() WHERE id = $1`, [id]);
  });
  await audit(id, 'delete_account', 'user', id);
  await destroySession(req, res);
  res.json({ ok: true });
}));
