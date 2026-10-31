import { Router } from 'express';
import { z } from 'zod';
import { q, one } from '../lib/db.js';
import { h, bad, intParam, notFound, forbidden } from '../lib/http.js';
import { requireAuth, isAdmin, has, isAllianceLeader, type SessionUser } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { calculate, latestPublishedVersion } from '../lib/calc.js';
import { notifyUsers } from '../lib/notify.js';
import { saveInventory, saveBuildings, inventorySchema, buildingsSchema } from '../lib/memberData.js';

/**
 * Member planning: the kingdom admin and alliance managers see every member who shares;
 * R4/R5 see members of their own alliance who share. Members who do not share are listed by name only.
 */
export const planningRouter = Router();
planningRouter.use(requireAuth);

const kingdomWide = (u: SessionUser) => isAdmin(u) || has(u, 'alliance_manager');
const canPlan = (u: SessionUser) => kingdomWide(u) || (u.alliance_id != null && isAllianceLeader(u, u.alliance_id));
function canSeeMember(u: SessionUser, memberAllianceId: number | null) {
  if (kingdomWide(u)) return true;
  return memberAllianceId != null && isAllianceLeader(u, memberAllianceId);
}

planningRouter.get('/members', h(async (req, res) => {
  const u = req.user!;
  if (!canPlan(u)) throw forbidden('Only the kingdom admin, alliance managers and R4/R5 can open member planning.');
  const allianceFilter = req.query.alliance_id ? intParam(String(req.query.alliance_id)) : null;
  const scopeAlliance = kingdomWide(u) ? allianceFilter : u.alliance_id;
  const members = await q<any>(
    `SELECT u.id, u.display_name, u.ingame_name, u.share_inventory, u.share_buildings, u.share_user_choice, a.id AS alliance_id, a.tag AS alliance_tag, am.rank,
            (SELECT max(updated_at) FROM member_inventory mi WHERE mi.user_id = u.id) AS inventory_updated
       FROM users u LEFT JOIN alliance_members am ON am.user_id = u.id LEFT JOIN alliances a ON a.id = am.alliance_id
      WHERE u.deleted_at IS NULL AND ($1::int IS NULL OR am.alliance_id = $1)
      ORDER BY a.tag NULLS LAST, am.rank DESC NULLS LAST, u.display_name`, [scopeAlliance]);
  const ids = members.filter((m) => m.share_inventory).map((m) => m.id);
  const inv = ids.length ? await q<any>('SELECT user_id, resource_key, amount FROM member_inventory WHERE user_id = ANY($1)', [ids]) : [];
  const bIds = members.filter((m) => m.share_buildings).map((m) => m.id);
  const tc = bIds.length ? await q<any>(
    `SELECT mb.user_id, mb.level FROM member_buildings mb JOIN game_buildings b ON b.id = mb.building_id
      WHERE b.key = 'town_center' AND mb.user_id = ANY($1)`, [bIds]) : [];
  for (const m of members) {
    m.inventory = m.share_inventory ? Object.fromEntries(inv.filter((r) => r.user_id === m.id).map((r) => [r.resource_key, r.amount])) : null;
    m.town_center = m.share_buildings ? (tc.find((r) => r.user_id === m.id)?.level ?? 0) : null;
    if (!m.share_inventory) m.inventory_updated = null;
  }
  const alliances = kingdomWide(u) ? await q('SELECT id, tag, name FROM alliances ORDER BY tag') : [];
  await audit(u.id, 'view_shared', 'member_planning', null, { alliance_id: scopeAlliance }, scopeAlliance);
  res.json({ members, alliances, kingdom_wide: kingdomWide(u) });
}));

async function memberFor(u: SessionUser, id: number) {
  const m = await one<any>(
    `SELECT u.id, u.display_name, u.ingame_name, u.share_inventory, u.share_buildings, am.alliance_id, a.tag AS alliance_tag
       FROM users u LEFT JOIN alliance_members am ON am.user_id = u.id LEFT JOIN alliances a ON a.id = am.alliance_id
      WHERE u.id = $1 AND u.deleted_at IS NULL`, [id]);
  if (!m) throw notFound('Member');
  if (!canSeeMember(u, m.alliance_id)) throw forbidden('You can only plan for members of your own alliance.');
  if (!m.share_inventory && !m.share_buildings) throw forbidden('This member has not shared their resources or buildings.');
  return m;
}

