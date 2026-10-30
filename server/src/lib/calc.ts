import { q, one } from './db.js';
import { levelLabel } from './levels.js';

export type Status = 'in_game_confirmed' | 'cross_checked' | 'single_source' | 'conflicting' | 'missing';
const TRUSTED: Status[] = ['in_game_confirmed', 'cross_checked'];

export interface PlanItem { building_id: number; from: number; to: number }
export interface Assumptions { speed_bonus_pct?: number; speedup_minutes?: number }

interface LevelRow {
  id: number; level: number; costs: Record<string, number>; duration_seconds: number | null;
  prerequisites: { building: string; level: number }[]; status: Status; source_url: string | null;
}

export async function latestPublishedVersion(): Promise<number | null> {
  const v = await one<{ id: number }>(
    `SELECT id FROM dataset_versions WHERE status = 'published' ORDER BY published_at DESC, id DESC LIMIT 1`,
  );
  return v?.id ?? null;
}

export interface Warning {
  type: 'missing' | 'conflicting' | 'unrecorded' | 'deferred' | 'no_building';
  building: string;
  levels: number[];
  resources?: string[];
}

/**
 * Calculate one or more upgrades. Never fills gaps:
 *  - a level without a record is "missing" and its costs are left out;
 *  - a resource that a record does not mention is "not recorded" (not zero) and is left out;
 * and both make the result incomplete.
 */
