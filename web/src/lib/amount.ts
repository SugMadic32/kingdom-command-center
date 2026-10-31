import { locale } from './i18n';

/** Multipliers people type after a number: 295M, 1.5B, 250K, 3억, 500만, 2jt (Indonesian juta), 1,5Md (French milliard). */
const UNITS: Record<string, number> = {
  k: 1e3, m: 1e6, b: 1e9, t: 1e12, md: 1e9, jt: 1e6, rb: 1e3, '천': 1e3, '만': 1e4, '억': 1e8,
};

/** Returns a whole number, or NaN when the text cannot be read. */
export function parseAmount(raw: string): number {
  let s = String(raw ?? '').trim().toLowerCase().replace(/[\s_']/g, '');
  if (s === '') return 0;
  const m = /^([\d.,]+)([a-z가-힣]*)$/.exec(s);
  if (!m) return NaN;
  let num = m[1];
  const unit = m[2];
  if (unit && !(unit in UNITS)) return NaN;
  // With a unit, a single comma is a decimal mark (1,5M). Otherwise commas/dots group thousands (1,234,567 or 1.234.567).
  if (unit && (num.match(/,/g) ?? []).length === 1 && !num.includes('.')) num = num.replace(',', '.');
  else if (!unit && (num.match(/\./g) ?? []).length > 1) num = num.replace(/\./g, '');
  else num = num.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(num)) return NaN;
  const value = Number(num) * (unit ? UNITS[unit] : 1);
  return Number.isFinite(value) ? Math.round(value) : NaN;
}

/** "295,000,000 (295 million)" in the member's language. */
export function describeAmount(n: number) {
  const full = n.toLocaleString(locale());
  if (n < 1000) return full;
  const word = new Intl.NumberFormat(locale(), { notation: 'compact', compactDisplay: 'long', maximumFractionDigits: 2 }).format(n);
  return `${full} (${word})`;
}
