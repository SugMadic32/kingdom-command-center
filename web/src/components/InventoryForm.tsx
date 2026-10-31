import { useEffect, useState, type FormEvent } from 'react';
import { parseAmount } from '../lib/amount';
import { resName, t } from '../lib/i18n';
import { useAction } from './ui';
import { Button, Input, Tag } from './ui';
import { AmountInput } from './AmountInput';

interface Row { key: string; name: string; kind?: string; deferred?: boolean; verified?: boolean; amount: number }

/** Resources (with 295M / 1.5B input) and speedups (days/hours/minutes). Used by members and by leaders helping them. */
export function InventoryForm({ rows, onSave, submitLabel }: { rows: Row[]; onSave: (body: Record<string, number>) => Promise<unknown>; submitLabel?: string }) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [speed, setSpeed] = useState<Record<string, { d: string; h: string; m: string }>>({});
  const { busy, run } = useAction();
  useEffect(() => {
    setAmounts(Object.fromEntries(rows.filter((r) => r.kind !== 'speedup').map((r) => [r.key, String(r.amount ?? 0)])));
    setSpeed(Object.fromEntries(rows.filter((r) => r.kind === 'speedup').map((r) => {
      const m = Number(r.amount ?? 0);
      return [r.key, { d: String(Math.floor(m / 1440)), h: String(Math.floor((m % 1440) / 60)), m: String(m % 60) }];
    })));
  }, [rows]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, number> = {};
    for (const [k, v] of Object.entries(amounts)) {
      const n = parseAmount(v);
      if (Number.isNaN(n)) return run(async () => { throw new Error(t('{resource}: not a number. Type for example 295M or 1.5B.', { resource: resName(k) })); });
      body[k] = n;
    }
    for (const [k, v] of Object.entries(speed)) {
      const parts = [v.d, v.h, v.m].map((x) => Number(String(x).trim() || '0'));
      if (!parts.every((x) => Number.isInteger(x) && x >= 0)) return run(async () => { throw new Error(t('{resource}: enter whole numbers of 0 or more.', { resource: resName(k) })); });
      body[k] = parts[0] * 1440 + parts[1] * 60 + parts[2];
    }
    await run(() => onSave(body), t('Inventory saved'));
  }

  return (
    <form onSubmit={submit} className="stack">
      <p className="muted small">{t('You can type 295M (million), 1.5B (billion) or 250K (thousand).')}</p>
      {rows.filter((r) => r.kind !== 'speedup').map((r) => (
        <div key={r.key} className="inv-row">
          <label htmlFor={`inv-${r.key}`}>{resName(r.key, r.name)}{r.deferred && <Tag tone="muted">{t('Switched off')}</Tag>}{r.verified === false && !r.deferred && <Tag tone="muted">{t('Name unverified')}</Tag>}</label>
          <AmountInput id={`inv-${r.key}`} value={amounts[r.key] ?? ''} disabled={r.deferred} label={resName(r.key, r.name)}
            onChange={(v) => setAmounts({ ...amounts, [r.key]: v })} />
        </div>
      ))}
      <h3 className="sub-head">{t('Speedups')}</h3>
      <div className="speed-row"><span /><span className="speed-head">{t('Days')}</span><span className="speed-head">{t('Hours')}</span><span className="speed-head">{t('Minutes')}</span></div>
      {rows.filter((r) => r.kind === 'speedup').map((r) => {
        const v = speed[r.key] ?? { d: '0', h: '0', m: '0' };
        const set = (part: 'd' | 'h' | 'm', val: string) => setSpeed({ ...speed, [r.key]: { ...v, [part]: val } });
        return (
          <div key={r.key} className="speed-row">
            <label htmlFor={`sp-${r.key}`}>{resName(r.key, r.name)}</label>
            <Input id={`sp-${r.key}`} inputMode="numeric" value={v.d} onChange={(e) => set('d', e.target.value)} aria-label={`${resName(r.key)} ${t('Days')}`} />
            <Input inputMode="numeric" value={v.h} onChange={(e) => set('h', e.target.value)} aria-label={`${resName(r.key)} ${t('Hours')}`} />
            <Input inputMode="numeric" value={v.m} onChange={(e) => set('m', e.target.value)} aria-label={`${resName(r.key)} ${t('Minutes')}`} />
          </div>
        );
      })}
      <p className="muted small">{t('Add up the speedup items in your bag, for example 5 × 1h = 5 hours.')}</p>
      <Button variant="primary" busy={busy} type="submit">{submitLabel ?? t('Save inventory')}</Button>
    </form>
  );
}

/** Building levels with a level picker (1–30, then TG1…). */
export function BuildingLevelsForm({ rows, onSave, LevelSelect }:
  { rows: { id: number; name: string; max_level: number; level: number }[]; onSave: (body: { building_id: number; level: number }[]) => Promise<unknown>;
    LevelSelect: (p: { max: number; value: number; onChange: (n: number) => void; label: string }) => JSX.Element }) {
  const [levels, setLevels] = useState<Record<number, number>>({});
  const { busy, run } = useAction();
  useEffect(() => { setLevels(Object.fromEntries(rows.map((b) => [b.id, b.level]))); }, [rows]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    await run(() => onSave(Object.entries(levels).map(([id, lvl]) => ({ building_id: Number(id), level: lvl }))), t('Building levels saved'));
  }
  return (
    <form onSubmit={submit} className="stack">
      {rows.map((b) => (
        <div key={b.id} className="inv-row">
          <label>{b.name}</label>
          <LevelSelect label={b.name} max={b.max_level} value={levels[b.id] ?? 0} onChange={(n) => setLevels({ ...levels, [b.id]: n })} />
        </div>
      ))}
      <Button variant="primary" busy={busy} type="submit">{t('Save levels')}</Button>
    </form>
  );
}
