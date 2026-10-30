import { Router } from 'express';
import { z } from 'zod';
import { q, one } from '../lib/db.js';
import { h, bad, intParam, notFound } from '../lib/http.js';
import { requireAuth, randomToken } from '../lib/auth.js';
import { calculate, latestPublishedVersion, memberContext } from '../lib/calc.js';
import { toCsv } from '../lib/csv.js';
import { levelLabel } from '../lib/levels.js';

export const plansRouter = Router();
export const sharedRouter = Router();

const items = z.array(z.object({
  building_id: z.number().int().positive(),
  from: z.number().int().min(0).max(1000),
  to: z.number().int().min(1).max(1000),
})).min(1).max(30);
const assumptions = z.object({
  speed_bonus_pct: z.number().min(0).max(1000).optional(),
  speedup_minutes: z.number().int().min(0).max(10_000_000).optional(),
}).default({});

async function versionOrFail(requested?: number) {
  const v = requested ?? (await latestPublishedVersion());
  if (!v) throw bad('No building data has been published yet. A data curator needs to publish a dataset version first.');
  return v;
}

/** Live calculation. Inventory can be overridden for "what if" checks without saving it. */
plansRouter.post('/calculate', requireAuth, h(async (req, res) => {
  const b = z.object({
    items, assumptions,
    inventory: z.record(z.string(), z.number().int().min(0)).optional(),
    dataset_version_id: z.number().int().positive().optional(),
  }).parse(req.body);
  const ctx = await memberContext(req.user!.id);
  const result = await calculate({
    items: b.items, assumptions: b.assumptions, datasetVersionId: await versionOrFail(b.dataset_version_id),
    inventory: b.inventory ?? ctx.inventory, memberLevels: ctx.memberLevels,
  });
  res.json({ result });
}));

plansRouter.use(requireAuth);

plansRouter.get('/', h(async (req, res) => {
  res.json({ plans: await q(
    `SELECT p.id, p.name, p.items, p.assumptions, p.dataset_version_id, p.shared_with_alliance, p.share_token IS NOT NULL AS has_link,
            p.created_at, p.updated_at, (p.result->>'authoritative')::boolean AS authoritative, c.display_name AS created_by_name, p.created_by, p.result->>'quality' AS quality, v.label AS dataset_label
       FROM upgrade_plans p LEFT JOIN dataset_versions v ON v.id = p.dataset_version_id LEFT JOIN users c ON c.id = p.created_by
      WHERE p.owner_id = $1 ORDER BY p.updated_at DESC`, [req.user!.id]) });
}));

async function ownPlan(id: number, userId: number) {
  const p = await one('SELECT * FROM upgrade_plans WHERE id = $1 AND owner_id = $2', [id, userId]);
  if (!p) throw notFound('Plan');
  return p;
}

plansRouter.get('/:id', h(async (req, res) => {
  res.json({ plan: await ownPlan(intParam(req.params.id), req.user!.id) });
}));

/** Saving always recalculates on the server so the stored result matches its dataset version. */
plansRouter.post('/', h(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(80), items, assumptions }).parse(req.body);
  const v = await versionOrFail();
  const ctx = await memberContext(req.user!.id);
  const result = await calculate({ items: b.items, assumptions: b.assumptions, datasetVersionId: v, ...ctx });
  const p = await one(
    `INSERT INTO upgrade_plans (owner_id, name, items, assumptions, dataset_version_id, result)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.user!.id, b.name, JSON.stringify(b.items), b.assumptions, v, result]);
  res.status(201).json({ plan: p });
}));

plansRouter.patch('/:id', h(async (req, res) => {
  const id = intParam(req.params.id);
  const p = await ownPlan(id, req.user!.id);
  const b = z.object({
    name: z.string().trim().min(1).max(80).optional(), items: items.optional(), assumptions: assumptions.optional(),
    recalculate: z.boolean().optional(),
  }).parse(req.body);
  const nextItems = b.items ?? p.items;
  const nextAssumptions = b.assumptions ?? p.assumptions;
  let result = p.result, version = p.dataset_version_id;
  if (b.items || b.assumptions || b.recalculate) {
    version = await versionOrFail();
    const ctx = await memberContext(req.user!.id);
    result = await calculate({ items: nextItems, assumptions: nextAssumptions, datasetVersionId: version, ...ctx });
  }
  const updated = await one(
    `UPDATE upgrade_plans SET name = $2, items = $3, assumptions = $4, result = $5, dataset_version_id = $6, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id, b.name ?? p.name, JSON.stringify(nextItems), nextAssumptions, result, version]);
  res.json({ plan: updated });
}));