export async function calculate(opts: {
  items: PlanItem[];
  inventory: Record<string, number>;
  memberLevels: Record<string, number>;    // building key -> level the member reports
  datasetVersionId: number;
  assumptions?: Assumptions;
}) {
  const resources = await q<{ key: string; name: string; deferred: boolean; applies_from_level: number }>(
    'SELECT key, name, deferred, applies_from_level FROM resource_types ORDER BY sort',
  );
  const appliesFrom = Object.fromEntries(resources.map((r) => [r.key, r.applies_from_level]));
  const active = resources.filter((r) => !r.deferred).map((r) => r.key);
  const deferredKeys = new Set(resources.filter((r) => r.deferred).map((r) => r.key));

  const totals: Record<string, number> = Object.fromEntries(active.map((k) => [k, 0]));
  const unrecordedAny = new Set<string>();
  const warnings: Warning[] = [];
  let totalSeconds = 0;
  let durationComplete = true;
  let hasGap = false;          // missing, conflicting or unrecorded
  let hasSingleSource = false;
  const itemResults = [];

  for (const item of opts.items) {
    const b = await one<{ id: number; key: string; name: string; max_level: number }>(
      'SELECT id, key, name, max_level FROM game_buildings WHERE id = $1', [item.building_id],
    );
    if (!b) { warnings.push({ type: 'no_building', building: String(item.building_id), levels: [] }); hasGap = true; continue; }
    const from = Math.max(0, item.from);
    const to = Math.min(b.max_level, item.to);
    if (to <= from) {
      itemResults.push({ building_id: b.id, building: b.name, building_key: b.key, from, to, levels: [], invalid_range: true });
      continue;
    }

    const rows = await q<LevelRow>(
      `SELECT id, level, costs, duration_seconds, prerequisites, status, source_url
         FROM building_levels
        WHERE dataset_version_id = $1 AND building_id = $2 AND level > $3 AND level <= $4
        ORDER BY level`,
      [opts.datasetVersionId, b.id, from, to],
    );
    const byLevel = new Map(rows.map((r) => [r.level, r]));

    const levels = [];
    const itemTotals: Record<string, number> = Object.fromEntries(active.map((k) => [k, 0]));
    const unmet: { building: string; level: number; have: number }[] = [];
    const unrecorded: Record<string, number[]> = {};
    const deferredLevels: number[] = [];

    for (let lvl = from + 1; lvl <= to; lvl++) {
      const r = byLevel.get(lvl);
      if (!r || r.status === 'missing') {
        levels.push({ level: lvl, label: levelLabel(lvl), status: 'missing' as Status, record_id: r?.id ?? null });
        hasGap = true;
        durationComplete = false;
        continue;
      }
      if (r.status === 'conflicting') hasGap = true;
      if (r.status === 'single_source') hasSingleSource = true;

      const costs: Record<string, number> = {};
      for (const [k, v] of Object.entries(r.costs)) {
        if (deferredKeys.has(k)) continue;
        costs[k] = v;
        itemTotals[k] = (itemTotals[k] ?? 0) + v;
        totals[k] = (totals[k] ?? 0) + v;
      }
      if (Object.keys(r.costs).some((k) => deferredKeys.has(k) && r.costs[k] > 0)) deferredLevels.push(lvl);
      for (const k of active) {
        if (lvl >= (appliesFrom[k] ?? 1) && !(k in r.costs)) {
          (unrecorded[k] ??= []).push(lvl);
          unrecordedAny.add(k);
          hasGap = true;
        }
      }
      if (r.duration_seconds == null) durationComplete = false; else totalSeconds += r.duration_seconds;

      for (const p of r.prerequisites ?? []) {
        const have = opts.memberLevels[p.building] ?? 0;
        if (have < p.level && !unmet.some((u) => u.building === p.building && u.level >= p.level)) {
          unmet.push({ building: p.building, level: p.level, have });
        }
      }
      levels.push({
        level: lvl, label: levelLabel(lvl), status: r.status, record_id: r.id, costs,
        duration_seconds: r.duration_seconds, source_url: r.source_url,
      });
    }

    // Highest level reachable with current inventory (recorded costs only), stopping at the first unknown level
    let affordable = from;
    const running: Record<string, number> = {};
    for (const l of levels) {
      if (l.status === 'missing' || l.status === 'conflicting' || !l.costs) break;
      let ok = true;
      for (const [k, v] of Object.entries(l.costs)) {
        running[k] = (running[k] ?? 0) + v;
        if (running[k] > (opts.inventory[k] ?? 0)) ok = false;
      }
      if (!ok) break;
      affordable = l.level;
    }

    const missing = levels.filter((l) => l.status === 'missing').map((l) => l.level);
    if (missing.length) warnings.push({ type: 'missing', building: b.name, levels: missing });
    const conflicting = levels.filter((l) => l.status === 'conflicting').map((l) => l.level);
    if (conflicting.length) warnings.push({ type: 'conflicting', building: b.name, levels: conflicting });
    // Group resources that are unrecorded on the same levels into one warning
    const groups = new Map<string, string[]>();
    for (const [k, lv] of Object.entries(unrecorded)) groups.set(lv.join(','), [...(groups.get(lv.join(',')) ?? []), k]);
    for (const [lv, keys] of groups) warnings.push({ type: 'unrecorded', building: b.name, levels: lv.split(',').map(Number), resources: keys });
    if (deferredLevels.length) warnings.push({ type: 'deferred', building: b.name, levels: deferredLevels });

    itemResults.push({
      building_id: b.id, building: b.name, building_key: b.key, from, to,
      from_label: levelLabel(from), to_label: levelLabel(to),
      totals: itemTotals, affordable_level: affordable, affordable_label: levelLabel(affordable),
      unmet_prerequisites: unmet, unrecorded, levels,
    });
  }

  const shortage: Record<string, number> = {};
  const surplus: Record<string, number> = {};
  for (const k of active) {
    const have = opts.inventory[k] ?? 0;
    const need = totals[k] ?? 0;
    shortage[k] = Math.max(0, need - have);
    surplus[k] = Math.max(0, have - need);
  }

  const a = opts.assumptions ?? {};
  let estimate: null | { seconds: number; speed_bonus_pct: number; speedup_minutes: number } = null;
  if (durationComplete && totalSeconds > 0 && (a.speed_bonus_pct != null || a.speedup_minutes != null)) {
    const bonus = Math.max(0, a.speed_bonus_pct ?? 0);
    const speedups = Math.max(0, a.speedup_minutes ?? 0);
    estimate = {
      seconds: Math.max(0, Math.round(totalSeconds / (1 + bonus / 100)) - speedups * 60),
      speed_bonus_pct: bonus, speedup_minutes: speedups,
    };
  }

  const quality = hasGap ? 'incomplete' : hasSingleSource ? 'single_source' : 'verified';
  return {
    dataset_version_id: opts.datasetVersionId,
    calculated_at: new Date().toISOString(),
    quality,
    authoritative: quality === 'verified',
    totals, shortage, surplus,
    unrecorded_resources: [...unrecordedAny],   // totals for these leave out some levels
    base_duration_seconds: durationComplete ? totalSeconds : null,
    estimate,
    warnings,
    items: itemResults,
  };
}

export async function memberContext(userId: number) {
  const inv = await q<{ resource_key: string; amount: number }>(
    'SELECT resource_key, amount FROM member_inventory WHERE user_id = $1', [userId],
  );
  const lv = await q<{ key: string; level: number }>(
    `SELECT b.key, mb.level FROM member_buildings mb JOIN game_buildings b ON b.id = mb.building_id
      WHERE mb.user_id = $1`, [userId],
  );
  return {
    inventory: Object.fromEntries(inv.map((r) => [r.resource_key, r.amount])),
    memberLevels: Object.fromEntries(lv.map((r) => [r.key, r.level])),
  };
}
