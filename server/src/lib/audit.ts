import { q } from './db.js';

/** Record who did what to an important shared record. */
export async function audit(
  actorId: number | null,
  action: string,
  recordType: string,
  recordId: string | number | null,
  summary: Record<string, unknown> = {},
  allianceId: number | null = null,
) {
  await q(
    `INSERT INTO audit_logs (actor_id, action, record_type, record_id, alliance_id, summary)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [actorId, action, recordType, recordId == null ? null : String(recordId), allianceId, summary],
  );
}
