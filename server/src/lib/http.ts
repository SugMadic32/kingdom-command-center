import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const forbidden = (msg = 'You do not have permission to do this.') => new HttpError(403, msg);
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found.`);
export const bad = (msg: string) => new HttpError(400, msg);

/** Wrap an async route so thrown errors reach the error handler. */
export const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

export const intParam = (v: string | undefined) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad('Invalid id.');
  return n;
};

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return res.status(400).json({ error: `${first.path.join('.') || 'input'}: ${first.message}` });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
  if (err?.code === '23505') return res.status(409).json({ error: 'That value is already in use.' });
  if (err?.code === '23503') return res.status(400).json({ error: 'A referenced record does not exist.' });
  if (err?.code === '23514') return res.status(400).json({ error: 'A value is outside the allowed range.' });
  console.error(err);
  res.status(500).json({ error: 'Server error. The action was not completed.' });
}
