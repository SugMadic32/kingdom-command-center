import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Copy, Download, Link2, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { api, download, fmtDate, fmtDuration, fmtNum, fmtShort } from '../lib/api';
import { useLoad, useSession } from '../lib/session';
import { levelLabel, resName, t } from '../lib/i18n';
import { Async, Button, Empty, ErrorNote, Field, Input, Note, PageHeader, Panel, StatusMark, Tag, useAction, useConfirm } from '../components/ui';

interface Item { building_id: number; from: number; to: number }

const quality = (r: any) => r?.quality ?? (r?.authoritative ? 'verified' : 'incomplete');
export function QualityTag({ result }: { result: any }) {
  const q = quality(result);
  if (q === 'verified') return <Tag tone="ok">{t('Verified data')}</Tag>;
  if (q === 'single_source') return <Tag tone="gold">{t('Single-source data')}</Tag>;
  return <Tag tone="danger">{t('Incomplete data')}</Tag>;
}

/** Level picker that shows 1–30 and then TG1, TG2 ... */
export function LevelSelect({ max, min = 0, value, onChange, label }: { max: number; min?: number; value: number; onChange: (n: number) => void; label: string }) {
  const opts = [];
  for (let i = min; i <= max; i++) opts.push(i);
  return (
    <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
      {opts.map((n) => <option key={n} value={n}>{n === 0 ? t('Not built') : levelLabel(n)}</option>)}
    </select>
  );
}

const ranges = (levels: number[]) => {
  const out: string[] = [];
  let s = levels[0], p = levels[0];
  for (let i = 1; i <= levels.length; i++) {
    if (levels[i] === p + 1) { p = levels[i]; continue; }
    out.push(s === p ? levelLabel(s) : `${levelLabel(s)}–${levelLabel(p)}`);
    s = p = levels[i];
  }
  return out.join(', ');
};

function warningText(w: any): string {
  if (typeof w === 'string') return w;   // plans saved before structured warnings
  const lv = ranges(w.levels ?? []);
  switch (w.type) {
    case 'missing': return t('{building}: no cost data for level {levels}. Totals leave these levels out.', { building: w.building, levels: lv });
    case 'conflicting': return t('{building}: sources disagree for level {levels}.', { building: w.building, levels: lv });
    case 'unrecorded': return t('{building}: {resources} not recorded for level {levels}. Totals leave them out; they are not counted as zero.',
      { building: w.building, resources: (w.resources ?? []).map((k: string) => resName(k)).join(', '), levels: lv });
    case 'deferred': return t('{building}: level {levels} also needs resources that are switched off in calculations.', { building: w.building, levels: lv });
    default: return t('A building in this plan no longer exists.');
  }
}

