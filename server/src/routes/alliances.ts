import { Router } from 'express';
import { z } from 'zod';
import { q, one } from '../lib/db.js';
import { h, bad, intParam, notFound, forbidden } from '../lib/http.js';
import { requireAuth, requirePerm, canManageAlliance, has, isAllianceLeader, assert, type SessionUser } from '../lib/auth.js';
import { audit } from '../lib/audit.js';

export const alliancesRouter = Router();
alliancesRouter.use(requireAuth);

const RANKS = ['R1', 'R2', 'R3', 'R4', 'R5'] as const;
type Rank = typeof RANKS[number];

/** Who may set a member to a given rank. R4 manages R1–R3; R5 also assigns R4; R5 itself needs a kingdom alliance manager. */
function canAssignRank(u: SessionUser, allianceId: number, rank: Rank) {
  if (has(u, 'alliance_manager')) return true;
  if (!isAllianceLeader(u, allianceId)) return false;
  if (rank === 'R5') return false;
  if (rank === 'R4') return u.alliance_rank === 'R5';
  return true;
}
/** Leaders can only act on members ranked below themselves. */
function canActOn(u: SessionUser, allianceId: number, targetRank: Rank) {
  if (has(u, 'alliance_manager')) return true;
  if (!isAllianceLeader(u, allianceId)) return false;
  return RANKS.indexOf(targetRank) < RANKS.indexOf(u.alliance_rank as Rank);
}

alliancesRouter.get('/', h(async (_req, res) => {
  res.json({ alliances: await q(
    `SELECT a.*, count(am.user_id)::int AS member_count, COALESCE(sum(am.power),0)::bigint AS total_power,
            (SELECT u.display_name FROM alliance_members m JOIN users u ON u.id = m.user_id
              WHERE m.alliance_id = a.id AND m.rank = 'R5' LIMIT 1) AS leader
       FROM alliances a LEFT JOIN alliance_members am ON am.alliance_id = a.id
      GROUP BY a.id ORDER BY a.tag`) });
}));

alliancesRouter.post('/', requirePerm('alliance_manager'), h(async (req, res) => {
  const b = z.object({
    tag: z.string().trim().min(2).max(6).regex(/^[A-Za-z0-9]+$/, 'letters and numbers only'),
    name: z.string().trim().min(2).max(60), description: z.string().max(1000).default(''),
  }).parse(req.body);
  const a = await one('INSERT INTO alliances (tag, name, description) VALUES ($1,$2,$3) RETURNING *', [b.tag.toUpperCase(), b.name, b.description]);
  await audit(req.user!.id, 'create', 'alliance', a.id, b, a.id);
  res.status(201).json({ alliance: a });
}));

alliancesRouter.get('/:id', h(async (req, res) => {
  const id = intParam(req.params.id);
  const a = await one('SELECT * FROM alliances WHERE id = $1', [id]);
  if (!a) throw notFound('Alliance');
  const members = await q(
    `SELECT u.id, u.display_name, u.ingame_name, am.rank, am.power, am.joined_at
       FROM alliance_members am JOIN users u ON u.id = am.user_id
      WHERE am.alliance_id = $1 AND u.deleted_at IS NULL
      ORDER BY am.rank DESC, u.display_name`, [id]);
  const u = req.user!;
  res.json({
    alliance: a, members,
    viewer: {
      is_member: u.alliance_id === id,
      can_manage: canManageAlliance(u, id),
      can_edit_events: canManageAlliance(u, id) || has(u, 'event_manager'),
      can_post: canManageAlliance(u, id) || has(u, 'announcement_manager'),
      rank: u.alliance_id === id ? u.alliance_rank : null,
    },
  });
}));

alliancesRouter.patch('/:id', h(async (req, res) => {
  const id = intParam(req.params.id);
  assert(canManageAlliance(req.user!, id));
  const b = z.object({
    name: z.string().trim().min(2).max(60), description: z.string().max(1000),
    tag: z.string().trim().min(2).max(6).regex(/^[A-Za-z0-9]+$/, 'letters and numbers only'),
  }).partial().parse(req.body);
  if (b.tag !== undefined && !has(req.user!, 'alliance_manager')) throw forbidden('Only a kingdom alliance manager can change the tag.');
  await q('UPDATE alliances SET name = COALESCE($2,name), description = COALESCE($3,description), tag = COALESCE($4,tag) WHERE id = $1',
    [id, b.name ?? null, b.description ?? null, b.tag ? b.tag.toUpperCase() : null]);
  await audit(req.user!.id, 'update', 'alliance', id, b, id);
  res.json({ ok: true });
}));

/** Find accounts without an alliance, so leaders can add them. */
alliancesRouter.get('/:id/candidates', h(async (req, res) => {
  const id = intParam(req.params.id);
  assert(canManageAlliance(req.user!, id));
  const term = `%${String(req.query.q ?? '').slice(0, 40)}%`;
  res.json({ users: await q(
    `SELECT u.id, u.display_name, u.ingame_name FROM users u
      WHERE u.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM alliance_members am WHERE am.user_id = u.id)
        AND (u.display_name ILIKE $1 OR u.ingame_name ILIKE $1) ORDER BY u.display_name LIMIT 20`, [term]) });
}));

