import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, Download, Plus, Trash2 } from 'lucide-react';
import { api, download, fmtDate, fmtNum, fmtShort, fmtTime } from '../lib/api';
import { useLoad, useSession } from '../lib/session';
import { resName, t } from '../lib/i18n';
import { Async, Button, Empty, Input, Note, PageHeader, Panel, Tag, useAction } from '../components/ui';
import { LevelSelect } from './Plans';

export function Dashboard() {
  const { user } = useSession();
  const inv = useLoad<any>('/me/inventory');
  const plans = useLoad<any>('/plans');
  const goals = useLoad<any>('/me/goals');
  const overview = useLoad<any>('/kingdom/overview');
  const profile = useLoad<any>('/me/profile');
  const appts = useLoad<any>('/appointments/mine');
  const { run } = useAction();
  const [goal, setGoal] = useState('');

  async function addGoal(e: FormEvent) {
    e.preventDefault();
    if (!goal.trim()) return;
    if (await run(() => api('/me/goals', { body: { title: goal } }))) { setGoal(''); goals.reload(); }
  }
  async function toggle(g: any) { await run(() => api(`/me/goals/${g.id}`, { method: 'PATCH', body: { done: !g.done } })); goals.reload(); }
  async function del(g: any) { await run(() => api(`/me/goals/${g.id}`, { method: 'DELETE' })); goals.reload(); }

  return (
    <>
      <PageHeader title={t('Welcome back, {name}', { name: user!.display_name })} lead={t('Your own progress. Private unless you choose to share it.')} />
      <div className="grid-2">
        <Panel title={t('Resources')} actions={<Link to="/me/resources">{t('Update')}</Link>}>
          <Async state={inv}>{(d) => (
            <div className="res-grid">
              {d.inventory.filter((r: any) => !r.deferred).map((r: any) => (
                <div key={r.key} className="res"><span className="muted">{resName(r.key, r.name)}</span><b title={fmtNum(r.amount)}>{fmtShort(r.amount)}</b></div>
              ))}
            </div>
          )}</Async>
          <Async state={profile}>{(d) => (
            <p className="muted small">{d.profile.share_inventory ? t('Inventory is shared with your alliance leaders.') : t('Inventory is private.')} <Link to="/settings">{t('Change sharing')}</Link></p>
          )}</Async>
        </Panel>

        <Panel title={t('Your next events')} actions={<Link to="/events">{t('Calendar')}</Link>}>
          <Async state={overview}>{(d) => d.events.length ? (
            <ul className="list">{d.events.slice(0, 4).map((e: any) => (
              <li key={e.id}><Link to={`/events/${e.id}`} className="list-row"><b>{e.title}</b><small className="muted">{fmtTime(e.starts_at, user!.time_zone)}</small></Link></li>
            ))}</ul>
          ) : <Empty title={t('No upcoming events')} />}</Async>
        </Panel>

        {appts.data && appts.data.bookings.length > 0 && (
          <Panel title={t('My upcoming appointments')} actions={<Link to="/appointments">{t("King's appointments")}</Link>}>
            <ul className="list">{appts.data.bookings.slice(0, 4).map((b: any) => (
              <li key={b.id}><Link to={`/appointments/${b.schedule_id}`} className="list-row"><b>{b.position}</b><small className="muted">{fmtTime(b.slot_start, user!.time_zone)}</small></Link></li>
            ))}</ul>
          </Panel>
        )}

        <Panel title={t('Saved plans')} actions={<Link to="/calculator">{t('New plan')}</Link>}>
          <Async state={plans}>{(d) => d.plans.length ? (
            <ul className="list">{d.plans.slice(0, 5).map((p: any) => (
              <li key={p.id}><Link to={`/plans/${p.id}`} className="list-row"><b>{p.name}</b><small className="muted">{t('Updated {date}', { date: fmtDate(p.updated_at) })}</small></Link></li>
            ))}</ul>
          ) : <Empty title={t('No plans yet')} action={<Link className="btn btn-primary" to="/calculator">{t('Open the calculator')}</Link>} />}</Async>
        </Panel>

        <Panel title={t('Personal goals')}>
          <form onSubmit={addGoal} className="inline-form">
            <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t('e.g. Town Center to the next level before KVK')} aria-label={t('New goal')} maxLength={200} />
            <Button type="submit" icon={<Plus size={16} />}>{t('Add')}</Button>
          </form>
          <Async state={goals}>{(d) => d.goals.length ? (
            <ul className="list">{d.goals.map((g: any) => (
              <li key={g.id} className={`goal ${g.done ? 'done' : ''}`}>
                <button className="check" onClick={() => toggle(g)} aria-pressed={g.done} aria-label={g.done ? t('Mark not done') : t('Mark done')}>{g.done && <Check size={14} />}</button>
                <span>{g.title}</span>
                <Button variant="quiet" icon={<Trash2 size={15} />} onClick={() => del(g)} aria-label={t('Delete goal')} />
              </li>
            ))}</ul>
          ) : <p className="muted small">{t('No goals yet.')}</p>}</Async>
        </Panel>
      </div>
    </>
  );
}

