import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ClipboardList, NotebookPen, Pencil, Upload } from 'lucide-react';
import { AmountInput } from '../components/AmountInput';
import { parseAmount } from '../lib/amount';
import { InventoryForm, BuildingLevelsForm } from '../components/InventoryForm';
import { api, fmtDate, fmtMinutes, fmtNum, fmtShort } from '../lib/api';
import { useLoad } from '../lib/session';
import { levelLabel, resName, t } from '../lib/i18n';
import { Async, Button, Empty, Field, Input, Modal, Note, PageHeader, Panel, Tag, useAction, useConfirm } from '../components/ui';
import { ItemsEditor, LevelSelect, QualityTag, ResultView } from './Plans';

const RES = ['bread', 'wood', 'stone', 'iron', 'truegold', 'tempered_truegold'];
const SPEED = ['speedup_general', 'speedup_construction', 'speedup_research', 'speedup_training', 'speedup_healing'];
const buildSpeed = (inv: any) => (inv ? Number(inv.speedup_construction ?? 0) + Number(inv.speedup_general ?? 0) : null);

export function MemberPlanningPage() {
  const [alliance, setAlliance] = useState('');
  const [term, setTerm] = useState('');
  const [onlyShared, setOnlyShared] = useState(false);
  const [tab, setTab] = useState<'resources' | 'notes'>('resources');
  const [noteFor, setNoteFor] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const state = useLoad<any>(`/planning/members${alliance ? `?alliance_id=${alliance}` : ''}`, [alliance]);
  const { run } = useAction();
  const { confirm, node } = useConfirm();
  async function shareAll() {
    if (!(await confirm(t('Turn on sharing for everyone?'), t('Members who never chose get sharing turned on and a notification telling them how to turn it off. Members who turned it off themselves are skipped.'), t('Turn on sharing'), true))) return;
    const r: any = await run(() => api('/planning/sharing/all', { method: 'POST' }));
    if (r) { run(async () => r, t('Sharing turned on for {n} members. {s} chose off themselves and were skipped.', { n: r.changed, s: r.skipped })); state.reload(); }
  }
  async function shareOne(m: any) {
    if (await run(() => api(`/planning/members/${m.id}/sharing`, { method: 'POST' }), t('Sharing turned on for {name}. They were notified.', { name: m.ingame_name || m.display_name }))) state.reload();
  }
  return (
    <>
      {node}
      <PageHeader title={t('Member planning')}
        lead={t("See the resources and building levels members share, and make upgrade plans for them. Members who haven't shared appear without numbers.")}
        actions={<Button icon={<Upload size={16} />} onClick={() => setImporting(true)}>{t('Import notes')}</Button>} />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'resources'} onClick={() => setTab('resources')}>{t('Resources')}</button>
        <button role="tab" aria-selected={tab === 'notes'} onClick={() => setTab('notes')}>{t('Notes')}</button>
      </div>
      {noteFor && <NotesModal member={noteFor} onClose={() => setNoteFor(null)} onSaved={() => { setNoteFor(null); state.reload(); }} />}
      {importing && <ImportNotesModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); state.reload(); setTab('notes'); }} />}
      <Async state={state}>{(d) => {
        const list = d.members.filter((m: any) => (!onlyShared || m.share_inventory)
          && (!term || `${m.display_name} ${m.ingame_name ?? ''}`.toLowerCase().includes(term.toLowerCase())));
        const notSharing = d.members.filter((m: any) => !m.share_inventory).length;
        return (
          <div className="stack">
            {notSharing > 0 && <Note>{t('{n} members have not shared their resources yet. Ask them to turn on sharing in Settings › Privacy.', { n: notSharing })}
              {d.kingdom_wide && <> <Button variant="primary" onClick={shareAll}>{t('Turn on sharing for everyone')}</Button></>}</Note>}
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
            {tab === 'notes' ? (list.length ? (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>{t('Player')}</th><th>{t('Free time')}</th><th className="num">{t('Truegold (note)')}</th><th>{t('Note')}</th><th>{t('Updated')}</th><th /></tr></thead>
                <tbody>{list.map((m: any) => (
                  <tr key={m.id}>
                    <td><b>{m.ingame_name || m.display_name}</b>{m.alliance_tag && <small className="muted block">[{m.alliance_tag}] {m.rank}</small>}</td>
                    <td>{m.note_free_time || <span className="muted">—</span>}</td>
                    <td className="num">{m.note_truegold != null ? fmtNum(m.note_truegold) : <span className="muted">—</span>}</td>
                    <td className="note-cell">{m.note_text || <span className="muted">—</span>}</td>
                    <td className="small">{m.note_updated ? fmtDate(m.note_updated) : ''}</td>
                    <td><Button variant="quiet" icon={<NotebookPen size={15} />} onClick={() => setNoteFor(m)}>{t('Edit notes')}</Button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <Empty title={t('No members match')} />) : list.length ? (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>{t('Player')}</th><th className="num">{t('Town Center')}</th>
                  {RES.map((k) => <th key={k} className="num">{resName(k)}</th>)}<th className="num">{t('Build speedups')}</th><th>{t('Updated')}</th><th /></tr></thead>
                <tbody>{list.map((m: any) => (
                  <tr key={m.id}>
                    <td><b>{m.ingame_name || m.display_name}</b>{m.alliance_tag && <small className="muted block">[{m.alliance_tag}] {m.rank}</small>}</td>
                    <td className="num">{m.town_center == null ? '—' : levelLabel(m.town_center)}</td>
                    {RES.map((k) => <td key={k} className="num" title={m.inventory ? fmtNum(m.inventory[k] ?? 0) : undefined}>{m.inventory ? fmtShort(m.inventory[k] ?? 0) : ''}</td>)}
                    <td className="num" title={m.inventory ? SPEED.map((k) => `${resName(k)}: ${fmtMinutes(m.inventory[k] ?? 0)}`).join('\n') : undefined}>{m.inventory ? fmtMinutes(buildSpeed(m.inventory)) : ''}</td>
                    <td className="small">{m.inventory ? (m.inventory_updated ? fmtDate(m.inventory_updated) : t('Never'))
                      : m.share_user_choice === false ? <span className="muted" title={t('This member turned sharing off themselves. Only they can turn it back on.')}>{t('Off (their choice)')}</span>
                      : d.kingdom_wide ? <Button variant="quiet" onClick={() => shareOne(m)}>{t('Turn on sharing')}</Button>
                      : <Tag tone="muted">{t('Not shared')}</Tag>}</td>
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

function NotesModal({ member, onClose, onSaved }: { member: any; onClose: () => void; onSaved: () => void }) {
  const who = member.ingame_name || member.display_name;
  const [free, setFree] = useState(member.note_free_time ?? '');
  const [tg, setTg] = useState(member.note_truegold != null ? String(member.note_truegold) : '');
  const [note, setNote] = useState(member.note_text ?? '');
  const { busy, run } = useAction();
  async function save() {
    const n = tg.trim() === '' ? null : parseAmount(tg);
    if (n !== null && Number.isNaN(n)) return run(async () => { throw new Error(t('Truegold: not a number.')); });
    if (await run(() => api(`/planning/members/${member.id}/notes`, { method: 'PUT', body: { free_time: free, truegold: n, note } }), t('Notes saved'))) onSaved();
  }
  return (
    <Modal title={t('Notes for {name}', { name: who })} onClose={onClose} footer={<Button variant="primary" busy={busy} onClick={save}>{t('Save notes')}</Button>}>
      <div className="stack">
        <p className="muted small">{t("Only leaders see these notes. They are separate from the member's own inventory.")}</p>
        <Field label={t('Free time')} hint={t('Any text, e.g. 20:00–23:00 UTC daily, or weekends')}><Input value={free} onChange={(e) => setFree(e.target.value)} maxLength={200} /></Field>
        <Field label={t('Truegold (note)')}><AmountInput value={tg} onChange={setTg} label={t('Truegold (note)')} /></Field>
        <Field label={t('Note')}><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
      </div>
    </Modal>
  );
}

/** Paste rows from a chat or spreadsheet: name, free time, Truegold, note. Tab, semicolon, | or comma separated. */
function parseRows(text: string) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : line.includes('|') ? '|' : ',';
    const [name = '', free = '', tg = '', ...rest] = line.split(sep).map((x) => x.trim());
    const n = tg === '' ? null : parseAmount(tg);
    return { name, free_time: free, truegold: n, note: rest.join(' ').trim(), bad: n !== null && Number.isNaN(n) };
  }).filter((r) => r.name && !/^(name|player|이름|nom|nama)$/i.test(r.name));
}

function ImportNotesModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<null | { matched: any[]; unmatched: string[] }>(null);
  const { busy, run } = useAction();
  const rows = parseRows(text);
  const badRows = rows.filter((r) => r.bad);
  const body = (dry: boolean) => ({ rows: rows.filter((r) => !r.bad).map(({ bad, ...r }) => r), dry_run: dry });
  async function check() {
    const r: any = await run(() => api('/planning/notes/import', { body: body(true) }));
    if (r) setPreview(r);
  }
  async function save() {
    const r: any = await run(() => api('/planning/notes/import', { body: body(false) }), t('Notes saved'));
    if (r) onDone();
  }
  return (
    <Modal title={t('Import notes')} onClose={onClose}
      footer={preview ? <Button variant="primary" busy={busy} disabled={!preview.matched.length} onClick={save}>{t('Save {n} notes', { n: preview.matched.length })}</Button>
        : <Button variant="primary" busy={busy} disabled={!rows.length} onClick={check}>{t('Check names')}</Button>}>
      <div className="stack">
        <p className="muted small">{t('One member per line: name, free time, Truegold, note. Copy from a spreadsheet or separate with commas or semicolons. Names are matched to in-game names.')}</p>
        <code className="codeblock">{'Alpy; 20:00-23:00 UTC; 2.5K; rally lead\nCloud; weekends; 900'}</code>
        <textarea className="input" rows={8} value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} aria-label={t('Import notes')} />
        {badRows.length > 0 && <Note tone="warn">{t('Truegold is not a number on these lines: {names}', { names: badRows.map((r) => r.name).join(', ') })}</Note>}
        {preview && <>
          <p><b>{t('{n} names found', { n: preview.matched.length })}</b>{preview.matched.length > 0 && <small className="muted block">{preview.matched.map((m) => m.member).join(', ')}</small>}</p>
          {preview.unmatched.length > 0 && <Note tone="warn">{t('Not found (check spelling, or they have not registered yet): {names}', { names: preview.unmatched.join(', ') })}</Note>}
        </>}
      </div>
    </Modal>
  );
}