alliancesRouter.post('/:id/members', h(async (req, res) => {
  const id = intParam(req.params.id);
  const b = z.object({ user_id: z.number().int().positive(), rank: z.enum(RANKS).default('R1'), power: z.number().int().min(0).nullable().optional() })
    .parse(req.body);
  assert(canManageAlliance(req.user!, id) && canAssignRank(req.user!, id, b.rank), 'You cannot add a member at that rank.');
  const existing = await one('SELECT alliance_id FROM alliance_members WHERE user_id = $1', [b.user_id]);
  if (existing) throw bad('This player already belongs to an alliance. They must leave it first.');
  await q('INSERT INTO alliance_members (user_id, alliance_id, rank, power) VALUES ($1,$2,$3,$4)', [b.user_id, id, b.rank, b.power ?? null]);
  await audit(req.user!.id, 'add_member', 'alliance', id, { user_id: b.user_id, rank: b.rank }, id);
  res.status(201).json({ ok: true });
}));

alliancesRouter.patch('/:id/members/:userId', h(async (req, res) => {
  const id = intParam(req.params.id);
  const userId = intParam(req.params.userId);
  const m = await one<{ rank: Rank }>('SELECT rank FROM alliance_members WHERE user_id = $1 AND alliance_id = $2', [userId, id]);
  if (!m) throw notFound('Member');
  const b = z.object({ rank: z.enum(RANKS).optional(), power: z.number().int().min(0).nullable().optional() }).parse(req.body);
  const self = userId === req.user!.id;
  if (b.rank !== undefined) {
    assert(!self || has(req.user!, 'alliance_manager'), 'You cannot change your own rank.');
    assert(canActOn(req.user!, id, m.rank) && canAssignRank(req.user!, id, b.rank), 'You cannot set that rank.');
  }
  if (b.power !== undefined) assert(self || canManageAlliance(req.user!, id), 'You cannot edit this member.');
  await q('UPDATE alliance_members SET rank = COALESCE($3, rank), power = CASE WHEN $4 THEN $5 ELSE power END WHERE user_id = $1 AND alliance_id = $2',
    [userId, id, b.rank ?? null, b.power !== undefined, b.power ?? null]);
  await audit(req.user!.id, 'update_member', 'alliance', id, { user_id: userId, from: m.rank, ...b }, id);
  res.json({ ok: true });
}));

alliancesRouter.delete('/:id/members/:userId', h(async (req, res) => {
  const id = intParam(req.params.id);
  const userId = intParam(req.params.userId);
  const m = await one<{ rank: Rank }>('SELECT rank FROM alliance_members WHERE user_id = $1 AND alliance_id = $2', [userId, id]);
  if (!m) throw notFound('Member');
  const self = userId === req.user!.id;
  if (!self) assert(canActOn(req.user!, id, m.rank), 'You cannot remove this member.');
  if (self && m.rank === 'R5' && !has(req.user!, 'alliance_manager')) throw bad('Hand R5 to another member before leaving.');
  await q('DELETE FROM alliance_members WHERE user_id = $1 AND alliance_id = $2', [userId, id]);
  await q('UPDATE upgrade_plans SET shared_with_alliance = FALSE WHERE owner_id = $1', [userId]);
  await audit(req.user!.id, self ? 'leave' : 'remove_member', 'alliance', id, { user_id: userId }, id);
  res.json({ ok: true });
}));

/** Information members chose to share with their own alliance leaders. Nothing else is visible. */
alliancesRouter.get('/:id/shared', h(async (req, res) => {
  const id = intParam(req.params.id);
  if (!isAllianceLeader(req.user!, id)) throw forbidden('Only R4/R5 of this alliance can see shared member data.');
  const inventory = await q(
    `SELECT u.id AS user_id, u.display_name, mi.resource_key, mi.amount, mi.updated_at
       FROM alliance_members am JOIN users u ON u.id = am.user_id JOIN member_inventory mi ON mi.user_id = u.id
      WHERE am.alliance_id = $1 AND u.share_inventory`, [id]);
  const buildings = await q(
    `SELECT u.id AS user_id, u.display_name, b.name AS building, mb.level, mb.updated_at
       FROM alliance_members am JOIN users u ON u.id = am.user_id JOIN member_buildings mb ON mb.user_id = u.id
       JOIN game_buildings b ON b.id = mb.building_id
      WHERE am.alliance_id = $1 AND u.share_buildings`, [id]);
  const plans = await q(
    `SELECT p.id, p.name, p.result, p.updated_at, u.display_name
       FROM upgrade_plans p JOIN alliance_members am ON am.user_id = p.owner_id JOIN users u ON u.id = p.owner_id
      WHERE am.alliance_id = $1 AND p.shared_with_alliance ORDER BY p.updated_at DESC`, [id]);
  for (const p of plans) if (p.result) delete p.result.surplus;
  await audit(req.user!.id, 'view_shared', 'alliance', id, {}, id);
  res.json({ inventory, buildings, plans });
}));
