import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q, one, tx } from '../lib/db.js';
import { h, bad, HttpError } from '../lib/http.js';
import { createSession, destroySession, requireAuth, sha256 } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { emailConfigured } from '../lib/email.js';

export const authRouter = Router();

const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Wait 15 minutes and try again.' } });

const password = z.string().min(10, 'must be at least 10 characters').max(200);
const email = z.string().trim().toLowerCase().email().max(200);

authRouter.post('/register', limiter, h(async (req, res) => {
  const b = z.object({
    email, password,
    display_name: z.string().trim().min(2).max(40),
    ingame_name: z.string().trim().max(40).optional(),
    time_zone: z.string().max(60).optional(),
    language: z.enum(['en', 'ko', 'fr', 'id']).optional(),
  }).parse(req.body);
  if (b.time_zone && !validTimeZone(b.time_zone)) throw bad('time_zone: unknown time zone');

  const hash = await bcrypt.hash(b.password, 12);
  const user = await tx(async (c) => {
    // The first account becomes the kingdom admin (project owner). Locked to avoid a race.
    await c.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const count = (await c.query('SELECT count(*)::int AS n FROM users')).rows[0].n as number;
    const setting = (await c.query(`SELECT value FROM integration_settings WHERE key = 'kingdom'`)).rows[0]?.value;
    const share = setting?.share_default !== false;
    const emailOn = setting?.email_default !== false;
    const r = await c.query(
      `INSERT INTO users (email, password_hash, display_name, ingame_name, time_zone, kingdom_role, language, share_inventory, share_buildings, notify_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) RETURNING id, kingdom_role`,
      [b.email, hash, b.display_name, b.ingame_name || null, b.time_zone ?? 'UTC', count === 0 ? 'admin' : 'member', b.language ?? 'en', share, emailOn],
    );
    return r.rows[0] as { id: number; kingdom_role: string };
  });
  await audit(user.id, 'register', 'user', user.id, { role: user.kingdom_role });
  await createSession(res, user.id);
  res.status(201).json({ ok: true });
}));

authRouter.post('/login', limiter, h(async (req, res) => {
  const b = z.object({ email, password: z.string().max(200) }).parse(req.body);
  const u = await one<{ id: number; password_hash: string }>(
    'SELECT id, password_hash FROM users WHERE email = $1 AND deleted_at IS NULL', [b.email]);
  // Same response for unknown email and wrong password
  if (!u || !u.password_hash || !(await bcrypt.compare(b.password, u.password_hash))) {
    throw new HttpError(401, 'Email or password is incorrect.');
  }
  await createSession(res, u.id);
  res.json({ ok: true });
}));

authRouter.post('/logout', h(async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
}));

authRouter.get('/me', h(async (req, res) => {
  res.json({ user: req.user ?? null });
}));

/** Public: tells the sign-up page whether new members share resources with leaders by default. */
authRouter.get('/signup-info', h(async (_req, res) => {
  const s = await one<{ value: any }>(`SELECT value FROM integration_settings WHERE key = 'kingdom'`);
  res.json({ share_default: s?.value?.share_default !== false, email_default: s?.value?.email_default !== false && emailConfigured() });
}));

authRouter.post('/change-password', requireAuth, h(async (req, res) => {
  const b = z.object({ current: z.string().max(200), next: password }).parse(req.body);
  const u = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [req.user!.id]);
  if (!u || !(await bcrypt.compare(b.current, u.password_hash))) throw bad('Current password is incorrect.');
  await q('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user!.id, await bcrypt.hash(b.next, 12)]);
  // Sign out other devices
  await q('DELETE FROM sessions WHERE user_id = $1', [req.user!.id]);
  await createSession(res, req.user!.id);
  await audit(req.user!.id, 'change_password', 'user', req.user!.id);
  res.json({ ok: true });
}));

/** Account recovery: admin-issued one-time reset link (see Admin › Members). */
authRouter.post('/reset-password', limiter, h(async (req, res) => {
  const b = z.object({ token: z.string().min(20).max(200), password }).parse(req.body);
  const r = await one<{ user_id: number }>(
    `SELECT user_id FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [sha256(b.token)]);
  if (!r) throw bad('This reset link is invalid or has expired. Ask an admin for a new one.');
  await q('UPDATE password_resets SET used_at = now() WHERE token_hash = $1', [sha256(b.token)]);
  await q('UPDATE users SET password_hash = $2 WHERE id = $1', [r.user_id, await bcrypt.hash(b.password, 12)]);
  await q('DELETE FROM sessions WHERE user_id = $1', [r.user_id]);
  await audit(r.user_id, 'reset_password', 'user', r.user_id);
  res.json({ ok: true });
}));

export function validTimeZone(tz: string) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}