async function memberData(m: any) {
  const inventory = m.share_inventory
    ? Object.fromEntries((await q<any>('SELECT resource_key, amount FROM member_inventory WHERE user_id = $1', [m.id])).map((r) => [r.resource_key, r.amount]))
    : {};
  const levelRows = m.share_buildings
    ? await q<any>(`SELECT b.id, b.key, b.name, mb.level FROM member_buildings mb JOIN game_buildings b ON b.id = mb.building_id WHERE mb.user_id = $1 ORDER BY b.name`, [m.id])
    : [];
  return { inventory, levelRows, memberLevels: Object.fromEntries(levelRows.map((r) => [r.key, r.level])) };
}

planningRouter.get('/members/:id', h(async (req, res) => {
  const m = await memberFor(req.user!, intParam(req.params.id));
  const d = await memberData(m);
  const last = await one<any>(
    `SELECT mi.updated_at, c.display_name AS by_name FROM member_inventory mi LEFT JOIN users c ON c.id = mi.updated_by
      WHERE mi.user_id = $1 ORDER BY mi.updated_at DESC LIMIT 1`, [m.id]);
  const allBuildings = m.share_buildings ? await q(`SELECT b.id, b.key, b.name, b.max_level, COALESCE(mb.level,0) AS level FROM game_buildings b
      LEFT JOIN member_buildings mb ON mb.building_id = b.id AND mb.user_id = $1 ORDER BY b.name`, [m.id]) : null;
  const plans = await q(
    `SELECT p.id, p.name, p.updated_at, p.result->>'quality' AS quality, c.display_name AS created_by_name
       FROM upgrade_plans p LEFT JOIN users c ON c.id = p.created_by
      WHERE p.owner_id = $1 AND (p.created_by = $2 OR p.shared_with_alliance) ORDER BY p.updated_at DESC`, [m.id, req.user!.id]);
  await audit(req.user!.id, 'view_shared', 'member_planning', m.id, {}, m.alliance_id);
  res.json({ member: m, inventory: m.share_inventory ? d.inventory : null, buildings: m.share_buildings ? d.levelRows : null, all_buildings: allBuildings,
    last_update: m.share_inventory ? last : null, plans });
}));

const items = z.array(z.object({
  building_id: z.number().int().positive(), from: z.number().int().min(0).max(1000), to: z.number().int().min(1).max(1000),
})).min(1).max(30);
const assumptions = z.object({ speed_bonus_pct: z.number().min(0).max(1000).optional(), speedup_minutes: z.number().int().min(0).optional() }).default({});

planningRouter.post('/members/:id/calculate', h(async (req, res) => {
  const m = await memberFor(req.user!, intParam(req.params.id));
  const b = z.object({ items, assumptions }).parse(req.body);
  const v = await latestPublishedVersion();
  if (!v) throw bad('No building data has been published yet. A data curator needs to publish a dataset version first.');
  const d = await memberData(m);
  res.json({ result: await calculate({ items: b.items, assumptions: b.assumptions, datasetVersionId: v, inventory: d.inventory, memberLevels: d.memberLevels }) });
}));

