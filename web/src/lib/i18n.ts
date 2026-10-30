import { dict } from './dict';

export type Lang = 'en' | 'ko' | 'fr' | 'id';
export const LANGS: [Lang, string][] = [['en', 'English'], ['ko', '한국어'], ['fr', 'Français'], ['id', 'Bahasa Indonesia']];
const COL: Record<Exclude<Lang, 'en'>, number> = { ko: 0, fr: 1, id: 2 };
const LOCALE: Record<Lang, string> = { en: 'en-GB', ko: 'ko-KR', fr: 'fr-FR', id: 'id-ID' };

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && v in LOCALE;

function detect(): Lang {
  try {
    const saved = localStorage.getItem('kc-lang');
    if (isLang(saved)) return saved;
  } catch { /* storage unavailable */ }
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return isLang(nav) ? nav : 'en';
}

let current: Lang = detect();
document.documentElement.lang = current;

export const getLang = () => current;
export const locale = () => LOCALE[current];

export function setLang(l: Lang) {
  current = l;
  document.documentElement.lang = l;
  try { localStorage.setItem('kc-lang', l); } catch { /* ignore */ }
}

/** Translate an English UI string. Unknown strings fall back to English. */
export function t(en: string, vars?: Record<string, string | number>): string {
  let out = current === 'en' ? en : (dict[en]?.[COL[current]] ?? en);
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
  return out;
}

/** Translate a message that came from the server, when we know it. */
export function tErr(msg: string): string {
  if (dict[msg]) return t(msg);
  const nf = /^(.+) not found\.$/.exec(msg);
  if (nf) return t('{what} not found.', { what: t(nf[1]) });
  return msg;
}

/** Levels above 30 are Truegold tiers: 31 = TG1 ... */
export const TG_BASE = 30;
export const levelLabel = (n: number | null | undefined) => (n == null ? '—' : n > TG_BASE ? `TG${n - TG_BASE}` : String(n));

const RES: Record<string, string> = {
  bread: 'Bread', wood: 'Wood', stone: 'Stone', iron: 'Iron', truegold: 'Truegold', tempered_truegold: 'Tempered Truegold',
};
/** Resource display name: known keys are translated, others use the curator's name. */
export const resName = (key: string, fallback?: string) => (RES[key] ? t(RES[key]) : fallback ?? key.replace(/_/g, ' '));
