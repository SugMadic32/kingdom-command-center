import { locale, t, tErr } from './i18n';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: string[]) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'kc' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new ApiError(res.status, data?.error ? tErr(data.error) : t('Request failed ({status}).', { status: res.status }), data?.details);
  return data as T;
}

export const fmtNum = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString(locale()));

/** Show compact resource amounts like 1.25M while the full value is in the title attribute. */
export function fmtShort(n: number) {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2).replace(/\.?0+$/, '')}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString(locale());
}

export function fmtDuration(seconds: number | null | undefined) {
  if (seconds == null) return t('Unknown');
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  return [d && t('{n}d', { n: d }), h && t('{n}h', { n: h }), (m || (!d && !h)) && t('{n}m', { n: m })].filter(Boolean).join(' ');
}

/** Speedup amounts are stored in minutes. */
export const fmtMinutes = (m: number | null | undefined) => (m == null ? '—' : fmtDuration(Number(m) * 60));

/** Format a canonical UTC time in the member's own time zone. */
export function fmtTime(iso: string | null | undefined, tz: string, withZone = true) {
  if (!iso) return t('Time not set');
  return new Intl.DateTimeFormat(locale(), {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    ...(withZone ? { timeZoneName: 'short' } : {}),
  }).format(new Date(iso));
}
export const fmtUtc = (iso: string | null | undefined) => (iso ? fmtTime(iso, 'UTC') : t('Time not set'));
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—';

/** Convert a value from <input type="datetime-local"> interpreted in tz into an ISO UTC string. */
export function localInputToIso(value: string, tz: string): string {
  const [d, t] = value.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, hh, mm);
  const offset = tzOffsetMinutes(new Date(guess), tz);
  let utc = guess - offset * 60_000;
  const offset2 = tzOffsetMinutes(new Date(utc), tz);   // handle DST edges
  if (offset2 !== offset) utc = guess - offset2 * 60_000;
  return new Date(utc).toISOString();
}

/** ISO UTC string → "YYYY-MM-DDTHH:mm" in tz for datetime-local inputs. */
export function isoToLocalInput(iso: string | null, tz: string) {
  if (!iso) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function tzOffsetMinutes(date: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

export const timeZones: string[] = (() => {
  try { return (Intl as any).supportedValuesOf('timeZone') as string[]; } catch { return ['UTC', 'Asia/Bangkok', 'Europe/London', 'America/New_York']; }
})();

export function download(path: string) {
  window.location.href = `/api${path}`;
}