export function Resources() {
  const inv = useLoad<any>('/me/inventory');
  const bld = useLoad<any>('/me/buildings');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [levels, setLevels] = useState<Record<number, number>>({});
  const { busy, run } = useAction();

  useEffect(() => {
    if (inv.data) setAmounts(Object.fromEntries(inv.data.inventory.map((r: any) => [r.key, String(r.amount)])));
  }, [inv.data]);
  useEffect(() => {
    if (bld.data) setLevels(Object.fromEntries(bld.data.buildings.map((b: any) => [b.id, b.level])));
  }, [bld.data]);

  async function saveInventory(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, number> = {};
    for (const [k, v] of Object.entries(amounts)) {
      const n = Number(String(v).replace(/[, _.]/g, ''));
      if (!Number.isInteger(n) || n < 0) return run(async () => { throw new Error(t('{resource}: enter a whole number of 0 or more.', { resource: resName(k) })); });
      body[k] = n;
    }
    if (await run(() => api('/me/inventory', { method: 'PUT', body }), t('Inventory saved'))) inv.reload();
  }
  async function saveBuildings(e: FormEvent) {
    e.preventDefault();
    const body = Object.entries(levels).map(([id, lvl]) => ({ building_id: Number(id), level: lvl }));
    if (await run(() => api('/me/buildings', { method: 'PUT', body }), t('Building levels saved'))) bld.reload();
  }

  return (
    <>
      <PageHeader title={t('Resources & buildings')} lead={t('Enter what you have in game. This stays on your account across devices.')}
        actions={<Button icon={<Download size={16} />} onClick={() => download('/me/inventory.csv')}>{t('Export CSV')}</Button>} />
      <div className="grid-2">
        <Panel title={t('Inventory')}>
          <Async state={inv}>{(d) => (
            <form onSubmit={saveInventory} className="stack">
              {d.inventory.map((r: any) => (
                <div key={r.key} className="inv-row">
                  <label htmlFor={`inv-${r.key}`}>{resName(r.key, r.name)}{r.deferred && <Tag tone="muted">{t('Switched off')}</Tag>}{!r.verified && !r.deferred && <Tag tone="muted">{t('Name unverified')}</Tag>}</label>
                  <Input id={`inv-${r.key}`} inputMode="numeric" value={amounts[r.key] ?? ''} disabled={r.deferred}
                    onChange={(e) => setAmounts({ ...amounts, [r.key]: e.target.value })} />
                </div>
              ))}
              <Button variant="primary" busy={busy} type="submit">{t('Save inventory')}</Button>
            </form>
          )}</Async>
        </Panel>
        <Panel title={t('Building levels')}>
          <Async state={bld}>{(d) => d.buildings.length ? (
            <form onSubmit={saveBuildings} className="stack">
              {d.buildings.map((b: any) => (
                <div key={b.id} className="inv-row">
                  <label htmlFor={`b-${b.id}`}>{b.name}</label>
                  <LevelSelect label={b.name} max={b.max_level} value={levels[b.id] ?? 0} onChange={(n) => setLevels({ ...levels, [b.id]: n })} />
                </div>
              ))}
              <Button variant="primary" busy={busy} type="submit">{t('Save levels')}</Button>
            </form>
          ) : <Note>{t('No buildings are in the game data library yet. A data curator adds them first.')}</Note>}</Async>
        </Panel>
      </div>
    </>
  );
}
