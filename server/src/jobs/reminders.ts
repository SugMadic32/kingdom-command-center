import { q } from '../lib/db.js';
import { notifyUsers, notifyDiscordChannel, deliverPending } from '../lib/notify.js';

/** Queue reminders for upcoming published events, then deliver anything due. */
export async function runReminderCycle() {
  const pairs = await q<{ event_id: number; user_id: number; title: string; starts_at: Date; scope: string }>(
    `SELECT e.id AS event_id, u.id AS user_id, e.title, e.starts_at, e.scope
       FROM events e
       JOIN users u ON u.deleted_at IS NULL
       LEFT JOIN alliance_members am ON am.user_id = u.id
       LEFT JOIN attendance t ON t.event_id = e.id AND t.user_id = u.id
      WHERE e.status = 'published'
        AND e.starts_at > now()
        AND e.starts_at <= now() + make_interval(mins => u.reminder_minutes)
        AND (e.scope = 'kingdom' OR am.alliance_id = e.alliance_id)
        AND COALESCE(t.status, 'going') <> 'not_going'`,
  );
  for (const p of pairs) {
    const mins = Math.max(1, Math.round((p.starts_at.getTime() - Date.now()) / 60000));
    await notifyUsers([p.user_id], {
      kind: 'reminder', tkey: 'reminder', params: { mins, title: p.title }, link: `/events/${p.event_id}`, eventId: p.event_id,
      dedupe: `reminder:${p.event_id}:${p.starts_at.getTime()}`,
    });
  }
  const soon = await q<{ id: number; title: string; starts_at: Date }>(
    `SELECT id, title, starts_at FROM events WHERE status = 'published' AND scope = 'kingdom'
        AND starts_at > now() AND starts_at <= now() + interval '30 minutes'`,
  );
  for (const e of soon) {
    await notifyDiscordChannel({
      kind: 'reminder', title: `Starting soon: ${e.title}`,
      body: `Starts <t:${Math.floor(e.starts_at.getTime() / 1000)}:R>`, link: `/events/${e.id}`, eventId: e.id,
      dedupe: `reminder:${e.id}:${e.starts_at.getTime()}`,
    });
  }
  // King's appointments: remind each holder before their slot
  const appts = await q<{ id: number; user_id: number; slot_start: Date; position: string; schedule: string; schedule_id: number }>(
    `SELECT b.id, b.user_id, b.slot_start, p.name AS position, s.name AS schedule, s.id AS schedule_id
       FROM appointment_bookings b
       JOIN appointment_schedules s ON s.id = b.schedule_id AND s.status <> 'draft'
       JOIN appointment_positions p ON p.id = b.position_id
       JOIN users u ON u.id = b.user_id AND u.deleted_at IS NULL
      WHERE b.slot_start > now() AND b.slot_start <= now() + make_interval(mins => u.reminder_minutes)`,
  );
  for (const a of appts) {
    const mins = Math.max(1, Math.round((a.slot_start.getTime() - Date.now()) / 60000));
    await notifyUsers([a.user_id], {
      kind: 'appointment_reminder', tkey: 'appointment_reminder',
      params: { mins, position: a.position, schedule: a.schedule, time: a.slot_start.toISOString().replace('T', ' ').slice(0, 16) },
      link: `/appointments/${a.schedule_id}`, dedupe: `appt:${a.id}:${a.slot_start.getTime()}`,
    });
  }
  await deliverPending();
}

export function startJobs() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runReminderCycle(); } catch (e) { console.error('[jobs] reminder cycle failed', e); }
    finally { running = false; }
  };
  setInterval(tick, 60_000);
  setTimeout(tick, 5_000);
}
