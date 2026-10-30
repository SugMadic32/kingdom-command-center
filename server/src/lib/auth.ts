import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { q, one } from './db.js';
import { config } from './config.js';
import { HttpError, forbidden } from './http.js';

export type Permission =
  | 'event_manager' | 'data_curator' | 'alliance_manager' | 'announcement_manager' | 'integration_manager' | 'appointment_manager';

export interface SessionUser {
  id: number;
  email: string;
  display_name: string;
  ingame_name: string | null;
  kingdom_role: 'member' | 'officer' | 'admin';
  time_zone: string;
  language: string;
  permissions: Permission[];
  alliance_id: number | null;
  alliance_rank: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: SessionUser } }
}

export const COOKIE = 'kc_sid';
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export async function createSession(res: Response, userId: number) {
  const token = randomToken();
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  await q('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [sha256(token), userId, expires]);
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.isProd, expires, path: '/',
  });
}

export async function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[COOKIE];
  if (token) await q('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  res.clearCookie(COOKIE, { path: '/' });
}

export async function loadUserById(id: number): Promise<SessionUser | null> {
  return one<SessionUser>(
    `SELECT u.id, u.email, u.display_name, u.ingame_name, u.kingdom_role, u.time_zone, u.language,
            COALESCE(ARRAY(SELECT permission FROM user_permissions p WHERE p.user_id = u.id), '{}') AS permissions,
            am.alliance_id, am.rank AS alliance_rank
       FROM users u LEFT JOIN alliance_members am ON am.user_id = u.id
      WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [id],
  );
}

/** Attach req.user when a valid session cookie is present. */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE];
    if (token) {
      const s = await one<{ user_id: number }>(
        'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()', [sha256(token)],
      );
      if (s) req.user = (await loadUserById(s.user_id)) ?? undefined;
    }
    next();
  } catch (e) { next(e); }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Sign in to continue.'));
  next();
}

/** Mutating requests must carry this header; cross-site forms cannot set it. */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'kc') return next(forbidden('Missing request header.'));
  next();
}

// ---------- Permission checks (used by every route; never trust the UI) ----------

export const isAdmin = (u: SessionUser) => u.kingdom_role === 'admin';

/** Admins hold every permission; officers and members only what was granted. */
export const has = (u: SessionUser, p: Permission) => isAdmin(u) || u.permissions.includes(p);

export const isAllianceLeader = (u: SessionUser, allianceId: number) =>
  u.alliance_id === allianceId && (u.alliance_rank === 'R4' || u.alliance_rank === 'R5');

/** R4/R5 of that alliance, or a kingdom-level alliance manager. */
export const canManageAlliance = (u: SessionUser, allianceId: number) =>
  isAllianceLeader(u, allianceId) || has(u, 'alliance_manager');

export function assert(cond: boolean, msg?: string) {
  if (!cond) throw forbidden(msg);
}

export function requirePerm(p: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Sign in to continue.'));
    if (!has(req.user, p)) return next(forbidden());
    next();
  };
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Sign in to continue.'));
  if (!isAdmin(req.user)) return next(forbidden('Only the kingdom admin can do this.'));
  next();
}
