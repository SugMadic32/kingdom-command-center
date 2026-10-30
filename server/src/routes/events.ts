import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../lib/db.js';
import { h, bad, intParam, notFound, forbidden } from '../lib/http.js';
import { requireAuth, has, canManageAlliance, isAllianceLeader, assert, type SessionUser } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { audienceFor, notifyUsers, notifyDiscordChannel } from '../lib/notify.js';

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

interface EventRow {
  id: number; scope: 'kingdom' | 'alliance'; alliance_id: number | null; type: string; title: string; description: string;
  status: 'draft' | 'proposed' | 'published' | 'cancelled'; starts_at: Date | null; duration_minutes: number;
  poll_open: boolean; created_by: number | null;
}

export function canManageEvent(u: SessionUser, e: Pick<EventRow, 'scope' | 'alliance_id'>) {
  if (has(u, 'event_manager')) return true;
  return e.scope === 'alliance' && e.alliance_id != null && canManageAlliance(u, e.alliance_id);
}
function inAudience(u: SessionUser, e: EventRow) {
  return e.scope === 'kingdom' || u.alliance_id === e.alliance_id;
}
function canSee(u: SessionUser, e: EventRow) {
  if (canManageEvent(u, e) || e.created_by === u.id) return true;
  return inAudience(u, e) && (e.status === 'published' || e.status === 'cancelled' || e.poll_open);
}

async function getEvent(id: number) {
  const e = await one<EventRow>('SELECT * FROM events WHERE id = $1', [id]);
  if (!e) throw notFound('Event');
  return e;
}

eventsRouter.get('/', h(async (req, res) => {
  const u = req.user!;
  const rows = await q<EventRow & { alliance_tag: string | null }>(
    `SELECT e.*, a.tag AS alliance_tag, uc.display_name AS created_by_name,
            (SELECT count(*)::int FROM attendance t WHERE t.event_id = e.id AND t.status = 'going') AS going_count
       FROM events e LEFT JOIN alliances a ON a.id = e.alliance_id LEFT JOIN users uc ON uc.id = e.created_by
      WHERE ($1::text IS NULL OR e.type = $1)
      ORDER BY e.starts_at NULLS LAST, e.id DESC LIMIT 500`, [req.query.type ?? null]);
  const visible = rows.filter((e) => canSee(u, e)).map((e) => ({ ...e, can_manage: canManageEvent(u, e) }));
  res.json({ events: visible });
}));

const base = {
  type: z.enum(['castle', 'kvk', 'alliance', 'other']),
  title: z.string().trim().min(2).max(120),
  description: z.string().max(4000).default(''),
  starts_at: z.string().datetime({ offset: true }).nullable().default(null),
  duration_minutes: z.number().int().min(5).max(60 * 24 * 14).default(60),
  poll_open: z.boolean().default(false),
};

