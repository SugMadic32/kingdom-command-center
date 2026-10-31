import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ClipboardList, Pencil } from 'lucide-react';
import { InventoryForm, BuildingLevelsForm } from '../components/InventoryForm';
import { api, fmtDate, fmtMinutes, fmtNum, fmtShort } from '../lib/api';
import { useLoad } from '../lib/session';
import { levelLabel, resName, t } from '../lib/i18n';
import { Async, Button, Empty, Field, Input, Modal, Note, PageHeader, Panel, Tag, useAction } from '../components/ui';
import { ItemsEditor, LevelSelect, QualityTag, ResultView } from './Plans';

const RES = ['bread', 'wood', 'stone', 'iron', 'truegold', 'tempered_truegold'];
const SPEED = ['speedup_general', 'speedup_construction', 'speedup_research', 'speedup_training', 'speedup_healing'];
const buildSpeed = (inv: any) => (inv ? Number(inv.speedup_construction ?? 0) + Number(inv.speedup_general ?? 0) : null);

export function MemberPlanningPage() {
  const [alliance, setAlliance] = useState('');
  const [term, setTerm] = useState('');
  const [onlyShared, setOnlyShared] = useState(false);
  const state = useLoad<any>(`/planning/members${alliance ? `?alliance_id=${alliance}` : ''}`, [alliance]);
  return (
    <>
      <PageHeader title={t('Member planning')}
        lead={t("See the resources and building levels members share, and make upgrade plans for them. Members who haven't shared appear without numbers.")} />
      <Async state={state}>{(d) => {
        const list = d.members.filter((m: any) => (!onlyShared || m.share_inventory)
          && (!term || `${m.display_name} ${m.ingame_name ?? ''}`.toLowerCase().includes(term.toLowerCase())));
        const notSharing = d.members.filter((m: any) => !m.share_inventory).length;
        return (
          <div className="stack">
            {notSharing > 0 && <Note>{t('{n} members have not shared their resources yet. Ask them to turn on sharing in Settings › Privacy.', { n: notSharing })}</Note>}
            <div className="toolbar">
              {d.kingdom_wide && (
                <select className="input input-sm" value={alliance} onChange={(e) => setAlliance(e.target.value)} aria-label={t('Alliance')}>
                  <option value="">{t('All alliances')}</option>
                  {d.alliances.map((a: any) => <option key={a.id} value={a.id}>[{a.tag}] {a.name}</option>)}
                </select>
              )}
              <Input className="input input-sm" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('Search players')} aria-label={t('Search players')} />
              <label className="radio"><input type="checkbox" checked={onlyShared} onChange={(e) => setOnlyShared(e.target.checked)} /> {t('Only members who share')}</label>
            </div>
            {list.length ? (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>{t('Player')}</th><th className="num">{t('Town Center')}</th>
                  {RES.map((k) => <th key={k} className="num">{resName(k)}</th>)}<th className="num">{t('Build speedups')}</th><th>{t('Updated')}</th><th /></tr></thead>
                <tbody>{list.map((m: any) => (
                  <tr key={m.id}>
                    <td><b>{m.ingame_name || m.display_name}</b>{m.alliance_tag && <small className="muted block">[{m.alliance_tag}] {m.rank}</small>}</td>
                    <td className="num">{m.town_center == null ? '—' : levelLabel(m.town_center)}</td>
                    {RES.map((k) => <td key={k} className="num" title={m.inventory ? fmtNum(m.inventory[k] ?? 0) : undefined}>{m.inventory ? fmtShort(m.inventory[k] ?? 0) : ''}</td>)}
                    <td className="num" title={m.inventory ? SPEED.map((k) => `${resName(k)}: ${fmtMinutes(m.inventory[k] ?? 0)}`).join('\n') : undefined}>{m.inventory ? fmtMinutes(buildSpeed(m.inventory)) : ''}</td>
                    <td className="small">{m.inventory ? (m.inventory_updated ? fmtDate(m.inventory_updated) : t('Never')) : <Tag tone="muted">{t('Not shared')}</Tag>}</td>
                    <td>{(m.share_inventory || m.share_buildings) && <Link className="btn btn-quiet" to={`/planning/${m.id}`}><ClipboardList size={15} aria-hidden /> {t('Plan')}</Link>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <Empty title={t('No members match')} />}
          </div>
        );
      }}</Async>
    </>
  );
}

export function MemberPlanDetail() {
  const { id } = useParams();
  const state = useLoad<any>(`/planning/members/${id}`, [id]);
  const buildings = useLoad<any>('/game/buildings');
  const [items, setItems] = useState<any[]>([]);
  const [result, setResult] = useState<any>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<null | 'inventory' | 'buildings'>(null);
  const resTypes = useLoad<any>('/game/resources');
  const { busy, run } = useAction();

  const levels: Record<number, number> = useMemo(() => Object.fromEntries((state.data?.buildings ?? []).map((b: any) => [b.id, b.level])), [state.data]);
  const blist = buildings.data?.buildings ?? [];
  useEffect(() => {
    if (blist.length && !items.length && state.data) {
      const first = blist.find((x: any) => x.key === 'town_center') ?? blist[0];
      const from = Math.min(levels[first.id] ?? 0, first.max_level - 1);
      setItems([{ building_id: first.id, from, to: Math.min(from + 1, first.max_level) }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blist.length, state.data]);

  async function calc() {
    const r: any = await run(() => api(`/planning/members/${id}/calculate`, { body: { items } }));
    if (r) setResult(r.result);
  }
  async function save() {
    const who = state.data.member.ingame_name || state.data.member.display_name;
    if (await run(() => api(`/planning/members/${id}/plans`, { body: { name: name || t('Plan for {name}', { name: who }), items, note } }),
      t('Plan sent to {name}', { name: who }))) { setName(''); setNote(''); state.reload(); }
  }

  return (
    <Async state={state}>{(d) => {
      const m = d.member;
      const who = m.ingame_name || m.display_name;
      return (
        <>
          {editing === 'inventory' && resTypes.data && (
            <Modal title={t("Edit {name}'s resources", { name: who })} onClose={() => setEditing(null)}>
              <Note>{t('Use this when a member needs help. They get a notification that you changed their numbers.')}</Note>
              <InventoryForm rows={resTypes.data.resources.map((r: any) => ({ ...r, amount: d.inventory?.[r.key] ?? 0 }))}
                onSave={async (body) => { await api(`/planning/members/${m.id}/inventory`, { method: 'PUT', body }); setEditing(null); state.reload(); }} />
            </Modal>
          )}
          {editing === 'buildings' && d.all_buildings && (
            <Modal title={t("Edit {name}'s building levels", { name: who })} onClose={() => setEditing(null)}>
              <BuildingLevelsForm rows={d.all_buildings} LevelSelect={LevelSelect}
                onSave={async (body) => { await api(`/planning/members/${m.id}/buildings`, { method: 'PUT', body }); setEditing(null); state.reload(); }} />
            </Modal>
          )}
          <PageHeader title={t('Plan for {name}', { name: who })} lead={<>{m.alliance_tag && `[${m.alliance_tag}] `}<Link to="/planning">{t('Back to member planning')}</Link></>} />
          <div className="grid-calc">
            <div className="stack">
              <Panel title={t('Their resources')} actions={d.inventory && <Button icon={<Pencil size={15} />} onClick={() => setEditing('inventory')}>{t('Edit')}</Button>}>
                {d.last_update && <p className="muted small">{t('Last updated {date} by {name}', { date: fmtDate(d.last_update.updated_at), name: d.last_update.by_name ?? '—' })}</p>}
                {d.inventory ? (
                  <div className="res-grid">{RES.map((k) => (
                    <div key={k} className="res"><span className="muted">{resName(k)}</span><b title={fmtNum(d.inventory[k] ?? 0)}>{fmtShort(d.inventory[k] ?? 0)}</b></div>
                  ))}</div>
                ) : <p className="muted">{t('Not shared')}</p>}
                {d.inventory && <ul className="list small">{SPEED.map((k) => (
                  <li key={k} className="list-row"><span className="muted">{resName(k)}</span><b>{fmtMinutes(d.inventory[k] ?? 0)}</b></li>
                ))}</ul>}
              </Panel>
              <Panel title={t('Their building levels')} actions={d.all_buildings && <Button icon={<Pencil size={15} />} onClick={() => setEditing('buildings')}>{t('Edit')}</Button>}>
                {d.buildings ? (d.buildings.length ? (
                  <ul className="list">{d.buildings.map((b: any) => (
                    <li key={b.id} className="list-row"><span>{b.name}</span><b>{levelLabel(b.level)}</b></li>
                  ))}</ul>
                ) : <p className="muted">{t('No levels entered yet.')}</p>) : <p className="muted">{t('Not shared')}</p>}
              </Panel>
              {d.plans.length > 0 && (
                <Panel title={t('Plans')}>
                  <ul className="list">{d.plans.map((p: any) => (
                    <li key={p.id} className="list-row"><span><b>{p.name}</b><small className="muted">{p.created_by_name ? t('by {name}', { name: p.created_by_name }) : ''} · {fmtDate(p.updated_at)}</small></span>
                      <QualityTag result={{ quality: p.quality }} /></li>
                  ))}</ul>
                </Panel>
              )}
            </div>
            <div className="stack">
              <Panel title={t('Make a plan')}>
                {blist.length && items.length ? (
                  <div className="stack">
                    <ItemsEditor items={items} setItems={setItems} buildings={blist} myLevels={levels} />
                    <Button variant="primary" busy={busy} onClick={calc}>{t('Calculate')}</Button>
                    {!d.inventory && <Note>{t('Their resources are not shared, so shortages cannot be shown. Costs still work.')}</Note>}
                  </div>
                ) : <Note>{t('No building data is published yet.')}</Note>}
              </Panel>
              {result && (
                <Panel title={t('Result')}>
                  <ResultView r={result} />
                  <hr />
                  <div className="stack">
                    <Field label={t('Plan name')}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Plan for {name}', { name: who })} maxLength={80} /></Field>
                    <Field label={t('Message to the member (optional)')}><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
                    <Button variant="primary" busy={busy} onClick={save}>{t('Send plan to {name}', { name: who })}</Button>
                    <p className="muted small">{t('The plan appears in their Saved plans and they get a notification.')}</p>
                  </div>
                </Panel>
              )}
            </div>
          </div>
        </>
      );
    }}</Async>
  );
}
