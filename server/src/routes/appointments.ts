import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../lib/db.js';
import { h, bad, intParam, notFound, forbidden } from '../lib/http.js';
import { requireAuth, requirePerm, has, type SessionUser } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { notifyUsers } from '../lib/notify.js';
import { toCsv } from '../lib/csv.js';

export const appointmentsRouter = Router();
appointmentsRouter.use(requireAuth);
const manager = requirePerm('appointment_manager');
const canManage = (u: SessionUser) => has(u, 'appointment_manager');
const MAX_SLOTS = 2000;

interface Schedule {
  id: number; name: string; starts_at: Date; ends_at: Date; slot_minutes: number;
  max_per_member: number | null; status: 'draft' | 'open' | 'closed'; notes: string; mode: 'apply' | 'first_come';
}

async function getSchedule(id: number) {
  const s = await one<Schedule>('SELECT * FROM appointment_schedules WHERE id = $1', [id]);
  if (!s) throw notFound('Appointment schedule');
  return s;
}
const slotCount = (s: Pick<Schedule, 'starts_at' | 'ends_at' | 'slot_minutes'>) =>
  Math.floor((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / (s.slot_minutes * 60_000));
const fmtUtc = (d: Date) => new Date(d).toISOString().replace('T', ' ').slice(0, 16);

/** A slot must start on the schedule's grid, inside its window. */
function checkSlot(s: Schedule, slot: Date) {
  const off = slot.getTime() - new Date(s.starts_at).getTime();
  const len = s.slot_minutes * 60_000;
  if (off < 0 || slot.getTime() + len > new Date(s.ends_at).getTime() || off % len !== 0) {
    throw bad('That time is not one of the slots in this schedule.');
  }
}

// ---------- Positions ----------
appointmentsRouter.get('/positions', h(async (_req, res) => {
  res.json({ positions: await q('SELECT * FROM appointment_positions ORDER BY sort, name') });
}));

const positionSchema = z.object({
  name: z.string().trim().min(1).max(60), buff: z.string().trim().max(200).default(''),
  sort: z.number().int().default(0), active: z.boolean().default(true),
});
appointmentsRouter.post('/positions', manager, h(async (req, res) => {
  const b = positionSchema.parse(req.body);
  const p = await one('INSERT INTO appointment_positions (name, buff, sort, active) VALUES ($1,$2,$3,$4) RETURNING *', [b.name, b.buff, b.sort, b.active]);
  await audit(req.user!.id, 'create', 'appointment_position', p.id, b);
  res.status(201).json({ position: p });
}));
appointmentsRouter.patch('/positions/:id', manager, h(async (req, res) => {
  const id = intParam(req.params.id);
  const b = positionSchema.partial().parse(req.body);
  const before = await one('SELECT * FROM appointment_positions WHERE id = $1', [id]);
  if (!before) throw notFound('Position');
  await q(`UPDATE appointment_positions SET name = COALESCE($2,name), buff = COALESCE($3,buff), sort = COALESCE($4,sort), active = COALESCE($5,active) WHERE id = $1`,
    [id, b.name ?? null, b.buff ?? null, b.sort ?? null, b.active ?? null]);
  await audit(req.user!.id, 'update', 'appointment_position', id, { before, change: b });
  res.json({ ok: true });
}));

appointmentsRouter.delete('/positions/:id', manager, h(async (req, res) => {
  const id = intParam(req.params.id);
  if (await one('SELECT 1 FROM appointment_bookings WHERE position_id = $1 LIMIT 1', [id])) {
    throw bad('This position has bookings. Switch it off instead, or remove its bookings first.');
  }
  const p = await one('DELETE FROM appointment_positions WHERE id = $1 RETURNING *', [id]);
  if (!p) throw notFound('Position');
  await audit(req.user!.id, 'delete', 'appointment_position', id, { before: p });
  res.json({ ok: true });
}));

// ---------- Schedules ----------
appointmentsRouter.get('/schedules', h(async (req, res) => {
  const rows = await q(
    `SELECT s.*, (SELECT count(*)::int FROM appointment_bookings b WHERE b.schedule_id = s.id) AS booked,
            (SELECT count(*)::int FROM appointment_schedule_positions sp WHERE sp.schedule_id = s.id) AS position_count,
            (SELECT count(*)::int FROM appointment_bookings b WHERE b.schedule_id = s.id AND b.user_id = $1) AS mine
       FROM appointment_schedules s
      WHERE $2 OR s.status <> 'draft'
      ORDER BY s.starts_at DESC`, [req.user!.id, canManage(req.user!)]);
  res.json({ schedules: rows.map((s) => ({ ...s, slots_per_position: slotCount(s) })), can_manage: canManage(req.user!) });
}));

/** The signed-in member's upcoming bookings across all schedules. */
appointmentsRouter.get('/mine', h(async (req, res) => {
  res.json({ bookings: await q(
    `SELECT b.id, b.slot_start, s.slot_minutes, s.name AS schedule, s.id AS schedule_id, p.name AS position, p.buff
       FROM appointment_bookings b JOIN appointment_schedules s ON s.id = b.schedule_id JOIN appointment_positions p ON p.id = b.position_id
      WHERE b.user_id = $1 AND b.slot_start + make_interval(mins => s.slot_minutes) > now()
      ORDER BY b.slot_start LIMIT 20`, [req.user!.id]),
    applications: await q(
    `SELECT a.id, a.slot_start, s.name AS schedule, s.id AS schedule_id, p.name AS position
       FROM appointment_applications a JOIN appointment_schedules s ON s.id = a.schedule_id JOIN appointment_positions p ON p.id = a.position_id
      WHERE a.user_id = $1 AND a.slot_start > now()
        AND NOT EXISTS (SELECT 1 FROM appointment_bookings b WHERE b.schedule_id = a.schedule_id AND b.position_id = a.position_id AND b.slot_start = a.slot_start)
      ORDER BY a.slot_start LIMIT 20`, [req.user!.id]) });
}));

const scheduleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  slot_minutes: z.number().int().min(5).max(1440),
  max_per_member: z.number().int().min(1).max(500).nullable().default(null),
  position_ids: z.array(z.number().int().positive()).min(1).max(50),
  notes: z.string().max(2000).default(''),
  mode: z.enum(['apply', 'first_come']).default('apply'),
});

