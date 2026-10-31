import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { api, fmtDate, fmtNum } from '../lib/api';
import { useLoad } from '../lib/session';
import { t } from '../lib/i18n';
import { parseAmount } from '../lib/amount';
import { Async, Button, Empty, Field, Input, Modal, Note, useAction, useConfirm } from '../components/ui';
import { AmountInput } from '../components/AmountInput';

interface Row { alliance_tag: string; name: string; truegold: number | null; free_time: string; note: string }

/**
 * Reads one pasted line. Understands:
 *   "19. GTO Dragon rouge – 1400 / 06:00–08:30"      (number, alliance, name – Truegold / free time)
 *   "Alpy; 20:00-23:00 UTC; 2.5K; rally lead"         (name; free time; Truegold; note) — also tab or | separated
 */
export function parseNoteLine(raw: string): Row | null {
  let line = raw.trim().replace(/^\d+\s*[.)]\s*/, '');
  if (!line) return null;
  let namePart = line, tg: number | null = null, free = '', note = '';
  const sepMatch = /\t|;|\|/.exec(line);
  const dash = /\s+[–—-]\s+/.exec(line);
  if (sepMatch) {
    const parts = line.split(sepMatch[0]).map((x) => x.trim());
    [namePart = '', free = ''] = parts;
    const n = parts[2] ? parseAmount(parts[2]) : null;
    if (n !== null && !Number.isNaN(n)) tg = n; else if (parts[2]) note = parts[2];
    note = [note, ...parts.slice(3)].filter(Boolean).join(' ');
  } else if (dash) {
    namePart = line.slice(0, dash.index).trim();
    const rest = line.slice(dash.index + dash[0].length).trim();
    const m = /^([\d.,]+\s*[a-zA-Z가-힣]{0,2})\s*(?:\/\s*(.*))?$/.exec(rest);
    const n = m ? parseAmount(m[1]) : NaN;
    if (m && !Number.isNaN(n)) { tg = n; free = (m[2] ?? '').trim(); } else free = rest;
  }
  // A leading alliance tag: "GTO Name" or "[GTO] Name"
  let tag = '';
  const tm = /^\[([A-Za-z0-9]{2,6})\]\s*(.+)$/.exec(namePart) ?? /^([A-Z0-9]{2,6})\s+(.+)$/.exec(namePart);
  if (tm) { tag = tm[1].toUpperCase(); namePart = tm[2].trim(); }
  if (/^(name|player|이름|nom|nama)$/i.test(namePart)) return null;   // header row
  return { alliance_tag: tag, name: namePart.slice(0, 80), truegold: tg, free_time: free.slice(0, 300), note: note.slice(0, 1000) };
}

