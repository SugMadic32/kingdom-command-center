import { Router } from 'express';
import { z } from 'zod';
import { q, one } from '../lib/db.js';
import { h, bad, intParam, notFound } from '../lib/http.js';
import { requireAuth, requirePerm, has, canManageAlliance, assert, type SessionUser } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { audienceFor, notifyUsers, notifyDiscordChannel } from '../lib/notify.js';

export const kingdomRouter = Router();
kingdomRouter.use(requireAuth);

// ---------- Overview ----------
kingdomRouter.get('/overview', h(async (req, res) => {
  const u = req.user!;
  const announcements = await q(
    `SELECT a.*, u.display_name AS author, al.tag AS alliance_tag FROM announcements a
       LEFT JOIN users u ON u.id = a.created_by LEFT JOIN alliances al ON al.id = a.alliance_id
      WHERE a.scope = 'kingdom' OR a.alliance_id = $1 ORDER BY a.pinned DESC, a.created_at DESC LIMIT 6`, [u.alliance_id]);
  const events = await q(
    `SELECT e.id, e.title, e.type, e.scope, e.starts_at, e.duration_minutes, al.tag AS alliance_tag FROM events e
       LEFT JOIN alliances al ON al.id = e.alliance_id
      WHERE e.status = 'published' AND e.starts_at > now() - interval '2 hours'
        AND (e.scope = 'kingdom' OR e.alliance_id = $1) ORDER BY e.starts_at LIMIT 8`, [u.alliance_id]);
  const season = await one(`SELECT * FROM kvk_seasons WHERE ends_at IS NULL OR ends_at > now() ORDER BY starts_at LIMIT 1`);
  const phases = season ? await q('SELECT * FROM kvk_phases WHERE season_id = $1 ORDER BY starts_at', [season.id]) : [];
  // Aggregates only: counts, never individual inventories.
  const stats = await one(
    `SELECT (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) AS players,
            (SELECT count(*)::int FROM alliances) AS alliances,
            (SELECT count(*)::int FROM upgrade_plans) AS plans,
            (SELECT count(*)::int FROM events WHERE status = 'published' AND starts_at > now()) AS upcoming_events`);
  const alliances = await q(
    `SELECT a.id, a.tag, a.name, count(am.user_id)::int AS member_count FROM alliances a
       LEFT JOIN alliance_members am ON am.alliance_id = a.id GROUP BY a.id ORDER BY member_count DESC, a.tag LIMIT 12`);
  const checklist = season ? await q(
    `SELECT a.tag, round(100.0 * count(mc.item_id) FILTER (WHERE mc.done) /
              NULLIF(count(DISTINCT am.user_id) * (SELECT count(*) FROM kvk_checklist_items WHERE season_id = $1), 0))::int AS pct
       FROM alliances a JOIN alliance_members am ON am.alliance_id = a.id
       LEFT JOIN member_checklist mc ON mc.user_id = am.user_id
             AND mc.item_id IN (SELECT id FROM kvk_checklist_items WHERE season_id = $1)
      GROUP BY a.id ORDER BY a.tag`, [season.id]) : [];
  res.json({ announcements, events, season, phases, stats, alliances, checklist });
}));

// ---------- Announcements ----------
function canPost(u: SessionUser, scope: string, allianceId: number | null) {
  if (scope === 'kingdom') return has(u, 'announcement_manager');
  return allianceId != null && (canManageAlliance(u, allianceId) || has(u, 'announcement_manager'));
}