/** Shows a calculation, always with its data quality first. */
export function ResultView({ r, showInventory = true }: { r: any; showInventory?: boolean }) {
  const keys = Object.keys(r.totals);
  const unrecorded: string[] = r.unrecorded_resources ?? [];
  const anyKnown = r.items.some((it: any) => it.levels?.some((l: any) => l.status !== 'missing'));
  const q = quality(r);
  return (
    <div className="stack">
      {q === 'verified' && <Note>{t('Every level in this range is confirmed in game or cross-checked (dataset version {v}).', { v: r.dataset_version_id })}</Note>}
      {q === 'single_source' && <Note>{t('All levels have data, but some come from a single source that has not been confirmed in game yet. Treat totals as close estimates.')}</Note>}
      {q === 'incomplete' && <Note tone="warn">{t('Some costs are missing, not recorded or disputed, so the real total is higher or different. Check the notes below before you rely on it.')}</Note>}
      {r.warnings.length > 0 && <ul className="warnings">{r.warnings.map((w: any, i: number) => <li key={i}>{warningText(w)}</li>)}</ul>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('Resource')}</th><th className="num">{t('Needed')}</th>{showInventory && <><th className="num">{t('Shortage')}</th><th className="num">{t('Left over')}</th></>}</tr></thead>
          <tbody>{keys.map((k) => (
            <tr key={k}>
              <td>{resName(k)}{unrecorded.includes(k) && <small className="muted block">{t('Some levels not recorded')}</small>}</td>
              <td className="num" title={fmtNum(r.totals[k])}>{anyKnown ? fmtShort(r.totals[k]) : t('No data')}{unrecorded.includes(k) && '+'}</td>
              {showInventory && <>
                <td className={`num ${r.shortage?.[k] > 0 ? 'neg' : ''}`} title={fmtNum(r.shortage?.[k])}>{r.shortage?.[k] > 0 ? fmtShort(r.shortage[k]) : '—'}</td>
                <td className="num" title={fmtNum(r.surplus?.[k])}>{fmtShort(r.surplus?.[k] ?? 0)}</td>
              </>}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {unrecorded.length > 0 && <p className="muted small">{t('+ means the real amount is higher: some levels have no figure for this resource.')}</p>}
      <div className="kv">
        <div><span>{t('Base build time')}</span><b>{r.base_duration_seconds == null ? t('Unknown (some durations missing)') : fmtDuration(r.base_duration_seconds)}</b></div>
        {r.estimate && <div><span>{t('Estimated with your bonuses')}</span><b>{fmtDuration(r.estimate.seconds)}</b>
          <small className="muted">{t('Assumes {bonus}% construction speed and {mins} min of speedups. Approximate.', { bonus: r.estimate.speed_bonus_pct, mins: fmtNum(r.estimate.speedup_minutes) })}</small></div>}
      </div>
      {r.items.map((it: any) => (
        <details key={`${it.building_id}-${it.from}`} className="level-detail">
          <summary>
            <b>{it.building}</b> {levelLabel(it.from)} → {levelLabel(it.to)}
            {showInventory && !it.invalid_range && <span className="muted"> · {t('affordable up to {level}', { level: it.from === it.affordable_level && it.from === 0 ? t('Not built') : levelLabel(it.affordable_level) })}</span>}
            {it.unmet_prerequisites?.length > 0 && <Tag tone="danger">{t('{n} unmet requirement(s)', { n: it.unmet_prerequisites.length })}</Tag>}
          </summary>
          {it.invalid_range && <p className="muted">{t('Target must be above current level.')}</p>}
          {it.unmet_prerequisites?.length > 0 && (
            <ul className="warnings">{it.unmet_prerequisites.map((p: any, i: number) => (
              <li key={i}>{t('Needs {building} level {level} (you have {have}).', { building: p.building.replace(/_/g, ' '), level: levelLabel(p.level), have: levelLabel(p.have) })}</li>
            ))}</ul>
          )}
          {it.levels.length > 0 && <div className="table-wrap"><table className="table table-tight">
            <thead><tr><th>{t('Level')}</th><th>{t('Data')}</th>{keys.map((k) => <th key={k} className="num">{resName(k)}</th>)}<th className="num">{t('Time')}</th><th>{t('Source')}</th></tr></thead>
            <tbody>{it.levels.map((l: any) => (
              <tr key={l.level}>
                <td>{levelLabel(l.level)}</td><td><StatusMark status={l.status} /></td>
                {keys.map((k) => <td key={k} className="num" title={fmtNum(l.costs?.[k])}>{!l.costs ? '?' : l.costs[k] != null ? fmtShort(l.costs[k]) : it.unrecorded?.[k]?.includes(l.level) ? '?' : '—'}</td>)}
                <td className="num">{l.status === 'missing' || l.duration_seconds == null ? '?' : fmtDuration(l.duration_seconds)}</td>
                <td>{l.source_url ? <a href={l.source_url} target="_blank" rel="noreferrer noopener">{t('Source')}</a> : <span className="muted">{l.status === 'in_game_confirmed' ? t('In game') : '—'}</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>}
        </details>
      ))}
    </div>
  );
}

export function ItemsEditor({ items, setItems, buildings, myLevels }: { items: Item[]; setItems: (i: Item[]) => void; buildings: any[]; myLevels: Record<number, number> }) {
  const update = (i: number, patch: Partial<Item>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="stack">
      {items.map((it, i) => {
        const b = buildings.find((x) => x.id === it.building_id);
        const max = b?.max_level ?? 30;
        return (
          <div key={i} className="item-row">
            <Field label={t('Building')}>
              <select className="input" value={it.building_id} onChange={(e) => {
                const id = Number(e.target.value);
                const m = buildings.find((x) => x.id === id)?.max_level ?? 30;
                const from = Math.min(myLevels[id] ?? 0, m - 1);
                update(i, { building_id: id, from, to: Math.min(from + 1, m) });
              }}>
                {buildings.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
            <Field label={t('Current')}><LevelSelect label={t('Current')} max={max - 1} value={it.from} onChange={(n) => update(i, { from: n, to: Math.max(it.to, n + 1) })} /></Field>
            <Field label={t('Target')}><LevelSelect label={t('Target')} min={1} max={max} value={it.to} onChange={(n) => update(i, { to: n })} /></Field>
            {items.length > 1 && <Button variant="quiet" icon={<X size={16} />} onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label={t('Remove building')} />}
          </div>
        );
      })}
      <Button icon={<Plus size={16} />} onClick={() => {
        const b = buildings[0];
        const from = Math.min(myLevels[b.id] ?? 0, b.max_level - 1);
        setItems([...items, { building_id: b.id, from, to: Math.min(from + 1, b.max_level) }]);
      }}>{t('Add another building')}</Button>
    </div>
  );
}

export function CalculatorPage() {
  const buildings = useLoad<any>('/game/buildings');
  const mine = useLoad<any>('/me/buildings');
  const inv = useLoad<any>('/me/inventory');
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [bonus, setBonus] = useState('');
  const [speedups, setSpeedups] = useState('');
  const [useSaved, setUseSaved] = useState(true);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any>(null);
  const [name, setName] = useState('');
  const { busy, run } = useAction();

  const myLevels: Record<number, number> = Object.fromEntries((mine.data?.buildings ?? []).map((b: any) => [b.id, b.level]));
  useEffect(() => {
    if (buildings.data?.buildings.length && mine.data && !items.length) {
      const b = buildings.data.buildings[0];
      const from = Math.min(myLevels[b.id] ?? 0, b.max_level - 1);
      setItems([{ building_id: b.id, from, to: Math.min(from + 1, b.max_level) }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings.data, mine.data]);

  const assumptions = () => ({
    ...(bonus !== '' ? { speed_bonus_pct: Number(bonus) } : {}),
    ...(speedups !== '' ? { speedup_minutes: Number(speedups) } : {}),
  });
  async function calc() {
    const body: any = { items, assumptions: assumptions() };
    if (!useSaved) body.inventory = Object.fromEntries(Object.entries(custom).map(([k, v]) => [k, Number(v.replace(/[, ]/g, '')) || 0]));
    const r = await run(() => api('/plans/calculate', { body }));
    if (r) setResult((r as any).result);
  }
  async function save() {
    const r = await run(() => api('/plans', { body: { name: name || t('Upgrade plan'), items, assumptions: assumptions() } }), t('Plan saved'));
    if (r) navigate(`/plans/${(r as any).plan.id}`);
  }

  return (
    <>
      <PageHeader title={t('Upgrade calculator')} lead={t('Cumulative cost from your current level to a target, using the published game data. Levels after 30 are Truegold tiers (TG1, TG2 ...).')} />
      <Async state={buildings}>{(d) => {
        if (!d.published_version_id) return <Note tone="warn">{t('No building data is published yet. The calculator opens once a data curator publishes an audited dataset in the Game data library.')}</Note>;
        if (!d.buildings.length) return <Note>{t('No buildings are in the library yet.')}</Note>;
        return (
          <div className="grid-calc">
            <Panel title={t('What to upgrade')}>
              <ItemsEditor items={items} setItems={setItems} buildings={d.buildings} myLevels={myLevels} />
              <hr />
              <fieldset className="stack">
                <legend>{t('Resources to compare against')}</legend>
                <label className="radio"><input type="radio" checked={useSaved} onChange={() => setUseSaved(true)} /> {t('My saved inventory')}</label>
                <label className="radio"><input type="radio" checked={!useSaved} onChange={() => setUseSaved(false)} /> {t('Try other amounts (not saved)')}</label>
                {!useSaved && inv.data && inv.data.inventory.filter((r: any) => !r.deferred && r.kind !== 'speedup').map((r: any) => (
                  <div key={r.key} className="inv-row"><label htmlFor={`c-${r.key}`}>{resName(r.key, r.name)}</label>
                    <Input id={`c-${r.key}`} inputMode="numeric" value={custom[r.key] ?? ''} placeholder={String(r.amount)} onChange={(e) => setCustom({ ...custom, [r.key]: e.target.value })} /></div>
                ))}
              </fieldset>
              <hr />
              <fieldset className="stack">
                <legend>{t('Optional time assumptions')}</legend>
                <div className="row">
                  <Field label={t('Construction speed bonus %')}><Input type="number" min={0} value={bonus} onChange={(e) => setBonus(e.target.value)} /></Field>
                  <Field label={t('Speedups (minutes)')}><Input type="number" min={0} value={speedups} onChange={(e) => setSpeedups(e.target.value)} /></Field>
                </div>
                {inv.data && (() => {
                  const mins = inv.data.inventory.filter((r: any) => r.key === 'speedup_construction' || r.key === 'speedup_general').reduce((n: number, r: any) => n + Number(r.amount), 0);
                  return mins > 0 && <Button variant="quiet" onClick={() => setSpeedups(String(mins))}>{t('Use my speedups ({time})', { time: fmtDuration(mins * 60) })}</Button>;
                })()}
                <p className="muted small">{t('Leave empty to see base build time only.')}</p>
              </fieldset>
              <Button variant="primary" busy={busy} onClick={calc}>{t('Calculate')}</Button>
            </Panel>
            <Panel title={t('Result')}>
              {result ? (
                <>
                  <ResultView r={result} />
                  <hr />
                  <div className="inline-form">
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Plan name')} aria-label={t('Plan name')} maxLength={80} />
                    <Button variant="primary" busy={busy} onClick={save}>{t('Save plan')}</Button>
                  </div>
                </>
              ) : <Empty title={t('Choose buildings and calculate')}>{t('Totals, shortages and the highest level you can afford will show here.')}</Empty>}
            </Panel>
          </div>
        );
      }}</Async>
    </>
  );
}

export function PlansPage() {
  const { user } = useSession();
  const state = useLoad<any>('/plans');
  const [compare, setCompare] = useState<number[]>([]);
  const toggle = (id: number) => setCompare(compare.includes(id) ? compare.filter((x) => x !== id) : [...compare, id].slice(-2));
  return (
    <>
      <PageHeader title={t('Saved plans')} lead={t('Rename, duplicate, compare or share your plans.')}
        actions={<Link className="btn btn-primary" to="/calculator">{t('New plan')}</Link>} />
      <Async state={state}>{(d) => d.plans.length ? (
        <>
          <div className="table-wrap"><table className="table">
            <thead><tr><th><span className="sr-only">{t('Compare')}</span></th><th>{t('Plan')}</th><th>{t('Data')}</th><th>{t('Dataset')}</th><th>{t('Sharing')}</th><th>{t('Updated')}</th></tr></thead>
            <tbody>{d.plans.map((p: any) => (
              <tr key={p.id}>
                <td><input type="checkbox" checked={compare.includes(p.id)} onChange={() => toggle(p.id)} aria-label={t('Compare {name}', { name: p.name })} /></td>
                <td><Link to={`/plans/${p.id}`}><b>{p.name}</b></Link>{p.created_by_name && p.created_by !== user?.id && <Tag tone="gold">{t('from {name}', { name: p.created_by_name })}</Tag>}</td>
                <td><QualityTag result={{ quality: p.quality, authoritative: p.authoritative }} /></td>
                <td className="muted">{p.dataset_label ?? '—'}</td>
                <td>{p.shared_with_alliance ? t('Alliance leaders') : p.has_link ? t('Link') : t('Private')}</td>
                <td>{fmtDate(p.updated_at)}</td>
              </tr>
            ))}</tbody>
          </table></div>
          {compare.length === 2 && <Compare ids={compare} />}
          {compare.length < 2 && d.plans.length > 1 && <p className="muted small">{t('Tick two plans to compare them.')}</p>}
        </>
      ) : <Empty title={t('No saved plans')} action={<Link className="btn btn-primary" to="/calculator">{t('Open the calculator')}</Link>} />}</Async>
    </>
  );
}

function Compare({ ids }: { ids: number[] }) {
  const a = useLoad<any>(`/plans/${ids[0]}`, [ids[0]]);
  const b = useLoad<any>(`/plans/${ids[1]}`, [ids[1]]);
  if (!a.data || !b.data) return null;
  const pa = a.data.plan, pb = b.data.plan;
  const keys = Array.from(new Set([...Object.keys(pa.result?.totals ?? {}), ...Object.keys(pb.result?.totals ?? {})]));
  return (
    <Panel title={t('Comparison')}>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>{t('Resource')}</th><th className="num">{pa.name}</th><th className="num">{pb.name}</th><th className="num">{t('Difference')}</th></tr></thead>
        <tbody>{keys.map((k) => {
          const x = pa.result?.totals?.[k] ?? 0, y = pb.result?.totals?.[k] ?? 0;
          return <tr key={k}><td>{resName(k)}</td><td className="num">{fmtShort(x)}</td><td className="num">{fmtShort(y)}</td><td className="num">{y - x > 0 ? '+' : ''}{fmtShort(y - x)}</td></tr>;
        })}
          <tr><td>{t('Base build time')}</td><td className="num">{fmtDuration(pa.result?.base_duration_seconds)}</td><td className="num">{fmtDuration(pb.result?.base_duration_seconds)}</td><td /></tr>
        </tbody>
      </table></div>
      {(quality(pa.result) === 'incomplete' || quality(pb.result) === 'incomplete') && <p className="muted small">{t('At least one plan uses incomplete data, so this comparison is approximate.')}</p>}
    </Panel>
  );
}

export function PlanDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useSession();
  const state = useLoad<any>(`/plans/${id}`, [id]);
  const [name, setName] = useState('');
  const { busy, run } = useAction();
  const { confirm, node } = useConfirm();
  useEffect(() => { if (state.data) setName(state.data.plan.name); }, [state.data]);

  const patch = async (body: any, msg: string) => { if (await run(() => api(`/plans/${id}`, { method: 'PATCH', body }), msg)) state.reload(); };
  const share = async (body: any) => { if (await run(() => api(`/plans/${id}/sharing`, { body }), t('Sharing updated'))) state.reload(); };
  async function dup() { const r: any = await run(() => api(`/plans/${id}/duplicate`, { method: 'POST' }), t('Plan duplicated')); if (r) navigate(`/plans/${r.plan.id}`); }
  async function del() {
    if (!(await confirm(t('Delete this plan?'), t('This cannot be undone. Anyone with its share link loses access.'), t('Delete plan')))) return;
    if (await run(() => api(`/plans/${id}`, { method: 'DELETE' }), t('Plan deleted'))) navigate('/plans');
  }

  return (
    <Async state={state}>{(d) => {
      const p = d.plan;
      const link = p.share_token ? `${window.location.origin}/shared/${p.share_token}` : null;
      return (
        <>
          {node}
          <PageHeader title={p.name} lead={t('Calculated with dataset version {v} on {date}.', { v: p.dataset_version_id ?? '—', date: fmtDate(p.result?.calculated_at) })}
            actions={<>
              <Button icon={<RefreshCw size={16} />} busy={busy} onClick={() => patch({ recalculate: true }, t('Recalculated with latest data'))}>{t('Recalculate')}</Button>
              <Button icon={<Copy size={16} />} onClick={dup}>{t('Duplicate')}</Button>
              <Button icon={<Download size={16} />} onClick={() => download(`/plans/${id}/export.csv`)}>CSV</Button>
              <Button variant="danger" icon={<Trash2 size={16} />} onClick={del}>{t('Delete')}</Button>
            </>} />
          <div className="grid-calc">
            <div className="stack">
              <Panel title={t('Name')}>
                <div className="inline-form">
                  <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={t('Plan name')} maxLength={80} />
                  <Button onClick={() => patch({ name }, t('Plan renamed'))} disabled={name === p.name}>{t('Rename')}</Button>
                </div>
              </Panel>
              <Panel title={t('Sharing')}>
                <div className="stack">
                  <label className="radio"><input type="checkbox" checked={p.shared_with_alliance} disabled={!user!.alliance_id}
                    onChange={(e) => share({ alliance: e.target.checked })} /> {t('Share with my alliance leaders (R4/R5)')}</label>
                  {!user!.alliance_id && <p className="muted small">{t('Join an alliance to share with its leaders.')}</p>}
                  <label className="radio"><input type="checkbox" checked={!!link} onChange={(e) => share({ link: e.target.checked })} /> {t('Read-only link')}</label>
                  {link && <div className="inline-form"><Input readOnly value={link} aria-label={t('Share link')} onFocus={(e) => e.target.select()} />
                    <Button icon={<Link2 size={16} />} onClick={() => navigator.clipboard?.writeText(link)}>{t('Copy')}</Button></div>}
                  <p className="muted small">{t('The link shows the plan and its costs, never your inventory. Turn it off to revoke it.')}</p>
                </div>
              </Panel>
            </div>
            <Panel title={t('Result')}>{p.result ? <ResultView r={p.result} /> : <ErrorNote>{t('This plan has no result. Recalculate it.')}</ErrorNote>}</Panel>
          </div>
        </>
      );
    }}</Async>
  );
}

export function SharedPlan() {
  const { token } = useParams();
  const state = useLoad<any>(`/shared/plans/${token}`, [token]);
  return (
    <div className="shared-page">
      <Async state={state}>{(d) => (
        <>
          <PageHeader title={d.plan.name} lead={t('Shared by {name}. Read-only.', { name: d.plan.owner })} />
          {d.plan.result ? <ResultView r={d.plan.result} showInventory={false} /> : <Empty title={t('No result')} />}
          <p className="muted small">{t('Made with Kingdom Command Center, a fan-made planning tool.')}</p>
        </>
      )}</Async>
    </div>
  );
}
