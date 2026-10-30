import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../lib/db.js';
import { h, bad, intParam, notFound } from '../lib/http.js';
import { requireAuth, requirePerm, isAdmin } from '../lib/auth.js';
import { levelLabel, parseLevel } from '../lib/levels.js';
import { audit } from '../lib/audit.js';
import { parseCsv, toCsv } from '../lib/csv.js';
import { latestPublishedVersion } from '../lib/calc.js';

export const gameRouter = Router();
gameRouter.use(requireAuth);
const curator = requirePerm('data_curator');

const STATUSES = ['in_game_confirmed', 'cross_checked', 'single_source', 'conflicting', 'missing'] as const;

// ---------- Read (everyone) ----------
gameRouter.get('/resources', h(async (_req, res) => {
  res.json({ resources: await q('SELECT * FROM resource_types ORDER BY sort') });
}));

gameRouter.get('/buildings', h(async (_req, res) => {
  const version = await latestPublishedVersion();
  const rows = await q(
    `SELECT b.*,
            (SELECT count(*)::int FROM building_levels l WHERE l.building_id = b.id AND l.dataset_version_id = $1 AND l.status <> 'missing') AS levels_with_data,
            (SELECT count(*)::int FROM building_levels l WHERE l.building_id = b.id AND l.dataset_version_id = $1 AND l.status IN ('in_game_confirmed','cross_checked')) AS levels_verified
       FROM game_buildings b ORDER BY b.name`, [version]);
  res.json({ buildings: rows, published_version_id: version });
}));

gameRouter.get('/versions', h(async (_req, res) => {
  res.json({ versions: await q(
    `SELECT v.*, u.display_name AS created_by_name,
            (SELECT count(*)::int FROM building_levels l WHERE l.dataset_version_id = v.id) AS record_count
       FROM dataset_versions v LEFT JOIN users u ON u.id = v.created_by ORDER BY v.id DESC`) });
}));

gameRouter.get('/versions/:id/levels', h(async (req, res) => {
  const vid = intParam(req.params.id);
  const buildingId = req.query.building_id ? intParam(String(req.query.building_id)) : null;
  const rows = await q(
    `SELECT l.*, b.name AS building_name, b.key AS building_key, u.display_name AS updated_by_name
       FROM building_levels l JOIN game_buildings b ON b.id = l.building_id LEFT JOIN users u ON u.id = l.updated_by
      WHERE l.dataset_version_id = $1 AND ($2::int IS NULL OR l.building_id = $2)
      ORDER BY b.name, l.level`, [vid, buildingId]);
  res.json({ levels: rows });
}));

/** Coverage report: per building, how many levels exist in each verification status. */
gameRouter.get('/versions/:id/coverage', h(async (req, res) => {
  const vid = intParam(req.params.id);
  const rows = await q(
    `SELECT b.id, b.name, b.max_level,
            count(l.id) FILTER (WHERE l.status = 'in_game_confirmed')::int AS in_game_confirmed,
            count(l.id) FILTER (WHERE l.status = 'cross_checked')::int AS cross_checked,
            count(l.id) FILTER (WHERE l.status = 'single_source')::int AS single_source,
            count(l.id) FILTER (WHERE l.status = 'conflicting')::int AS conflicting,
            (b.max_level - count(l.id) FILTER (WHERE l.status <> 'missing'))::int AS missing
       FROM game_buildings b LEFT JOIN building_levels l ON l.building_id = b.id AND l.dataset_version_id = $1
      GROUP BY b.id ORDER BY b.name`, [vid]);
  res.json({ coverage: rows });
}));