kingdomRouter.get('/announcements', h(async (req, res) => {
  const allianceId = req.query.alliance_id ? intParam(String(req.query.alliance_id)) : null;
  const rows = await q(
    `SELECT a.*, u.display_name AS author, al.tag AS alliance_tag FROM announcements a
       LEFT JOIN users u ON u.id = a.created_by LEFT JOIN alliances al ON al.id = a.alliance_id
      WHERE ($1::int IS NULL AND (a.scope = 'kingdom' OR a.alliance_id = $2)) OR ($1::int IS NOT NULL AND a.alliance_id = $1)
      ORDER BY a.pinned DESC, a.created_at DESC LIMIT 100`, [allianceId, req.user!.alliance_id]);
  res.json({
    announcements: rows.map((a) => ({ ...a, can_edit: canPost(req.user!, a.scope, a.alliance_id) })),
    can_post_kingdom: has(req.user!, 'announcement_manager'),
  });
}));

kingdomRouter.post('/announcements', h(async (req, res) => {
  const u = req.user!;
  const b = z.object({
    scope: z.enum(['kingdom', 'alliance']), alliance_id: z.number().int().positive().nullable().default(null),
    title: z.string().trim().min(2).max(120), body: z.string().trim().min(1).max(8000), pinned: z.boolean().default(false),
    notify: z.boolean().default(true),
  }).parse(req.body);
  if (b.scope === 'kingdom') b.alliance_id = null;
  else if (!b.alliance_id) b.alliance_id = u.alliance_id;
  assert(canPost(u, b.scope, b.alliance_id), b.scope === 'kingdom'
    ? 'Only authorised officers can publish kingdom announcements.' : 'Only R4/R5 can post alliance announcements.');
  const a = await one(
    `INSERT INTO announcements (scope, alliance_id, title, body, pinned, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [b.scope, b.alliance_id, b.title, b.body, b.pinned, u.id]);
  await audit(u.id, 'publish', 'announcement', a.id, { title: b.title, scope: b.scope }, b.alliance_id);
  if (b.notify) {
    const users = (await audienceFor(b.scope, b.alliance_id)).filter((id) => id !== u.id);
    await notifyUsers(users, { kind: 'announcement', title: b.title, body: b.body.slice(0, 200), link: '/announcements' });
    if (b.scope === 'kingdom') await notifyDiscordChannel({ kind: 'announcement', title: b.title, body: b.body.slice(0, 1500) });
  }
  res.status(201).json({ announcement: a });
}));

kingdomRouter.patch('/announcements/:id', h(async (req, res) => {
  const a = await one('SELECT * FROM announcements WHERE id = $1', [intParam(req.params.id)]);
  if (!a) throw notFound('Announcement');
  assert(canPost(req.user!, a.scope, a.alliance_id));
  const b = z.object({ title: z.string().trim().min(2).max(120), body: z.string().trim().min(1).max(8000), pinned: z.boolean() })
    .partial().parse(req.body);
  await q(`UPDATE announcements SET title = COALESCE($2,title), body = COALESCE($3,body), pinned = COALESCE($4,pinned), updated_at = now() WHERE id = $1`,
    [a.id, b.title ?? null, b.body ?? null, b.pinned ?? null]);
  await audit(req.user!.id, 'update', 'announcement', a.id, { before: { title: a.title }, change: b }, a.alliance_id);
  res.json({ ok: true });
}));

kingdomRouter.delete('/announcements/:id', h(async (req, res) => {
  const a = await one('SELECT * FROM announcements WHERE id = $1', [intParam(req.params.id)]);
  if (!a) throw notFound('Announcement');
  assert(canPost(req.user!, a.scope, a.alliance_id));
  await q('DELETE FROM announcements WHERE id = $1', [a.id]);
  await audit(req.user!.id, 'delete', 'announcement', a.id, { title: a.title, body: a.body }, a.alliance_id);
  res.json({ ok: true });
}));

// ---------- KVK preparation ----------
const kvkManager = requirePerm('event_manager');

kingdomRouter.get('/kvk', h(async (req, res) => {
  const seasons = await q('SELECT * FROM kvk_seasons ORDER BY starts_at DESC');
  const id = req.query.season_id ? intParam(String(req.query.season_id))
    : (seasons.find((s) => !s.ends_at || new Date(s.ends_at) > new Date()) ?? seasons[0])?.id;
  if (!id) return res.json({ seasons, season: null, phases: [], checklist: [], can_manage: has(req.user!, 'event_manager') });
  const season = seasons.find((s) => s.id === id) ?? null;
  const phases = await q('SELECT * FROM kvk_phases WHERE season_id = $1 ORDER BY starts_at', [id]);
  const checklist = await q(
    `SELECT i.*, COALESCE(mc.done, FALSE) AS done FROM kvk_checklist_items i
       LEFT JOIN member_checklist mc ON mc.item_id = i.id AND mc.user_id = $2
      WHERE i.season_id = $1 ORDER BY i.sort, i.id`, [id, req.user!.id]);
  let alliance_progress = null;
  if (req.user!.alliance_id) {
    alliance_progress = await q(
      `SELECT i.id, i.title, count(mc.user_id) FILTER (WHERE mc.done)::int AS done_count,
              (SELECT count(*)::int FROM alliance_members WHERE alliance_id = $2) AS member_count
         FROM kvk_checklist_items i
         LEFT JOIN member_checklist mc ON mc.item_id = i.id AND mc.user_id IN (SELECT user_id FROM alliance_members WHERE alliance_id = $2)
        WHERE i.season_id = $1 GROUP BY i.id ORDER BY i.sort, i.id`, [id, req.user!.alliance_id]);
  }
  res.json({ seasons, season, phases, checklist, alliance_progress, can_manage: has(req.user!, 'event_manager') });
}));

kingdomRouter.post('/kvk/seasons', kvkManager, h(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(2).max(80), starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }).nullable().default(null), notes: z.string().max(2000).default('') }).parse(req.body);
  if (b.ends_at && b.ends_at <= b.starts_at) throw bad('End must be after start.');
  const s = await one('INSERT INTO kvk_seasons (name, starts_at, ends_at, notes, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [b.name, b.starts_at, b.ends_at, b.notes, req.user!.id]);
  await audit(req.user!.id, 'create', 'kvk_season', s.id, b);
  res.status(201).json({ season: s });
}));

kingdomRouter.patch('/kvk/seasons/:id', kvkManager, h(async (req, res) => {
  const id = intParam(req.params.id);
  const b = z.object({ name: z.string().trim().min(2).max(80), starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }).nullable(), notes: z.string().max(2000) }).partial().parse(req.body);
  await q(`UPDATE kvk_seasons SET name = COALESCE($2,name), starts_at = COALESCE($3,starts_at),
           ends_at = CASE WHEN $4 THEN $5::timestamptz ELSE ends_at END, notes = COALESCE($6,notes) WHERE id = $1`,
    [id, b.name ?? null, b.starts_at ?? null, b.ends_at !== undefined, b.ends_at ?? null, b.notes ?? null]);
  await audit(req.user!.id, 'update', 'kvk_season', id, b);
  res.json({ ok: true });
}));

kingdomRouter.delete('/kvk/seasons/:id', kvkManager, h(async (req, res) => {
  const s = await one('DELETE FROM kvk_seasons WHERE id = $1 RETURNING *', [intParam(req.params.id)]);
  if (!s) throw notFound('Season');
  await audit(req.user!.id, 'delete', 'kvk_season', s.id, { before: s });
  res.json({ ok: true });
}));

kingdomRouter.patch('/kvk/phases/:id', kvkManager, h(async (req, res) => {
  const id = intParam(req.params.id);
  const b = z.object({ name: z.string().trim().min(1).max(80), starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }).nullable(), description: z.string().max(2000) }).partial().parse(req.body);
  const before = await one('SELECT * FROM kvk_phases WHERE id = $1', [id]);
  if (!before) throw notFound('Phase');
  await q(`UPDATE kvk_phases SET name = COALESCE($2,name), starts_at = COALESCE($3,starts_at),
           ends_at = CASE WHEN $4 THEN $5::timestamptz ELSE ends_at END, description = COALESCE($6,description) WHERE id = $1`,
    [id, b.name ?? null, b.starts_at ?? null, b.ends_at !== undefined, b.ends_at ?? null, b.description ?? null]);
  await audit(req.user!.id, 'update', 'kvk_phase', id, { before, change: b });
  res.json({ ok: true });
}));

kingdomRouter.patch('/kvk/checklist/:id', kvkManager, h(async (req, res) => {
  const id = intParam(req.params.id);
  const b = z.object({ title: z.string().trim().min(1).max(160), description: z.string().max(1000), sort: z.number().int() }).partial().parse(req.body);
  const before = await one('SELECT * FROM kvk_checklist_items WHERE id = $1', [id]);
  if (!before) throw notFound('Checklist item');
  await q('UPDATE kvk_checklist_items SET title = COALESCE($2,title), description = COALESCE($3,description), sort = COALESCE($4,sort) WHERE id = $1',
    [id, b.title ?? null, b.description ?? null, b.sort ?? null]);
  await audit(req.user!.id, 'update', 'kvk_checklist_item', id, { before, change: b });
  res.json({ ok: true });
}));

kingdomRouter.post('/kvk/seasons/:id/phases', kvkManager, h(async (req, res) => {
  const id = intParam(req.params.id);
  const b = z.object({ name: z.string().trim().min(1).max(80), starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }).nullable().default(null), description: z.string().max(2000).default('') }).parse(req.body);
  const p = await one('INSERT INTO kvk_phases (season_id, name, starts_at, ends_at, description) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [id, b.name, b.starts_at, b.ends_at, b.description]);
  await audit(req.user!.id, 'create', 'kvk_phase', p.id, b);
  res.status(201).json({ phase: p });
}));

kingdomRouter.delete('/kvk/phases/:id', kvkManager, h(async (req, res) => {
  const p = await one('DELETE FROM kvk_phases WHERE id = $1 RETURNING *', [intParam(req.params.id)]);
  if (!p) throw notFound('Phase');
  await audit(req.user!.id, 'delete', 'kvk_phase', p.id, { before: p });
  res.json({ ok: true });
}));

kingdomRouter.post('/kvk/seasons/:id/checklist', kvkManager, h(async (req, res) => {
  const id = intParam(req.params.id);
  const b = z.object({ title: z.string().trim().min(1).max(160), description: z.string().max(1000).default(''), sort: z.number().int().default(0) })
    .parse(req.body);
  const i = await one('INSERT INTO kvk_checklist_items (season_id, title, description, sort) VALUES ($1,$2,$3,$4) RETURNING *',
    [id, b.title, b.description, b.sort]);
  await audit(req.user!.id, 'create', 'kvk_checklist_item', i.id, b);
  res.status(201).json({ item: i });
}));

kingdomRouter.delete('/kvk/checklist/:id', kvkManager, h(async (req, res) => {
  const i = await one('DELETE FROM kvk_checklist_items WHERE id = $1 RETURNING *', [intParam(req.params.id)]);
  if (!i) throw notFound('Checklist item');
  await audit(req.user!.id, 'delete', 'kvk_checklist_item', i.id, { before: i });
  res.json({ ok: true });
}));

kingdomRouter.put('/kvk/checklist/:id/mine', h(async (req, res) => {
  const { done } = z.object({ done: z.boolean() }).parse(req.body);
  const id = intParam(req.params.id);
  if (!(await one('SELECT 1 FROM kvk_checklist_items WHERE id = $1', [id]))) throw notFound('Checklist item');
  await q(`INSERT INTO member_checklist (user_id, item_id, done) VALUES ($1,$2,$3)
           ON CONFLICT (user_id, item_id) DO UPDATE SET done = EXCLUDED.done, updated_at = now()`, [req.user!.id, id, done]);
  res.json({ ok: true });
}));