function validateWindow(b: { starts_at: string | Date; ends_at: string | Date; slot_minutes: number }) {
  const start = new Date(b.starts_at).getTime(), end = new Date(b.ends_at).getTime();
  if (end <= start) throw bad('End must be after start.');
  const n = Math.floor((end - start) / (b.slot_minutes * 60_000));
  if (n < 1) throw bad('The schedule is shorter than one slot.');
  if (n > MAX_SLOTS) throw bad('Too many slots. Use longer slots or a shorter schedule.');
  if ((end - start) % (b.slot_minutes * 60_000) !== 0) throw bad('The schedule length must be a whole number of slots.');
}

appointmentsRouter.post('/schedules', manager, h(async (req, res) => {
  const b = scheduleSchema.parse(req.body);
  validateWindow(b);
  const s = await tx(async (c) => {
    const row = (await c.query(
      `INSERT INTO appointment_schedules (name, starts_at, ends_at, slot_minutes, max_per_member, notes, created_by, mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [b.name, b.starts_at, b.ends_at, b.slot_minutes, b.max_per_member, b.notes, req.user!.id, b.mode])).rows[0];
    for (const pid of new Set(b.position_ids)) {
      await c.query('INSERT INTO appointment_schedule_positions (schedule_id, position_id) VALUES ($1,$2)', [row.id, pid]);
    }
    return row;
  });
  await audit(req.user!.id, 'create', 'appointment_schedule', s.id, { name: b.name, slots: slotCount(s) });
  res.status(201).json({ schedule: s });
}));

appointmentsRouter.patch('/schedules/:id', manager, h(async (req, res) => {
  const s = await getSchedule(intParam(req.params.id));
  const b = scheduleSchema.partial().extend({ status: z.enum(['draft', 'open', 'closed']).optional() }).parse(req.body);
  const next = { starts_at: b.starts_at ?? s.starts_at, ends_at: b.ends_at ?? s.ends_at, slot_minutes: b.slot_minutes ?? s.slot_minutes };
  const timingChanged = b.starts_at !== undefined || b.ends_at !== undefined || b.slot_minutes !== undefined;
  if (timingChanged) {
    validateWindow(next);
    // Existing bookings must still fit the new grid
    const bookings = await q<{ slot_start: Date }>('SELECT slot_start FROM appointment_bookings WHERE schedule_id = $1', [s.id]);
    for (const bk of bookings) {
      try { checkSlot({ ...s, ...next, starts_at: new Date(next.starts_at), ends_at: new Date(next.ends_at) }, new Date(bk.slot_start)); }
      catch { throw bad('Some bookings would no longer fit. Remove them first or keep the same slot times.'); }
    }
  }
  if (b.position_ids) {
    const removedWithBookings = await one(
      `SELECT 1 FROM appointment_bookings WHERE schedule_id = $1 AND NOT (position_id = ANY($2)) LIMIT 1`, [s.id, b.position_ids]);
    if (removedWithBookings) throw bad('A position you removed still has bookings. Remove those bookings first.');
  }
  await tx(async (c) => {
    await c.query(
      `UPDATE appointment_schedules SET name = COALESCE($2,name), starts_at = $3, ends_at = $4, slot_minutes = $5,
              max_per_member = CASE WHEN $6 THEN $7 ELSE max_per_member END, notes = COALESCE($8,notes), status = COALESCE($9,status),
              mode = COALESCE($10,mode)
        WHERE id = $1`,
      [s.id, b.name ?? null, next.starts_at, next.ends_at, next.slot_minutes, b.max_per_member !== undefined, b.max_per_member ?? null,
        b.notes ?? null, b.status ?? null, b.mode ?? null]);
    if (b.position_ids) {
      await c.query('DELETE FROM appointment_schedule_positions WHERE schedule_id = $1', [s.id]);
      for (const pid of new Set(b.position_ids)) await c.query('INSERT INTO appointment_schedule_positions (schedule_id, position_id) VALUES ($1,$2)', [s.id, pid]);
    }
  });
  await audit(req.user!.id, b.status && b.status !== s.status ? `status_${b.status}` : 'update', 'appointment_schedule', s.id, { change: b });
  res.json({ ok: true });
}));

appointmentsRouter.delete('/schedules/:id', manager, h(async (req, res) => {
  const s = await getSchedule(intParam(req.params.id));
  const affected = await q<{ user_id: number; slot_start: Date; position: string }>(
    `SELECT b.user_id, b.slot_start, p.name AS position FROM appointment_bookings b JOIN appointment_positions p ON p.id = b.position_id
      WHERE b.schedule_id = $1 AND b.slot_start > now()`, [s.id]);
  await q('DELETE FROM appointment_schedules WHERE id = $1', [s.id]);
  for (const a of affected) {
    await notifyUsers([a.user_id], { kind: 'appointment_removed', tkey: 'appointment_removed',
      params: { position: a.position, schedule: s.name, time: fmtUtc(a.slot_start) }, link: '/appointments' });
  }
  await audit(req.user!.id, 'delete', 'appointment_schedule', s.id, { name: s.name, bookings_removed: affected.length });
  res.json({ ok: true });
}));

appointmentsRouter.get('/schedules/:id', h(async (req, res) => {
  const u = req.user!;
  const s = await getSchedule(intParam(req.params.id));
  if (s.status === 'draft' && !canManage(u)) throw notFound('Appointment schedule');
  const positions = await q(
    `SELECT p.* FROM appointment_schedule_positions sp JOIN appointment_positions p ON p.id = sp.position_id
      WHERE sp.schedule_id = $1 ORDER BY p.sort, p.name`, [s.id]);
  const bookings = await q(
    `SELECT b.id, b.position_id, b.slot_start, b.user_id, b.note, u.display_name, u.ingame_name, a.tag AS alliance_tag
       FROM appointment_bookings b JOIN users u ON u.id = b.user_id
       LEFT JOIN alliance_members am ON am.user_id = u.id LEFT JOIN alliances a ON a.id = am.alliance_id
      WHERE b.schedule_id = $1 ORDER BY b.slot_start`, [s.id]);
  const mgr = canManage(u);
  // Managers see every applicant; members see counts and their own applications only.
  const applications = await q(
    `SELECT a.id, a.position_id, a.slot_start, a.user_id, a.created_at, u.display_name, u.ingame_name, al.tag AS alliance_tag
       FROM appointment_applications a JOIN users u ON u.id = a.user_id
       LEFT JOIN alliance_members am ON am.user_id = u.id LEFT JOIN alliances al ON al.id = am.alliance_id
      WHERE a.schedule_id = $1 AND ($2 OR a.user_id = $3) ORDER BY a.created_at`, [s.id, mgr, u.id]);
  const counts = await q(
    `SELECT position_id, slot_start, count(*)::int AS n FROM appointment_applications WHERE schedule_id = $1 GROUP BY position_id, slot_start`, [s.id]);
  const slots: string[] = [];
  for (let i = 0; i < slotCount(s); i++) slots.push(new Date(new Date(s.starts_at).getTime() + i * s.slot_minutes * 60_000).toISOString());
  res.json({
    schedule: s, positions, slots, bookings, applications, application_counts: counts,
    viewer: { can_manage: canManage(u), my_count: bookings.filter((b) => b.user_id === u.id).length },
  });
}));

/** Members who can be assigned (managers only). */
appointmentsRouter.get('/members', manager, h(async (req, res) => {
  const term = `%${String(req.query.q ?? '').slice(0, 40)}%`;
  res.json({ users: await q(
    `SELECT u.id, u.display_name, u.ingame_name, a.tag AS alliance_tag FROM users u
       LEFT JOIN alliance_members am ON am.user_id = u.id LEFT JOIN alliances a ON a.id = am.alliance_id
      WHERE u.deleted_at IS NULL AND (u.display_name ILIKE $1 OR u.ingame_name ILIKE $1)
      ORDER BY u.display_name LIMIT 25`, [term]) });
}));

// ---------- Bookings ----------
appointmentsRouter.post('/schedules/:id/bookings', h(async (req, res) => {
  const u = req.user!;
  const s = await getSchedule(intParam(req.params.id));
  const b = z.object({
    position_id: z.number().int().positive(), slot_start: z.string().datetime({ offset: true }),
    user_id: z.number().int().positive().optional(), note: z.string().max(200).default(''),
  }).parse(req.body);
  const mgr = canManage(u);
  const target = b.user_id ?? u.id;
  if (target !== u.id && !mgr) throw forbidden('Only appointment managers can book for other members.');
  const slot = new Date(b.slot_start);
  checkSlot(s, slot);
  if (!(await one('SELECT 1 FROM appointment_schedule_positions WHERE schedule_id = $1 AND position_id = $2', [s.id, b.position_id]))) {
    throw bad('That position is not part of this schedule.');
  }
  if (!mgr) {
    if (s.mode === 'apply') throw bad('In this schedule members apply and the King chooses. Use Apply.');
    if (s.status !== 'open') throw bad('Booking is not open for this schedule.');
    if (slot.getTime() <= Date.now()) throw bad('This slot has already started.');
    if (s.max_per_member) {
      const n = await one<{ n: number }>('SELECT count(*)::int AS n FROM appointment_bookings WHERE schedule_id = $1 AND user_id = $2', [s.id, u.id]);
      if ((n?.n ?? 0) >= s.max_per_member) throw bad('You have reached the booking limit for this schedule.');
    }
  }
  if (!(await one('SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL', [target]))) throw notFound('Member');
  let row;
  try {
    row = await one(
      `INSERT INTO appointment_bookings (schedule_id, position_id, slot_start, user_id, booked_by, note)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [s.id, b.position_id, slot, target, u.id, b.note]);
  } catch (e: any) {
    if (e?.code === '23505') {
      throw bad(String(e.constraint ?? '').includes('user_id')
        ? 'That member already holds another position at this time.'
        : 'Someone already booked this slot. Pick another one.');
    }
    throw e;
  }
  const pos = await one<{ name: string }>('SELECT name FROM appointment_positions WHERE id = $1', [b.position_id]);
  await audit(u.id, 'book', 'appointment_schedule', s.id, { position: pos?.name, slot: slot.toISOString(), user_id: target });
  if (target !== u.id) {
    await notifyUsers([target], { kind: 'appointment_assigned', tkey: 'appointment_assigned',
      params: { position: pos?.name ?? '', schedule: s.name, time: fmtUtc(slot) }, link: `/appointments/${s.id}` });
  }
  res.status(201).json({ booking: row });
}));

appointmentsRouter.delete('/bookings/:id', h(async (req, res) => {
  const u = req.user!;
  const bk = await one<{ id: number; schedule_id: number; user_id: number; slot_start: Date; position: string }>(
    `SELECT b.id, b.schedule_id, b.user_id, b.slot_start, p.name AS position FROM appointment_bookings b
       JOIN appointment_positions p ON p.id = b.position_id WHERE b.id = $1`, [intParam(req.params.id)]);
  if (!bk) throw notFound('Booking');
  const s = await getSchedule(bk.schedule_id);
  const mgr = canManage(u);
  if (bk.user_id !== u.id && !mgr) throw forbidden('You can only cancel your own bookings.');
  if (!mgr && new Date(bk.slot_start).getTime() <= Date.now()) throw bad('This slot has already started.');
  if (!mgr && s.status === 'closed') throw bad('This schedule is closed. Ask an appointment manager.');
  await q('DELETE FROM appointment_bookings WHERE id = $1', [bk.id]);
  await audit(u.id, 'unbook', 'appointment_schedule', s.id, { position: bk.position, slot: new Date(bk.slot_start).toISOString(), user_id: bk.user_id });
  if (bk.user_id !== u.id) {
    await notifyUsers([bk.user_id], { kind: 'appointment_removed', tkey: 'appointment_removed',
      params: { position: bk.position, schedule: s.name, time: fmtUtc(bk.slot_start) }, link: `/appointments/${s.id}` });
  }
  res.json({ ok: true });
}));

// ---------- Applications (game style: apply, then the King approves one) ----------
appointmentsRouter.post('/schedules/:id/applications', h(async (req, res) => {
  const u = req.user!;
  const s = await getSchedule(intParam(req.params.id));
  if (s.status === 'draft' && !canManage(u)) throw notFound('Appointment schedule');
  const b = z.object({ position_id: z.number().int().positive(), slot_start: z.string().datetime({ offset: true }) }).parse(req.body);
  const slot = new Date(b.slot_start);
  checkSlot(s, slot);
  if (s.mode !== 'apply') throw bad('This schedule is first come, first served. Use Book.');
  if (s.status !== 'open') throw bad('Booking is not open for this schedule.');
  if (slot.getTime() <= Date.now()) throw bad('This slot has already started.');
  if (!(await one('SELECT 1 FROM appointment_schedule_positions WHERE schedule_id = $1 AND position_id = $2', [s.id, b.position_id]))) {
    throw bad('That position is not part of this schedule.');
  }
  if (await one('SELECT 1 FROM appointment_bookings WHERE schedule_id = $1 AND position_id = $2 AND slot_start = $3', [s.id, b.position_id, slot])) {
    throw bad('Someone already holds this slot. Pick another one.');
  }
  if (await one('SELECT 1 FROM appointment_bookings WHERE schedule_id = $1 AND user_id = $2 AND slot_start = $3', [s.id, u.id, slot])) {
    throw bad('You already hold a position at this time.');
  }
  if (s.max_per_member) {
    // Approved slots plus open applications count towards the limit
    const n = await one<{ n: number }>(
      `SELECT (SELECT count(*) FROM appointment_bookings WHERE schedule_id = $1 AND user_id = $2) +
              (SELECT count(*) FROM appointment_applications a WHERE a.schedule_id = $1 AND a.user_id = $2
                 AND NOT EXISTS (SELECT 1 FROM appointment_bookings x WHERE x.schedule_id = a.schedule_id AND x.position_id = a.position_id AND x.slot_start = a.slot_start)) AS n`,
      [s.id, u.id]);
    if (Number(n?.n ?? 0) >= s.max_per_member) throw bad('You have reached the booking limit for this schedule.');
  }
  try {
    const row = await one(
      'INSERT INTO appointment_applications (schedule_id, position_id, slot_start, user_id) VALUES ($1,$2,$3,$4) RETURNING *',
      [s.id, b.position_id, slot, u.id]);
    await audit(u.id, 'apply', 'appointment_schedule', s.id, { position_id: b.position_id, slot: slot.toISOString() });
    res.status(201).json({ application: row });
  } catch (e: any) {
    if (e?.code === '23505') throw bad('You already applied for this slot.');
    throw e;
  }
}));

appointmentsRouter.delete('/applications/:id', h(async (req, res) => {
  const a = await one<{ id: number; user_id: number; schedule_id: number }>('SELECT id, user_id, schedule_id FROM appointment_applications WHERE id = $1', [intParam(req.params.id)]);
  if (!a) throw notFound('Application');
  if (a.user_id !== req.user!.id && !canManage(req.user!)) throw forbidden('You can only withdraw your own applications.');
  await q('DELETE FROM appointment_applications WHERE id = $1', [a.id]);
  await audit(req.user!.id, 'withdraw', 'appointment_schedule', a.schedule_id, { application_id: a.id, user_id: a.user_id });
  res.json({ ok: true });
}));

/** The King or a manager picks one applicant. Other applications stay, so the slot can be reassigned later. */
appointmentsRouter.post('/applications/:id/approve', manager, h(async (req, res) => {
  const a = await one<{ id: number; user_id: number; schedule_id: number; position_id: number; slot_start: Date }>(
    'SELECT * FROM appointment_applications WHERE id = $1', [intParam(req.params.id)]);
  if (!a) throw notFound('Application');
  const s = await getSchedule(a.schedule_id);
  try {
    await q(`INSERT INTO appointment_bookings (schedule_id, position_id, slot_start, user_id, booked_by) VALUES ($1,$2,$3,$4,$5)`,
      [a.schedule_id, a.position_id, a.slot_start, a.user_id, req.user!.id]);
  } catch (e: any) {
    if (e?.code === '23505') {
      throw bad(String(e.constraint ?? '').includes('user_id')
        ? 'That member already holds another position at this time.'
        : 'Someone already holds this slot. Remove them first.');
    }
    throw e;
  }
  const pos = await one<{ name: string }>('SELECT name FROM appointment_positions WHERE id = $1', [a.position_id]);
  await audit(req.user!.id, 'approve', 'appointment_schedule', s.id, { position: pos?.name, slot: new Date(a.slot_start).toISOString(), user_id: a.user_id });
  await notifyUsers([a.user_id], { kind: 'appointment_assigned', tkey: 'appointment_assigned',
    params: { position: pos?.name ?? '', schedule: s.name, time: fmtUtc(a.slot_start) }, link: `/appointments/${s.id}` });
  res.json({ ok: true });
}));

appointmentsRouter.get('/schedules/:id/export.csv', h(async (req, res) => {
  const s = await getSchedule(intParam(req.params.id));
  if (s.status === 'draft' && !canManage(req.user!)) throw notFound('Appointment schedule');
  const rows = await q<any>(
    `SELECT b.slot_start, p.name AS position, u.display_name, u.ingame_name, a.tag
       FROM appointment_bookings b JOIN appointment_positions p ON p.id = b.position_id JOIN users u ON u.id = b.user_id
       LEFT JOIN alliance_members am ON am.user_id = u.id LEFT JOIN alliances a ON a.id = am.alliance_id
      WHERE b.schedule_id = $1 ORDER BY b.slot_start, p.sort, p.name`, [s.id]);
  const end = (d: Date) => new Date(new Date(d).getTime() + s.slot_minutes * 60_000);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="appointments-${s.id}.csv"`);
  res.send(toCsv([['Start (UTC)', 'End (UTC)', 'Position', 'Player', 'In-game name', 'Alliance'],
    ...rows.map((r) => [fmtUtc(r.slot_start), fmtUtc(end(r.slot_start)), r.position, r.display_name, r.ingame_name ?? '', r.tag ?? ''])]));
}));