planningRouter.post('/members/:id/plans', h(async (req, res) => {
  const u = req.user!;
  const m = await memberFor(u, intParam(req.params.id));
  const b = z.object({ name: z.string().trim().min(1).max(80), items, assumptions, note: z.string().max(500).default('') }).parse(req.body);
  const v = await latestPublishedVersion();
  if (!v) throw bad('No building data has been published yet. A data curator needs to publish a dataset version first.');
  const d = await memberData(m);
  const result = await calculate({ items: b.items, assumptions: b.assumptions, datasetVersionId: v, inventory: d.inventory, memberLevels: d.memberLevels });
  const p = await one(
    `INSERT INTO upgrade_plans (owner_id, created_by, name, items, assumptions, dataset_version_id, result, shared_with_alliance)
     VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE) RETURNING id, name`,
    [m.id, u.id, b.name, JSON.stringify(b.items), b.assumptions, v, result]);
  await audit(u.id, 'create', 'upgrade_plan', p.id, { for_user: m.id, name: b.name }, m.alliance_id);
  await notifyUsers([m.id], { kind: 'plan_from_leader', tkey: 'plan_from_leader', params: { name: u.display_name, plan: b.name, note: b.note }, link: `/plans/${p.id}` });
  res.status(201).json({ plan: p });
}));

/** A leader fills in resources/speedups for a member who shares them (for members who need help entering data). */
planningRouter.put('/members/:id/inventory', h(async (req, res) => {
  const u = req.user!;
  const m = await memberFor(u, intParam(req.params.id));
  if (!m.share_inventory) throw forbidden('This member does not share their resources, so leaders cannot edit them.');
  const b = inventorySchema.parse(req.body);
  await saveInventory(m.id, b, u.id);
  await audit(u.id, 'update', 'member_inventory', m.id, { keys: Object.keys(b) }, m.alliance_id);
  await notifyUsers([m.id], { kind: 'data_updated_by_leader', tkey: 'resources_updated_by_leader', params: { name: u.display_name }, link: '/me/resources' });
  res.json({ ok: true });
}));

planningRouter.put('/members/:id/buildings', h(async (req, res) => {
  const u = req.user!;
  const m = await memberFor(u, intParam(req.params.id));
  if (!m.share_buildings) throw forbidden('This member does not share their building levels, so leaders cannot edit them.');
  const b = buildingsSchema.parse(req.body);
  await saveBuildings(m.id, b, u.id);
  await audit(u.id, 'update', 'member_buildings', m.id, { count: b.length }, m.alliance_id);
  await notifyUsers([m.id], { kind: 'data_updated_by_leader', tkey: 'buildings_updated_by_leader', params: { name: u.display_name }, link: '/me/resources' });
  res.json({ ok: true });
}));

/** Admin or alliance manager turns sharing on for members who never chose. A member's own "off" is always respected. */
async function turnOnSharing(u: SessionUser, where: string, params: unknown[]) {
  const rows = await q<{ id: number }>(
    `UPDATE users SET share_inventory = TRUE, share_buildings = TRUE
      WHERE deleted_at IS NULL AND share_user_choice IS DISTINCT FROM FALSE AND NOT (share_inventory AND share_buildings) AND ${where}
      RETURNING id`, params);
  if (rows.length) {
    await notifyUsers(rows.map((r) => r.id), { kind: 'sharing_turned_on', tkey: 'sharing_turned_on', params: { name: u.display_name }, link: '/settings' });
  }
  return rows.length;
}

planningRouter.post('/sharing/all', h(async (req, res) => {
  const u = req.user!;
  if (!kingdomWide(u)) throw forbidden('Only the kingdom admin and alliance managers can do this.');
  const changed = await turnOnSharing(u, 'TRUE', []);
  const skipped = (await one<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE deleted_at IS NULL AND share_user_choice = FALSE`))?.n ?? 0;
  await audit(u.id, 'sharing_on_all', 'member_planning', null, { changed, skipped });
  res.json({ changed, skipped });
}));

planningRouter.post('/members/:id/sharing', h(async (req, res) => {
  const u = req.user!;
  if (!kingdomWide(u)) throw forbidden('Only the kingdom admin and alliance managers can do this.');
  const id = intParam(req.params.id);
  const m = await one<{ share_user_choice: boolean | null }>('SELECT share_user_choice FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!m) throw notFound('Member');
  if (m.share_user_choice === false) throw bad('This member turned sharing off themselves. Only they can turn it back on.');
  await turnOnSharing(u, 'id = $1', [id]);
  await audit(u.id, 'sharing_on', 'member_planning', id);
  res.json({ ok: true });
}));