plansRouter.post('/:id/duplicate', h(async (req, res) => {
  const p = await ownPlan(intParam(req.params.id), req.user!.id);
  const copy = await one(
    `INSERT INTO upgrade_plans (owner_id, name, items, assumptions, dataset_version_id, result)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.user!.id, `${p.name} (copy)`.slice(0, 80), JSON.stringify(p.items), p.assumptions, p.dataset_version_id, p.result]);
  res.status(201).json({ plan: copy });
}));

plansRouter.delete('/:id', h(async (req, res) => {
  await ownPlan(intParam(req.params.id), req.user!.id);
  await q('DELETE FROM upgrade_plans WHERE id = $1 AND owner_id = $2', [intParam(req.params.id), req.user!.id]);
  res.json({ ok: true });
}));

plansRouter.post('/:id/sharing', h(async (req, res) => {
  const id = intParam(req.params.id);
  const p = await ownPlan(id, req.user!.id);
  const b = z.object({ alliance: z.boolean().optional(), link: z.boolean().optional() }).parse(req.body);
  const token = b.link === undefined ? p.share_token : b.link ? (p.share_token ?? randomToken(18)) : null;
  const updated = await one(
    'UPDATE upgrade_plans SET shared_with_alliance = $2, share_token = $3 WHERE id = $1 RETURNING id, shared_with_alliance, share_token',
    [id, b.alliance ?? p.shared_with_alliance, token]);
  res.json({ sharing: updated });
}));

plansRouter.get('/:id/export.csv', h(async (req, res) => {
  const p = await ownPlan(intParam(req.params.id), req.user!.id);
  const r = p.result;
  if (!r) throw bad('This plan has no calculation yet.');
  const keys = Object.keys(r.totals);
  const rows: (string | number | null)[][] = [['Building', 'Level', 'Status', ...keys, 'Duration (s)', 'Source']];
  for (const it of r.items) for (const l of it.levels ?? []) {
    rows.push([it.building, levelLabel(l.level), l.status, ...keys.map((k) => l.costs?.[k] ?? null), l.duration_seconds ?? null, l.source_url ?? null]);
  }
  rows.push([], ['Total', '', r.quality ?? (r.authoritative ? 'verified' : 'incomplete'), ...keys.map((k) => r.totals[k])]);
  rows.push(['Shortage', '', '', ...keys.map((k) => r.shortage[k])]);
  rows.push(['Dataset version', r.dataset_version_id], ['Calculated at', r.calculated_at]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="plan-${p.id}.csv"`);
  res.send(toCsv(rows));
}));

/** Read-only view through a share link. No inventory is exposed, only the plan and its costs. */
sharedRouter.get('/plans/:token', h(async (req, res) => {
  const p = await one<any>(
    `SELECT p.name, p.items, p.assumptions, p.result, p.updated_at, u.display_name AS owner
       FROM upgrade_plans p JOIN users u ON u.id = p.owner_id WHERE p.share_token = $1 AND u.deleted_at IS NULL`,
    [String(req.params.token).slice(0, 100)]);
  if (!p) throw notFound('Shared plan');
  if (p.result) { delete p.result.surplus; delete p.result.shortage; }
  res.json({ plan: p });
}));