eventsRouter.post('/', h(async (req, res) => {
  const u = req.user!;
  const b = z.object({ ...base, scope: z.enum(['kingdom', 'alliance']), alliance_id: z.number().int().positive().nullable().default(null) })
    .parse(req.body);
  let status: EventRow['status'] = 'draft';
  if (b.scope === 'kingdom') {
    b.alliance_id = null;
    if (!has(u, 'event_manager')) {
      // R4/R5 can propose kingdom events; an authorised officer must publish them.
      if (!(u.alliance_id && isAllianceLeader(u, u.alliance_id))) throw forbidden('Only kingdom event managers or alliance R4/R5 can create kingdom events.');
      status = 'proposed';
    }
  } else {
    if (!b.alliance_id) b.alliance_id = u.alliance_id;
    if (!b.alliance_id) throw bad('Choose an alliance.');
    assert(canManageEvent(u, { scope: 'alliance', alliance_id: b.alliance_id }), 'Only R4/R5 of this alliance can create its events.');
  }
  const e = await one<EventRow>(
    `INSERT INTO events (scope, alliance_id, type, title, description, status, starts_at, duration_minutes, poll_open, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [b.scope, b.alliance_id, b.type, b.title, b.description, status, b.starts_at, b.duration_minutes, b.poll_open, u.id]);
  await audit(u.id, status === 'proposed' ? 'propose' : 'create', 'event', e!.id, { title: b.title, scope: b.scope }, b.alliance_id);
  if (status === 'proposed') {
    const managers = await q<{ id: number }>(
      `SELECT DISTINCT u.id FROM users u LEFT JOIN user_permissions p ON p.user_id = u.id
        WHERE u.deleted_at IS NULL AND (u.kingdom_role = 'admin' OR p.permission = 'event_manager')`);
    await notifyUsers(managers.map((m) => m.id), { kind: 'event_proposed', tkey: 'event_proposed',
      params: { title: b.title, name: u.display_name }, link: `/events/${e!.id}`, eventId: e!.id });
  }
  res.status(201).json({ event: e });
}));

eventsRouter.get('/:id', h(async (req, res) => {
  const u = req.user!;
  const e = await getEvent(intParam(req.params.id));
  if (!canSee(u, e)) throw notFound('Event');
  const manage = canManageEvent(u, e);
  const slots = await q(
    `SELECT s.id, s.starts_at, count(a.user_id)::int AS votes,
            bool_or(a.user_id = $2) AS mine
       FROM event_slots s LEFT JOIN availability a ON a.slot_id = s.id
      WHERE s.event_id = $1 GROUP BY s.id ORDER BY s.starts_at`, [e.id, u.id]);
  const attendance = manage
    ? await q(`SELECT t.user_id, u.display_name, u.ingame_name, t.status, t.assignment, t.updated_at
                 FROM attendance t JOIN users u ON u.id = t.user_id WHERE t.event_id = $1 ORDER BY u.display_name`, [e.id])
    : await q(`SELECT t.user_id, u.display_name, t.status, t.assignment FROM attendance t JOIN users u ON u.id = t.user_id
                WHERE t.event_id = $1 AND t.status IN ('going','attended') ORDER BY u.display_name`, [e.id]);
  const mine = await one('SELECT status, assignment FROM attendance WHERE event_id = $1 AND user_id = $2', [e.id, u.id]);
  const history = await q(
    `SELECT a.action, a.summary, a.created_at, u.display_name AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.record_type = 'event' AND a.record_id = $1 ORDER BY a.created_at DESC LIMIT 50`, [String(e.id)]);
  const alliance = e.alliance_id ? await one('SELECT id, tag, name FROM alliances WHERE id = $1', [e.alliance_id]) : null;
  res.json({
    event: e, alliance, slots, attendance, my_attendance: mine, history,
    viewer: { can_manage: manage, can_respond: inAudience(u, e), is_proposer: e.created_by === u.id },
  });
}));

eventsRouter.patch('/:id', h(async (req, res) => {
  const u = req.user!;
  const e = await getEvent(intParam(req.params.id));
  const proposerEditing = e.status === 'proposed' && e.created_by === u.id;
  assert(canManageEvent(u, e) || proposerEditing, 'You cannot edit this event.');
  if (e.status === 'cancelled') throw bad('Cancelled events cannot be edited.');
  const b = z.object(base).partial().parse(req.body);
  const updated = await one<EventRow>(
    `UPDATE events SET type = COALESCE($2,type), title = COALESCE($3,title), description = COALESCE($4,description),
            starts_at = CASE WHEN $5 THEN $6::timestamptz ELSE starts_at END,
            duration_minutes = COALESCE($7,duration_minutes), poll_open = COALESCE($8,poll_open), updated_at = now()
      WHERE id = $1 RETURNING *`,
    [e.id, b.type ?? null, b.title ?? null, b.description ?? null, b.starts_at !== undefined, b.starts_at ?? null,
      b.duration_minutes ?? null, b.poll_open ?? null]);
  const rescheduled = e.status === 'published' && b.starts_at !== undefined &&
    String(e.starts_at?.toISOString()) !== String(updated!.starts_at?.toISOString());
  await audit(u.id, rescheduled ? 'reschedule' : 'update', 'event', e.id,
    { change: b, ...(rescheduled ? { from: e.starts_at, to: updated!.starts_at } : {}) }, e.alliance_id);
  if (rescheduled) await announceChange(updated!, 'event_changed', 'event_changed');
  res.json({ event: updated });
}));

eventsRouter.post('/:id/publish', h(async (req, res) => {
  const u = req.user!;
  const e = await getEvent(intParam(req.params.id));
  assert(canManageEvent(u, e), e.scope === 'kingdom'
    ? 'Only authorised kingdom event managers can publish kingdom events.' : 'You cannot publish this event.');
  if (!['draft', 'proposed'].includes(e.status)) throw bad('Only draft or proposed events can be published.');
  if (!e.starts_at) throw bad('Set a confirmed start time before publishing.');
  const updated = await one<EventRow>(
    `UPDATE events SET status = 'published', approved_by = $2, poll_open = FALSE, updated_at = now() WHERE id = $1 RETURNING *`, [e.id, u.id]);
  await audit(u.id, 'publish', 'event', e.id, { title: e.title }, e.alliance_id);
  await announceChange(updated!, 'event_published', e.scope === 'kingdom' ? 'event_published_kingdom' : 'event_published_alliance');
  res.json({ event: updated });
}));

eventsRouter.post('/:id/cancel', h(async (req, res) => {
  const u = req.user!;
  const e = await getEvent(intParam(req.params.id));
  const ownProposal = e.status === 'proposed' && e.created_by === u.id;
  assert(canManageEvent(u, e) || ownProposal, 'You cannot cancel this event.');
  const { reason } = z.object({ reason: z.string().max(500).default('') }).parse(req.body ?? {});
  if (e.status === 'cancelled') throw bad('This event is already cancelled.');
  const updated = await one<EventRow>(`UPDATE events SET status = 'cancelled', poll_open = FALSE, updated_at = now() WHERE id = $1 RETURNING *`, [e.id]);
  await audit(u.id, 'cancel', 'event', e.id, { reason, previous_status: e.status }, e.alliance_id);
  if (e.status === 'published') await announceChange(updated!, 'event_cancelled', 'event_cancelled', reason);
  res.json({ event: updated });
}));

// ---------- Availability polls ----------
eventsRouter.post('/:id/slots', h(async (req, res) => {
  const e = await getEvent(intParam(req.params.id));
  assert(canManageEvent(req.user!, e));
  const b = z.object({ starts_at: z.array(z.string().datetime({ offset: true })).min(1).max(20) }).parse(req.body);
  for (const s of b.starts_at) await q('INSERT INTO event_slots (event_id, starts_at) VALUES ($1,$2)', [e.id, s]);
  await q('UPDATE events SET poll_open = TRUE WHERE id = $1 AND status IN (\'draft\',\'proposed\')', [e.id]);
  await audit(req.user!.id, 'add_slots', 'event', e.id, { slots: b.starts_at }, e.alliance_id);
  res.status(201).json({ ok: true });
}));

eventsRouter.delete('/:id/slots/:slotId', h(async (req, res) => {
  const e = await getEvent(intParam(req.params.id));
  assert(canManageEvent(req.user!, e));
  await q('DELETE FROM event_slots WHERE id = $1 AND event_id = $2', [intParam(req.params.slotId), e.id]);
  res.json({ ok: true });
}));

eventsRouter.put('/:id/availability', h(async (req, res) => {
  const u = req.user!;
  const e = await getEvent(intParam(req.params.id));
  if (!inAudience(u, e) || !canSee(u, e)) throw notFound('Event');
  if (!e.poll_open) throw bad('This availability poll is closed.');
  const { slot_ids } = z.object({ slot_ids: z.array(z.number().int().positive()).max(20) }).parse(req.body);
  await tx(async (c) => {
    await c.query('DELETE FROM availability WHERE event_id = $1 AND user_id = $2', [e.id, u.id]);
    for (const s of slot_ids) {
      const ok = (await c.query('SELECT 1 FROM event_slots WHERE id = $1 AND event_id = $2', [s, e.id])).rowCount;
      if (!ok) throw bad('One of the selected times does not belong to this event.');
      await c.query('INSERT INTO availability (event_id, slot_id, user_id) VALUES ($1,$2,$3)', [e.id, s, u.id]);
    }
  });
  res.json({ ok: true });
}));

eventsRouter.get('/:id/availability', h(async (req, res) => {
  const e = await getEvent(intParam(req.params.id));
  assert(canManageEvent(req.user!, e));
  res.json({ responses: await q(
    `SELECT a.slot_id, u.id AS user_id, u.display_name, u.time_zone FROM availability a JOIN users u ON u.id = a.user_id
      WHERE a.event_id = $1 ORDER BY u.display_name`, [e.id]) });
}));

eventsRouter.post('/:id/confirm-slot', h(async (req, res) => {
  const e = await getEvent(intParam(req.params.id));
  assert(canManageEvent(req.user!, e));
  const { slot_id } = z.object({ slot_id: z.number().int().positive() }).parse(req.body);
  const s = await one<{ starts_at: Date }>('SELECT starts_at FROM event_slots WHERE id = $1 AND event_id = $2', [slot_id, e.id]);
  if (!s) throw notFound('Time slot');
  await q('UPDATE events SET starts_at = $2, poll_open = FALSE, updated_at = now() WHERE id = $1', [e.id, s.starts_at]);
  await audit(req.user!.id, 'confirm_slot', 'event', e.id, { starts_at: s.starts_at }, e.alliance_id);
  res.json({ ok: true });
}));

// ---------- Attendance & assignments ----------
eventsRouter.put('/:id/attendance', h(async (req, res) => {
  const u = req.user!;
  const e = await getEvent(intParam(req.params.id));
  if (!inAudience(u, e) || e.status !== 'published') throw bad('You can only respond to published events for your kingdom or alliance.');
  const { status } = z.object({ status: z.enum(['going', 'maybe', 'not_going']) }).parse(req.body);
  await q(`INSERT INTO attendance (event_id, user_id, status) VALUES ($1,$2,$3)
           ON CONFLICT (event_id, user_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()`, [e.id, u.id, status]);
  res.json({ ok: true });
}));

eventsRouter.put('/:id/attendance/:userId', h(async (req, res) => {
  const e = await getEvent(intParam(req.params.id));
  assert(canManageEvent(req.user!, e));
  const userId = intParam(req.params.userId);
  const b = z.object({ status: z.enum(['going', 'maybe', 'not_going', 'attended', 'absent']).optional(), assignment: z.string().max(200).optional() })
    .parse(req.body);
  await q(`INSERT INTO attendance (event_id, user_id, status, assignment) VALUES ($1,$2,COALESCE($3,'going'),COALESCE($4,''))
           ON CONFLICT (event_id, user_id) DO UPDATE SET status = COALESCE($3, attendance.status),
             assignment = COALESCE($4, attendance.assignment), updated_at = now()`,
    [e.id, userId, b.status ?? null, b.assignment ?? null]);
  await audit(req.user!.id, 'set_attendance', 'event', e.id, { user_id: userId, ...b }, e.alliance_id);
  if (b.assignment) {
    await notifyUsers([userId], { kind: 'assignment', tkey: 'assignment', params: { title: e.title, assignment: b.assignment }, link: `/events/${e.id}`, eventId: e.id });
  }
  res.json({ ok: true });
}));

async function announceChange(e: EventRow, kind: string, tkey: string, reason = '') {
  const time = e.starts_at ? e.starts_at.toISOString().replace('T', ' ').slice(0, 16) : '—';
  const msg = { kind, tkey, params: { title: e.title, time, reason }, link: `/events/${e.id}`, eventId: e.id };
  await notifyUsers(await audienceFor(e.scope, e.alliance_id), msg);
  if (e.scope === 'kingdom') await notifyDiscordChannel(msg);
}
