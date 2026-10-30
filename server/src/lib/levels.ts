/** Levels above this are Truegold tiers: 31 = TG1, 32 = TG2, ... */
export const TG_BASE = 30;

export const levelLabel = (n: number) => (n > TG_BASE ? `TG${n - TG_BASE}` : String(n));

/** Accepts "12", "TG3", "tg 3". Returns NaN if it cannot be read. */
export function parseLevel(v: string): number {
  const s = v.trim();
  const tg = /^tg\s*(\d+)$/i.exec(s);
  if (tg) return TG_BASE + Number(tg[1]);
  return /^\d+$/.test(s) ? Number(s) : NaN;
}