export function RosterNotes() {
  const state = useLoad<any>('/planning/roster');
  const [term, setTerm] = useState('');
  const [sort, setSort] = useState<'list' | 'tg' | 'name'>('list');
  const [editing, setEditing] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const { run } = useAction();
  const { confirm, node } = useConfirm();

  const rows = useMemo(() => {
    const list = (state.data?.rows ?? []).filter((r: any) => !term || `${r.alliance_tag} ${r.name} ${r.free_time} ${r.note}`.toLowerCase().includes(term.toLowerCase()));
    if (sort === 'tg') return [...list].sort((a, b) => (b.truegold ?? -1) - (a.truegold ?? -1));
    if (sort === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [state.data, term, sort]);

  async function del(r: any) {
    if (await confirm(t('Delete {name}?', { name: r.name }), t('Only this note is deleted.'), t('Delete')) &&
      await run(() => api(`/planning/roster/${r.id}`, { method: 'DELETE' }), t('Deleted'))) state.reload();
  }
  async function delAll() {
    if (await confirm(t('Delete the whole list?'), t('Every note in this list is deleted. Registered members and their inventories are not affected.'), t('Delete all')) &&
      await run(() => api('/planning/roster', { method: 'DELETE' }), t('Deleted'))) state.reload();
  }

  return (
    <div className="stack">
      {node}
      <div className="toolbar">
        <Input className="input input-sm" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('Search')} aria-label={t('Search')} />
        <select className="input input-sm" value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label={t('Sort')}>
          <option value="list">{t('List order')}</option><option value="tg">{t('Truegold, highest first')}</option><option value="name">{t('Name A–Z')}</option>
        </select>
        <span className="grow" />
        <Button icon={<Plus size={16} />} onClick={() => setEditing({ alliance_tag: '', name: '', truegold: null, free_time: '', note: '' })}>{t('Add')}</Button>
        <Button variant="primary" icon={<Upload size={16} />} onClick={() => setImporting(true)}>{t('Paste list')}</Button>
      </div>
      <Async state={state}>{() => rows.length ? (
        <>
          <div className="table-wrap"><table className="table">
            <thead><tr><th className="num">#</th><th>{t('Alliance')}</th><th>{t('Name')}</th><th className="num">{t('Truegold')}</th><th>{t('Free time')}</th><th>{t('Note')}</th><th /></tr></thead>
            <tbody>{rows.map((r: any, i: number) => (
              <tr key={r.id}>
                <td className="num muted">{i + 1}</td>
                <td>{r.alliance_tag ? `[${r.alliance_tag}]` : ''}</td>
                <td><b>{r.name}</b>{r.user_id && <Link className="btn btn-quiet inline-link" to={`/planning/${r.user_id}`} title={t('Registered on the website')}><ClipboardList size={14} aria-hidden /> {t('Plan')}</Link>}</td>
                <td className="num">{r.truegold != null ? fmtNum(r.truegold) : <span className="muted">—</span>}</td>
                <td>{r.free_time || <span className="muted">—</span>}</td>
                <td className="note-cell">{r.note || ''}</td>
                <td className="row-actions">
                  <Button variant="quiet" icon={<Pencil size={15} />} aria-label={t('Edit')} onClick={() => setEditing(r)} />
                  <Button variant="quiet" icon={<Trash2 size={15} />} aria-label={t('Delete')} onClick={() => del(r)} />
                </td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="row-between">
            <p className="muted small">{t('{n} notes. Only leaders see this list.', { n: rows.length })}{state.data.rows[0]?.updated_at && ` ${t('Updated {date}', { date: fmtDate(state.data.rows[0].updated_at) })}`}</p>
            <Button variant="quiet" icon={<Trash2 size={15} />} onClick={delAll}>{t('Delete all')}</Button>
          </div>
        </>
      ) : <Empty title={t('No notes yet')}>{t('Click Paste list and paste your list from the game chat, Discord or a spreadsheet.')}</Empty>}</Async>
      {editing && <EditRow row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); state.reload(); }} />}
      {importing && <PasteList onClose={() => setImporting(false)} onSaved={() => { setImporting(false); state.reload(); }} hasRows={(state.data?.rows ?? []).length > 0} />}
    </div>
  );
}

function EditRow({ row, onClose, onSaved }: { row: any; onClose: () => void; onSaved: () => void }) {
  const [r, setR] = useState({ ...row, tg: row.truegold != null ? String(row.truegold) : '' });
  const { busy, run } = useAction();
  async function save() {
    const tg = r.tg.trim() === '' ? null : parseAmount(r.tg);
    if (tg !== null && Number.isNaN(tg)) return run(async () => { throw new Error(t('Truegold: not a number.')); });
    if (!r.name.trim()) return run(async () => { throw new Error(t('Add a name.')); });
    const body = { alliance_tag: r.alliance_tag, name: r.name, truegold: tg, free_time: r.free_time, note: r.note };
    if (await run(() => (row.id ? api(`/planning/roster/${row.id}`, { method: 'PUT', body }) : api('/planning/roster', { body })), t('Notes saved'))) onSaved();
  }
  return (
    <Modal title={row.id ? t('Edit note') : t('Add note')} onClose={onClose} footer={<Button variant="primary" busy={busy} onClick={save}>{t('Save')}</Button>}>
      <div className="stack">
        <div className="row">
          <Field label={t('Alliance')}><Input value={r.alliance_tag} onChange={(e) => setR({ ...r, alliance_tag: e.target.value })} maxLength={12} placeholder="GTO" /></Field>
          <Field label={t('Name')}><Input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} maxLength={80} /></Field>
        </div>
        <Field label={t('Truegold')}><AmountInput value={r.tg} onChange={(v) => setR({ ...r, tg: v })} label={t('Truegold')} /></Field>
        <Field label={t('Free time')} hint={t('Any text, e.g. 20:00–23:00 UTC daily, or weekends')}><Input value={r.free_time} onChange={(e) => setR({ ...r, free_time: e.target.value })} maxLength={300} /></Field>
        <Field label={t('Note')}><textarea className="input" rows={3} value={r.note} onChange={(e) => setR({ ...r, note: e.target.value })} maxLength={1000} /></Field>
      </div>
    </Modal>
  );
}

function PasteList({ onClose, onSaved, hasRows }: { onClose: () => void; onSaved: () => void; hasRows: boolean }) {
  const [text, setText] = useState('');
  const [replace, setReplace] = useState(hasRows);
  const { busy, run } = useAction();
  const rows = text.split(/\r?\n/).map(parseNoteLine).filter((r): r is Row => r !== null);
  async function save() {
    if (await run(() => api('/planning/roster/import', { body: { rows, replace } }), t('{n} notes saved', { n: rows.length }))) onSaved();
  }
  return (
    <Modal title={t('Paste list')} onClose={onClose}
      footer={<Button variant="primary" busy={busy} disabled={!rows.length} onClick={save}>{t('Save {n} notes', { n: rows.length })}</Button>}>
      <div className="stack">
        <p className="muted small">{t('Paste your list, one player per line. Names are saved as written; nobody needs to be registered.')}</p>
        <code className="codeblock">{'19. GTO Dragon rouge – 1400 / 06:00–08:30\nAlpy; 20:00–23:00 UTC; 2.5K; rally lead'}</code>
        <textarea className="input" rows={8} value={text} onChange={(e) => setText(e.target.value)} aria-label={t('Paste list')} />
        {hasRows && <label className="radio"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> {t('Replace the current list (otherwise these are added at the end)')}</label>}
        {rows.length > 0 && (
          <>
            <p className="small"><b>{t('Preview')}</b> <span className="muted">— {t('check that each column was read correctly')}</span></p>
            <div className="table-wrap preview-wrap"><table className="table table-tight">
              <thead><tr><th>{t('Alliance')}</th><th>{t('Name')}</th><th className="num">{t('Truegold')}</th><th>{t('Free time')}</th><th>{t('Note')}</th></tr></thead>
              <tbody>{rows.slice(0, 200).map((r, i) => (
                <tr key={i}><td>{r.alliance_tag}</td><td>{r.name}</td><td className="num">{r.truegold != null ? fmtNum(r.truegold) : '—'}</td><td>{r.free_time}</td><td>{r.note}</td></tr>
              ))}</tbody>
            </table></div>
          </>
        )}
        {text.trim() && !rows.length && <Note tone="warn">{t('No lines could be read.')}</Note>}
      </div>
    </Modal>
  );
}