gameRouter.get('/versions/:id/export.csv', h(async (req, res) => {
  const vid = intParam(req.params.id);
  const resources = await q<{ key: string }>(`SELECT key FROM resource_types WHERE kind = 'resource' ORDER BY sort`);
  const rows = await q<any>(
    `SELECT b.key AS building, l.* FROM building_levels l JOIN game_buildings b ON b.id = l.building_id
      WHERE l.dataset_version_id = $1 ORDER BY b.key, l.level`, [vid]);
  const header = ['building', 'level', ...resources.map((r) => r.key), 'duration_seconds', 'prerequisites',
    'status', 'source_url', 'source_checked_at', 'game_version', 'notes'];
  const body = rows.map((r) => [r.building, levelLabel(r.level), ...resources.map((x) => r.costs[x.key] ?? ''),
    r.duration_seconds ?? '', (r.prerequisites as any[]).map((p) => `${p.building}:${p.level}`).join(';'),
    r.status, r.source_url ?? '', r.source_checked_at ?? '', r.game_version ?? '', r.notes]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="building-data-v${vid}.csv"`);
  res.send(toCsv([header, ...body]));
}));

// ---------- Curator edits ----------
gameRouter.post('/resources', curator, h(async (req, res) => {
  const b = z.object({
    key: z.string().regex(/^[a-z_]{2,30}$/), name: z.string().trim().min(1).max(40),
    sort: z.number().int().default(50), verified: z.boolean().default(false), deferred: z.boolean().default(false),
  }).parse(req.body);
  await q(`INSERT INTO resource_types (key, name, sort, verified, deferred) VALUES ($1,$2,$3,$4,$5)`,
    [b.key, b.name, b.sort, b.verified, b.deferred]);
  await audit(req.user!.id, 'create', 'resource_type', b.key, b);
  res.status(201).json({ ok: true });
}));

gameRouter.patch('/resources/:key', curator, h(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(40), verified: z.boolean(), sort: z.number().int(), deferred: z.boolean() })
    .partial().parse(req.body);
  const before = await one('SELECT * FROM resource_types WHERE key = $1', [req.params.key]);
  if (!before) throw notFound('Resource');
  // Switching a resource in or out of calculations is an owner decision: admin only.
  if (b.deferred !== undefined && !isAdmin(req.user!)) throw bad('Only the kingdom admin can switch a resource on or off in calculations.');
  await q(`UPDATE resource_types SET name = COALESCE($2,name), verified = COALESCE($3,verified), sort = COALESCE($4,sort),
           deferred = COALESCE($5,deferred) WHERE key = $1`,
    [req.params.key, b.name ?? null, b.verified ?? null, b.sort ?? null, b.deferred ?? null]);
  await audit(req.user!.id, 'update', 'resource_type', req.params.key, { before, change: b });
  res.json({ ok: true });
}));

gameRouter.post('/buildings', curator, h(async (req, res) => {
  const b = z.object({
    key: z.string().regex(/^[a-z0-9_]{2,40}$/, 'use lowercase letters, numbers and underscores'),
    name: z.string().trim().min(1).max(60), max_level: z.number().int().min(1).max(1000), notes: z.string().max(500).default(''),
  }).parse(req.body);
  const row = await one('INSERT INTO game_buildings (key, name, max_level, notes) VALUES ($1,$2,$3,$4) RETURNING *',
    [b.key, b.name, b.max_level, b.notes]);
  await audit(req.user!.id, 'create', 'game_building', row.id, b);
  res.status(201).json({ building: row });
}));

gameRouter.patch('/buildings/:id', curator, h(async (req, res) => {
  const id = intParam(req.params.id);
  const b = z.object({ name: z.string().trim().min(1).max(60), max_level: z.number().int().min(1).max(1000), notes: z.string().max(500) })
    .partial().parse(req.body);
  const before = await one('SELECT * FROM game_buildings WHERE id = $1', [id]);
  if (!before) throw notFound('Building');
  await q(`UPDATE game_buildings SET name = COALESCE($2,name), max_level = COALESCE($3,max_level), notes = COALESCE($4,notes) WHERE id = $1`,
    [id, b.name ?? null, b.max_level ?? null, b.notes ?? null]);
  await audit(req.user!.id, 'update', 'game_building', id, { before, change: b });
  res.json({ ok: true });
}));

gameRouter.post('/versions', curator, h(async (req, res) => {
  const b = z.object({
    label: z.string().trim().min(1).max(80), notes: z.string().max(1000).default(''),
    copy_from: z.number().int().positive().optional(),
  }).parse(req.body);
  const v = await tx(async (c) => {
    const nv = (await c.query('INSERT INTO dataset_versions (label, notes, created_by) VALUES ($1,$2,$3) RETURNING *',
      [b.label, b.notes, req.user!.id])).rows[0];
    if (b.copy_from) {
      await c.query(
        `INSERT INTO building_levels (dataset_version_id, building_id, level, costs, duration_seconds, prerequisites,
                source_url, source_checked_at, game_version, status, notes, updated_by)
         SELECT $1, building_id, level, costs, duration_seconds, prerequisites, source_url, source_checked_at,
                game_version, status, notes, $3 FROM building_levels WHERE dataset_version_id = $2`,
        [nv.id, b.copy_from, req.user!.id]);
    }
    return nv;
  });
  await audit(req.user!.id, 'create', 'dataset_version', v.id, b);
  res.status(201).json({ version: v });
}));

gameRouter.patch('/versions/:id', curator, h(async (req, res) => {
  const id = intParam(req.params.id);
  const b = z.object({ label: z.string().trim().min(1).max(80), notes: z.string().max(1000) }).partial().parse(req.body);
  const before = await one('SELECT label, notes FROM dataset_versions WHERE id = $1', [id]);
  if (!before) throw notFound('Dataset version');
  await q('UPDATE dataset_versions SET label = COALESCE($2,label), notes = COALESCE($3,notes) WHERE id = $1', [id, b.label ?? null, b.notes ?? null]);
  await audit(req.user!.id, 'update', 'dataset_version', id, { before, change: b });
  res.json({ ok: true });
}));

gameRouter.delete('/versions/:id', curator, h(async (req, res) => {
  const id = intParam(req.params.id);
  const v = await one<{ status: string; label: string }>('SELECT status, label FROM dataset_versions WHERE id = $1', [id]);
  if (!v) throw notFound('Dataset version');
  if (v.status === 'published') throw bad('The published version is used by the calculator and cannot be deleted. Publish another version first.');
  const n = await one<{ n: number }>('SELECT count(*)::int AS n FROM building_levels WHERE dataset_version_id = $1', [id]);
  await q('DELETE FROM dataset_versions WHERE id = $1', [id]);
  await audit(req.user!.id, 'delete', 'dataset_version', id, { label: v.label, status: v.status, records: n?.n ?? 0 });
  res.json({ ok: true });
}));

gameRouter.post('/versions/:id/publish', curator, h(async (req, res) => {
  const id = intParam(req.params.id);
  const v = await one<{ status: string }>('SELECT status FROM dataset_versions WHERE id = $1', [id]);
  if (!v) throw notFound('Dataset version');
  if (v.status !== 'draft') throw bad('Only draft versions can be published.');
  await tx(async (c) => {
    await c.query(`UPDATE dataset_versions SET status = 'archived' WHERE status = 'published'`);
    await c.query(`UPDATE dataset_versions SET status = 'published', published_at = now() WHERE id = $1`, [id]);
  });
  await audit(req.user!.id, 'publish', 'dataset_version', id);
  res.json({ ok: true });
}));

const levelSchema = z.object({
  building_id: z.number().int().positive(),
  level: z.number().int().min(1).max(1000),
  costs: z.record(z.string(), z.number().int().min(0)).default({}),
  duration_seconds: z.number().int().min(0).nullable().default(null),
  prerequisites: z.array(z.object({ building: z.string().max(40), level: z.number().int().min(1) })).max(20).default([]),
  source_url: z.string().url().max(500).nullable().default(null),
  source_checked_at: z.string().date().nullable().default(null),
  game_version: z.string().max(40).nullable().default(null),
  status: z.enum(STATUSES),
  notes: z.string().max(1000).default(''),
});

async function assertDraft(versionId: number) {
  const v = await one<{ status: string }>('SELECT status FROM dataset_versions WHERE id = $1', [versionId]);
  if (!v) throw notFound('Dataset version');
  if (v.status !== 'draft') throw bad('Published data cannot be edited. Create a new draft version and publish it.');
}

async function validateLevel(l: z.infer<typeof levelSchema>) {
  const b = await one<{ max_level: number }>('SELECT max_level FROM game_buildings WHERE id = $1', [l.building_id]);
  if (!b) throw bad('Building does not exist.');
  if (l.level > b.max_level) throw bad(`Level ${levelLabel(l.level)} is above the building's maximum (${levelLabel(b.max_level)}).`);
  const keys = new Set((await q<{ key: string }>(`SELECT key FROM resource_types WHERE kind = 'resource'`)).map((r) => r.key));
  for (const k of Object.keys(l.costs)) if (!keys.has(k)) throw bad(`Unknown resource "${k}".`);
  if (l.status !== 'missing' && !l.source_url && l.status !== 'in_game_confirmed') {
    throw bad('Add a source URL, or mark the record as in-game confirmed.');
  }
}

/** Create or replace one level record in a draft version. */
gameRouter.put('/versions/:id/levels', curator, h(async (req, res) => {
  const vid = intParam(req.params.id);
  await assertDraft(vid);
  const l = levelSchema.parse(req.body);
  await validateLevel(l);
  const before = await one('SELECT * FROM building_levels WHERE dataset_version_id = $1 AND building_id = $2 AND level = $3',
    [vid, l.building_id, l.level]);
  const row = await one(
    `INSERT INTO building_levels (dataset_version_id, building_id, level, costs, duration_seconds, prerequisites,
            source_url, source_checked_at, game_version, status, notes, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (dataset_version_id, building_id, level) DO UPDATE SET
       costs = EXCLUDED.costs, duration_seconds = EXCLUDED.duration_seconds, prerequisites = EXCLUDED.prerequisites,
       source_url = EXCLUDED.source_url, source_checked_at = EXCLUDED.source_checked_at, game_version = EXCLUDED.game_version,
       status = EXCLUDED.status, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [vid, l.building_id, l.level, l.costs, l.duration_seconds, JSON.stringify(l.prerequisites), l.source_url,
      l.source_checked_at, l.game_version, l.status, l.notes, req.user!.id]);
  await audit(req.user!.id, before ? 'update' : 'create', 'building_level', row.id, { before, after: l });
  res.json({ level: row });
}));

gameRouter.delete('/versions/:id/levels/:levelId', curator, h(async (req, res) => {
  const vid = intParam(req.params.id);
  await assertDraft(vid);
  const before = await one('DELETE FROM building_levels WHERE id = $1 AND dataset_version_id = $2 RETURNING *',
    [intParam(req.params.levelId), vid]);
  if (!before) throw notFound('Level record');
  await audit(req.user!.id, 'delete', 'building_level', before.id, { before });
  res.json({ ok: true });
}));

/**
 * CSV import into a draft version. Columns: building, level, <resource keys...>, duration_seconds,
 * prerequisites (key:level;key:level), status, source_url, source_checked_at, game_version, notes.
 * All rows are validated first; nothing is written if any row fails.
 */
gameRouter.post('/versions/:id/import', curator, h(async (req, res) => {
  const vid = intParam(req.params.id);
  await assertDraft(vid);
  const { csv, add_buildings } = z.object({ csv: z.string().min(1).max(2_000_000), add_buildings: z.boolean().default(false) }).parse(req.body);
  const rows = parseCsv(csv);
  if (rows.length < 2) throw bad('The file has no data rows.');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  for (const req of ['building', 'level', 'status']) if (col(req) < 0) throw bad(`Missing column "${req}".`);
  const resourceKeys = (await q<{ key: string }>(`SELECT key FROM resource_types WHERE kind = 'resource'`)).map((r) => r.key).filter((k) => col(k) >= 0);
  let buildings = new Map((await q<{ id: number; key: string }>('SELECT id, key FROM game_buildings')).map((b) => [b.key, b.id]));

  // Optional: create buildings the file mentions and raise max levels so every row fits (e.g. TG tiers).
  if (add_buildings) {
    const need = new Map<string, number>();
    for (const r of rows.slice(1)) {
      const key = (r[col('building')] ?? '').trim();
      const lvl = parseLevel(r[col('level')] ?? '');
      if (/^[a-z0-9_]{2,40}$/.test(key) && Number.isInteger(lvl)) need.set(key, Math.max(need.get(key) ?? 0, lvl));
    }
    for (const [key, maxInFile] of need) {
      const ex = await one<{ id: number; max_level: number }>('SELECT id, max_level FROM game_buildings WHERE key = $1', [key]);
      if (!ex) {
        const name = key.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
        const nb = await one('INSERT INTO game_buildings (key, name, max_level) VALUES ($1,$2,$3) RETURNING id', [key, name, Math.max(30, maxInFile)]);
        await audit(req.user!.id, 'create', 'game_building', nb.id, { key, name, max_level: Math.max(30, maxInFile), via: 'import' });
      } else if (ex.max_level < maxInFile) {
        await q('UPDATE game_buildings SET max_level = $2 WHERE id = $1', [ex.id, maxInFile]);
        await audit(req.user!.id, 'update', 'game_building', ex.id, { before: { max_level: ex.max_level }, change: { max_level: maxInFile }, via: 'import' });
      }
    }
    buildings = new Map((await q<{ id: number; key: string }>('SELECT id, key FROM game_buildings')).map((b) => [b.key, b.id]));
  }

  const parsed: z.infer<typeof levelSchema>[] = [];
  const errors: string[] = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (n: string) => (col(n) >= 0 ? (r[col(n)] ?? '').trim() : '');
    const bid = buildings.get(get('building'));
    if (!bid) { errors.push(`Row ${line}: unknown building "${get('building')}".`); return; }
    const costs: Record<string, number> = {};
    for (const k of resourceKeys) {
      const v = get(k).replace(/[, ]/g, '');
      if (v === '') continue;
      if (!/^\d+$/.test(v)) { errors.push(`Row ${line}: "${k}" must be a whole number.`); return; }
      costs[k] = Number(v);
    }
    const prereq = get('prerequisites') ? get('prerequisites').split(';').map((p) => {
      const [building, level] = p.split(':');
      return { building: building.trim(), level: Number(level) };
    }) : [];
    const dur = get('duration_seconds');
    const res = levelSchema.safeParse({
      building_id: bid, level: parseLevel(get('level')), costs,
      duration_seconds: dur === '' ? null : Number(dur), prerequisites: prereq,
      source_url: get('source_url') || null, source_checked_at: get('source_checked_at') || null,
      game_version: get('game_version') || null, status: get('status'), notes: get('notes'),
    });
    if (!res.success) { errors.push(`Row ${line}: ${res.error.issues[0].path.join('.')} ${res.error.issues[0].message}`); return; }
    parsed.push(res.data);
  });
  for (const l of parsed) {
    try { await validateLevel(l); } catch (e: any) { errors.push(`Level ${levelLabel(l.level)}: ${e.message}`); }
  }
  if (errors.length) return res.status(400).json({ error: 'Import stopped. Nothing was saved.', details: errors.slice(0, 50) });

  await tx(async (c) => {
    for (const l of parsed) {
      await c.query(
        `INSERT INTO building_levels (dataset_version_id, building_id, level, costs, duration_seconds, prerequisites,
                source_url, source_checked_at, game_version, status, notes, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (dataset_version_id, building_id, level) DO UPDATE SET
           costs = EXCLUDED.costs, duration_seconds = EXCLUDED.duration_seconds, prerequisites = EXCLUDED.prerequisites,
           source_url = EXCLUDED.source_url, source_checked_at = EXCLUDED.source_checked_at, game_version = EXCLUDED.game_version,
           status = EXCLUDED.status, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [vid, l.building_id, l.level, l.costs, l.duration_seconds, JSON.stringify(l.prerequisites), l.source_url,
          l.source_checked_at, l.game_version, l.status, l.notes, req.user!.id]);
    }
  });
  await audit(req.user!.id, 'import', 'dataset_version', vid, { rows: parsed.length });
  res.json({ imported: parsed.length });
}));

gameRouter.get('/levels/:id/history', h(async (req, res) => {
  res.json({ history: await q(
    `SELECT a.action, a.summary, a.created_at, u.display_name AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.record_type = 'building_level' AND a.record_id = $1 ORDER BY a.created_at DESC`, [req.params.id]) });
}));
