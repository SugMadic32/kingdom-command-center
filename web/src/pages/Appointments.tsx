import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, ClipboardCopy, Download, LayoutGrid, Plus, Rows3, Settings2, Trash2, User, X } from 'lucide-react';
import { api, download, fmtTime, fmtUtc, isoToLocalInput, localInputToIso } from '../lib/api';
import { useLoad, useSession } from '../lib/session';
import { locale, t } from '../lib/i18n';
import { Async, Button, Empty, Field, Input, Modal, Note, PageHeader, Panel, Tag, useAction, useConfirm } from '../components/ui';

const SLOT_OPTIONS = [15, 30, 60, 90, 120, 180, 240, 360, 480, 720, 1440];
const STATUS_TONE: Record<string, 'gold' | 'muted' | 'ok'> = { open: 'ok', draft: 'muted', closed: 'gold' };
const STATUS_NAME: Record<string, string> = { open: 'Booking open', draft: 'draft', closed: 'Booking closed' };
const slotLabel = (m: number) => (m % 60 === 0 ? t('{n} h', { n: m / 60 }) : t('{n} min', { n: m }));
const holderName = (b: any) => `${b.ingame_name || b.display_name}${b.alliance_tag ? ` [${b.alliance_tag}]` : ''}`;

/** Clock time in a zone, e.g. 14:00 */
const clock = (iso: string, tz: string) =>
  new Intl.DateTimeFormat(locale(), { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const dayLabel = (iso: string, tz: string) =>
  new Intl.DateTimeFormat(locale(), { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));

// ---------- List ----------
export function AppointmentsPage() {
  const { user } = useSession();
  const state = useLoad<any>('/appointments/schedules');
  const mine = useLoad<any>('/appointments/mine');
  const posCount = useLoad<any>('/appointments/positions');
  const [modal, setModal] = useState<null | 'new' | 'positions'>(null);
  const tz = user!.time_zone;
  return (
    <>
      <PageHeader title={t("King's appointments")}
        lead={t('After the King\'s Castle is won, members book time slots for the positions they want. Everyone can see who holds each position and when.')}
        actions={state.data?.can_manage && <>
          <Button icon={<Settings2 size={16} />} onClick={() => setModal('positions')}>{t('Positions')}</Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setModal('new')}>{t('New schedule')}</Button>
        </>} />
      <div className="stack">
        <Async state={mine}>{(d) => d.applications?.length > 0 && (
          <Panel title={t('My applications waiting for the King')}>
            <ul className="list">{d.applications.map((a: any) => (
              <li key={a.id}><Link to={`/appointments/${a.schedule_id}`} className="list-row">
                <span><b>{a.position}</b><small className="muted">{a.schedule}</small></span>
                <span className="num">{fmtTime(a.slot_start, tz)}<small className="muted">{fmtUtc(a.slot_start)}</small></span>
              </Link></li>
            ))}</ul>
          </Panel>
        )}</Async>
        <Async state={mine}>{(d) => d.bookings.length > 0 && (
          <Panel title={t('My upcoming appointments')}>
            <ul className="list">{d.bookings.map((b: any) => (
              <li key={b.id}><Link to={`/appointments/${b.schedule_id}`} className="list-row">
                <span><b>{b.position}</b><small className="muted">{b.schedule}</small></span>
                <span className="num">{fmtTime(b.slot_start, tz)}<small className="muted">{fmtUtc(b.slot_start)}</small></span>
              </Link></li>
            ))}</ul>
          </Panel>
        )}</Async>
        <Async state={state}>{(d) => d.schedules.length ? (
          <div className="schedule-cards">{d.schedules.map((s: any) => {
            const total = s.slots_per_position * s.position_count;
            return (
              <Link key={s.id} to={`/appointments/${s.id}`} className="panel schedule-card">
                <div className="row-between"><h2>{s.name}</h2><Tag tone={STATUS_TONE[s.status]}>{t(STATUS_NAME[s.status])}</Tag></div>
                <p className="muted small">{fmtTime(s.starts_at, tz)} → {fmtTime(s.ends_at, tz)}</p>
                <div className="kv-inline">
                  <span>{t('Slot length')} <b>{slotLabel(s.slot_minutes)}</b></span>
                  <span>{t('Positions')} <b>{s.position_count}</b></span>
                  <span>{t('Booked')} <b>{s.booked}/{total}</b></span>
                  {s.mine > 0 && <span>{t('Mine')} <b>{s.mine}</b></span>}
                </div>
                <div className="bar" role="img" aria-label={t('{n}% booked', { n: total ? Math.round((100 * s.booked) / total) : 0 })}>
                  <i style={{ width: `${total ? (100 * s.booked) / total : 0}%` }} />
                </div>
              </Link>
            );
          })}</div>
        ) : <Empty title={t('No appointment schedules yet')}
            action={d.can_manage && <Button variant="primary" icon={<Plus size={16} />} onClick={() => setModal('new')}>{t('New schedule')}</Button>}>
          {d.can_manage
            ? (posCount.data?.positions.length
              ? t('The {n} positions are ready. Click New schedule when the castle is won: the form is already filled in, so you only check the start time.', { n: posCount.data.positions.length })
              : t('First add the positions the King can appoint, then create a schedule and open booking.'))
            : t('The King or an appointment manager will open booking after the castle is won.')}</Empty>}</Async>
      </div>
      {modal === 'positions' && <PositionsModal onClose={() => setModal(null)} />}
      {modal === 'new' && <ScheduleForm onClose={() => setModal(null)} onSaved={state.reload} />}
    </>
  );
}

// ---------- Positions ----------
function PositionsModal({ onClose }: { onClose: () => void }) {
  const state = useLoad<any>('/appointments/positions');
  const [name, setName] = useState('');
  const [buff, setBuff] = useState('');
  const { busy, run } = useAction();
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (await run(() => api('/appointments/positions', { body: { name, buff, sort: (state.data?.positions.length ?? 0) + 1 } }), t('Position added'))) {
      setName(''); setBuff(''); state.reload();
    }
  }
  const patch = async (id: number, body: any) => { if (await run(() => api(`/appointments/positions/${id}`, { method: 'PATCH', body }))) state.reload(); };
  return (
    <Modal title={t('Positions')} onClose={onClose}>
      <div className="stack">
        <p className="muted small">{t('Use the same names as in game. Positions you switch off are hidden from new schedules but kept in old ones.')}</p>
        <Async state={state}>{(d) => d.positions.length ? (
          <ul className="list">{d.positions.map((p: any) => (
            <li key={p.id} className="position-row">
              <Input defaultValue={p.name} aria-label={t('Name')} onBlur={(e) => e.target.value !== p.name && patch(p.id, { name: e.target.value })} />
              <Input defaultValue={p.buff} placeholder={t('Buff (optional)')} aria-label={t('Buff (optional)')} onBlur={(e) => e.target.value !== p.buff && patch(p.id, { buff: e.target.value })} />
              <label className="radio"><input type="checkbox" checked={p.active} onChange={(e) => patch(p.id, { active: e.target.checked })} /> {t('Active')}</label>
              <Button variant="quiet" icon={<Trash2 size={15} />} aria-label={t('Delete {name}', { name: p.name })} onClick={async () => {
                if (window.confirm(t('Delete {name}?', { name: p.name })) && await run(() => api(`/appointments/positions/${p.id}`, { method: 'DELETE' }), t('Position deleted'))) state.reload();
              }} />
            </li>
          ))}</ul>
        ) : <p className="muted">{t('No positions yet.')}</p>}</Async>
        <form onSubmit={add} className="position-row">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Position name')} aria-label={t('Position name')} maxLength={60} />
          <Input value={buff} onChange={(e) => setBuff(e.target.value)} placeholder={t('Buff (optional)')} aria-label={t('Buff (optional)')} maxLength={200} />
          <Button type="submit" busy={busy} icon={<Plus size={16} />}>{t('Add')}</Button>
          <span />
        </form>
      </div>
    </Modal>
  );
}

// ---------- Create / edit schedule ----------
function ScheduleForm({ onClose, onSaved, existing, existingPositions }: { onClose: () => void; onSaved: () => void; existing?: any; existingPositions?: number[] }) {
  const { user } = useSession();
  const tz = user!.time_zone;
  const positions = useLoad<any>('/appointments/positions');
  const navigate = useNavigate();
  const nextHalfHour = () => new Date(Math.ceil(Date.now() / 1_800_000) * 1_800_000).toISOString();
  const defStart = existing?.starts_at ?? nextHalfHour();
  const defEnd = existing?.ends_at ?? new Date(new Date(defStart).getTime() + 24 * 3_600_000).toISOString();
  const [start, setStart] = useState(isoToLocalInput(defStart, tz));
  const [end, setEnd] = useState(isoToLocalInput(defEnd, tz));
  const [slot, setSlot] = useState<number>(existing?.slot_minutes ?? 30);
  const [mode, setMode] = useState<string>(existing?.mode ?? 'apply');
  const [picked, setPicked] = useState<number[]>(existingPositions ?? []);
  const { busy, run } = useAction();
  // New schedule: tick every active position so the King only needs to check the times
  useEffect(() => {
    if (!existing && positions.data && !picked.length) setPicked(positions.data.positions.filter((p: any) => p.active).map((p: any) => p.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.data]);

  const count = start && end ? (new Date(localInputToIso(end, tz)).getTime() - new Date(localInputToIso(start, tz)).getTime()) / (slot * 60_000) : 0;
  const countOk = Number.isInteger(count) && count >= 1;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const max = String(f.get('max') ?? '');
    const body = {
      name: f.get('name'), notes: f.get('notes'), slot_minutes: slot, position_ids: picked, mode,
      starts_at: localInputToIso(start, tz), ends_at: localInputToIso(end, tz), max_per_member: max === '' ? null : Number(max),
    };
    if (existing) {
      if (await run(() => api(`/appointments/schedules/${existing.id}`, { method: 'PATCH', body }), t('Schedule saved'))) { onSaved(); onClose(); }
    } else {
      const r: any = await run(() => api('/appointments/schedules', { body }), t('Schedule created. Open booking when you are ready.'));
      if (r) navigate(`/appointments/${r.schedule.id}`);
    }
  }
  return (
    <Modal title={existing ? t('Edit schedule') : t('New appointment schedule')} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        {!existing && <Note>{t('Everything is filled in for a 24-hour King term starting at the next half hour. Change the start time if needed, then create it.')}</Note>}
        <Field label={t('Name')} hint={t('e.g. King term after KVK Season 1')}><Input name="name" required minLength={2} maxLength={80} defaultValue={existing?.name ?? t("King's term")} /></Field>
        <div className="row">
          <Field label={t('Starts ({tz})', { tz })}><Input type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label={t('Ends ({tz})', { tz })}><Input type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        {start && <p className="muted small">{t('In game time: {start} → {end}', { start: fmtUtc(localInputToIso(start, tz)), end: end ? fmtUtc(localInputToIso(end, tz)) : '…' })}</p>}
        <div className="row">
          <Field label={t('Slot length')}>
            <select className="input" value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
              {SLOT_OPTIONS.map((m) => <option key={m} value={m}>{slotLabel(m)}</option>)}
            </select>
          </Field>
          <Field label={t('Max slots per member')} hint={t('Leave empty for no limit.')}>
            <Input name="max" type="number" min={1} defaultValue={existing?.max_per_member ?? ''} />
          </Field>
        </div>
        <Field label={t('How members get a slot')}>
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="apply">{t('Members apply, the King chooses (like in game)')}</option>
            <option value="first_come">{t('First come, first served')}</option>
          </select>
        </Field>
        {start && end && (countOk
          ? <p className="muted small">{t('{n} slots for each position.', { n: count })}</p>
          : <Note tone="warn">{t('The time between start and end must be a whole number of slots.')}</Note>)}
        <fieldset className="stack">
          <legend>{t('Positions in this schedule')}</legend>
          <Async state={positions}>{(d) => d.positions.filter((p: any) => p.active || picked.includes(p.id)).length ? (
            <div className="check-grid">{d.positions.filter((p: any) => p.active || picked.includes(p.id)).map((p: any) => (
              <label key={p.id} className="radio"><input type="checkbox" checked={picked.includes(p.id)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} />
                <span>{p.name}{p.buff && <small className="muted block">{p.buff}</small>}</span></label>
            ))}</div>
          ) : <Note>{t('Add positions first with the Positions button.')}</Note>}</Async>
        </fieldset>
        <Field label={t('Notes for members')}><textarea className="input" name="notes" rows={3} defaultValue={existing?.notes} maxLength={2000} /></Field>
        <Button variant="primary" busy={busy} type="submit" disabled={!countOk || !picked.length}>{existing ? t('Save changes') : t('Create schedule')}</Button>
      </form>
    </Modal>
  );
}

// ---------- Schedule detail ----------
function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}
const hms = (msLeft: number) => {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const core = [h, m, x].map((n) => String(n).padStart(2, '0')).join(':');
  return d ? `${d}d ${core}` : core;
};

export function AppointmentDetail() {
  const { id } = useParams();
  const { user } = useSession();
  const navigate = useNavigate();
  const state = useLoad<any>(`/appointments/schedules/${id}`, [id]);
  const [view, setView] = useState<'positions' | 'table'>('positions');
  const [posId, setPosId] = useState<number | null>(null);
  const [zone, setZone] = useState<'local' | 'utc'>('local');
  const [hidePast, setHidePast] = useState(true);
  const [onlyFree, setOnlyFree] = useState(false);
  const [openCell, setOpenCell] = useState<string | null>(null);
  const [assign, setAssign] = useState<null | { position: any; slot: string }>(null);
  const [editing, setEditing] = useState(false);
  const [copyText, setCopyText] = useState<string | null>(null);
  const { busy, run } = useAction();
  const { confirm, node } = useConfirm();
  const now = useNow();
  const tz = zone === 'utc' ? 'UTC' : user!.time_zone;

  const d = state.data;
  const key = (pid: number, sl: string) => `${pid}|${new Date(sl).toISOString()}`;
  const byCell = useMemo(() => new Map<string, any>((d?.bookings ?? []).map((b: any) => [key(b.position_id, b.slot_start), b])), [d]);
  const countCell = useMemo(() => new Map<string, number>((d?.application_counts ?? []).map((c: any) => [key(c.position_id, c.slot_start), c.n])), [d]);
  const appsCell = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const a of d?.applications ?? []) m.set(key(a.position_id, a.slot_start), [...(m.get(key(a.position_id, a.slot_start)) ?? []), a]);
    return m;
  }, [d]);
  const mySlots = useMemo(() => new Set((d?.bookings ?? []).filter((b: any) => b.user_id === user!.id).map((b: any) => new Date(b.slot_start).toISOString())), [d, user]);

  const reload = state.reload;
  const book = async (position: any, slot: string, userId?: number) => {
    if (await run(() => api(`/appointments/schedules/${id}/bookings`, { body: { position_id: position.id, slot_start: slot, ...(userId ? { user_id: userId } : {}) } }),
      userId && userId !== user!.id ? t('Member assigned') : t('Slot booked'))) reload();
  };
  const apply = async (position: any, slot: string) => {
    if (await run(() => api(`/appointments/schedules/${id}/applications`, { body: { position_id: position.id, slot_start: slot } }), t('Applied. The King will choose.'))) reload();
  };
  const withdraw = async (app: any) => {
    if (await run(() => api(`/appointments/applications/${app.id}`, { method: 'DELETE' }), t('Application withdrawn'))) reload();
  };
  const approve = async (app: any) => {
    if (await run(() => api(`/appointments/applications/${app.id}/approve`, { method: 'POST' }), t('Appointed'))) { setOpenCell(null); reload(); }
  };
  const cancel = async (b: any) => {
    const mine = b.user_id === user!.id;
    if (!(await confirm(mine ? t('Cancel your slot?') : t('Remove {name} from this slot?', { name: holderName(b) }),
      mine ? t('The slot becomes free for others.') : t('They will be notified.'), mine ? t('Cancel slot') : t('Remove')))) return;
    if (await run(() => api(`/appointments/bookings/${b.id}`, { method: 'DELETE' }), t('Slot freed'))) reload();
  };
  const setStatus = async (status: string) => {
    if (await run(() => api(`/appointments/schedules/${id}`, { method: 'PATCH', body: { status } }), status === 'open' ? t('Booking is open') : status === 'closed' ? t('Booking closed') : t('Saved'))) reload();
  };
  const del = async () => {
    if (!(await confirm(t('Delete this schedule?'), t('All bookings are removed and members with future slots are notified.'), t('Delete schedule')))) return;
    if (await run(() => api(`/appointments/schedules/${id}`, { method: 'DELETE' }), t('Schedule deleted'))) navigate('/appointments');
  };

  function buildText() {
    const s = d.schedule;
    const lines = [`${s.name} — ${t('times in UTC (game time)')}`, ''];
    for (const p of d.positions) {
      const bs = d.bookings.filter((b: any) => b.position_id === p.id);
      if (!bs.length) continue;
      lines.push(`${p.name}${p.buff ? ` (${p.buff})` : ''}`);
      for (const b of bs) {
        const end = new Date(new Date(b.slot_start).getTime() + s.slot_minutes * 60_000).toISOString();
        lines.push(`  ${fmtUtc(b.slot_start).replace(/\s?UTC$/, '')} – ${clock(end, 'UTC')}  ${holderName(b)}`);
      }
      lines.push('');
    }
    return lines.join('\n').trim();
  }
  async function copy() {
    const text = buildText();
    try { await navigator.clipboard.writeText(text); run(async () => true, t('Schedule copied. Paste it in game chat or Discord.')); }
    catch { setCopyText(text); }
  }

  return (
    <Async state={state}>{() => {
      const s = d.schedule, v = d.viewer;
      const applyMode = s.mode === 'apply';
      const len = s.slot_minutes * 60_000;
      const atLimit = s.max_per_member != null && v.my_count >= s.max_per_member;
      const visible: string[] = d.slots.filter((sl: string) => !hidePast || new Date(sl).getTime() + len > now);
      const position = d.positions.find((p: any) => p.id === posId) ?? d.positions[0];

      /** What a member or manager can do in one empty cell. */
      const freeCellAction = (p: any, sl: string, compact = false) => {
        const k = key(p.id, sl);
        const started = new Date(sl).getTime() <= now;
        const n = countCell.get(k) ?? 0;
        const myApp = (appsCell.get(k) ?? []).find((a: any) => a.user_id === user!.id);
        const countBadge = applyMode && <span className="applicants" title={t('{n} applied', { n })}><User size={14} aria-hidden />{n}</span>;
        if (started) return <span className="muted">—</span>;
        if (v.can_manage) {
          return <span className="cell-actions">
            {countBadge}
            {applyMode && n > 0 && <Button variant="quiet" onClick={() => setOpenCell(openCell === k ? null : k)}>{t('Choose')}</Button>}
            <Button variant="quiet" onClick={() => setAssign({ position: p, slot: sl })}>{t('Assign')}</Button>
          </span>;
        }
        if (applyMode) {
          if (myApp) return <span className="cell-actions">{countBadge}<Button variant="quiet" busy={busy} onClick={() => withdraw(myApp)}>{t('Withdraw')}</Button></span>;
          const can = s.status === 'open' && !atLimit && !mySlots.has(sl);
          return <span className="cell-actions">{countBadge}{can
            ? <Button variant={compact ? 'quiet' : 'primary'} className="apply-btn" busy={busy} onClick={() => apply(p, sl)}>{t('Apply')}</Button>
            : !compact && <span className="muted small">{mySlots.has(sl) ? t('You already hold a position at this time.') : ''}</span>}</span>;
        }
        const canBook = s.status === 'open' && !atLimit && !mySlots.has(sl);
        return canBook ? <Button variant="quiet" busy={busy} onClick={() => book(p, sl)}>{t('Book')}</Button>
          : <span className="muted">{t('Free')}</span>;
      };
      const heldCell = (b: any) => {
        const mine = b.user_id === user!.id;
        const started = new Date(b.slot_start).getTime() <= now;
        const canCancel = v.can_manage || (mine && !started && s.status !== 'closed');
        return <span className="cell-actions">
          <span className="holder">{holderName(b)}{mine && <Tag tone="gold">{t('You')}</Tag>}</span>
          {canCancel && <button className="icon-btn sm" onClick={() => cancel(b)} aria-label={mine ? t('Cancel slot') : t('Remove')}><X size={14} /></button>}
        </span>;
      };
      const applicantsList = (p: any, sl: string) => {
        const k = key(p.id, sl);
        if (!v.can_manage || openCell !== k) return null;
        return (
          <ul className="applicant-list">{(appsCell.get(k) ?? []).map((a: any) => (
            <li key={a.id}>
              <span><b>{a.ingame_name || a.display_name}</b>{a.alliance_tag && <small className="muted"> [{a.alliance_tag}]</small>}
                <small className="muted block">{t('Applied {date}', { date: fmtTime(a.created_at, user!.time_zone) })}</small></span>
              <Button variant="primary" icon={<Check size={15} />} busy={busy} onClick={() => approve(a)}>{t('Appoint')}</Button>
            </li>
          ))}</ul>
        );
      };

      return (
        <>
          {node}
          <PageHeader title={s.name}
            lead={<><Tag tone={STATUS_TONE[s.status]}>{t(STATUS_NAME[s.status])}</Tag> {applyMode ? t('Members apply, the King chooses') : t('First come, first served')} · {t('{n} per slot', { n: slotLabel(s.slot_minutes) })}
              {s.max_per_member ? ` · ${t('max {n} per member', { n: s.max_per_member })}` : ''} · {t('you have {n}', { n: v.my_count })}</>}
            actions={<>
              <Button icon={<ClipboardCopy size={16} />} onClick={copy}>{t('Copy schedule')}</Button>
              <Button icon={<Download size={16} />} onClick={() => download(`/appointments/schedules/${id}/export.csv`)}>CSV</Button>
              {v.can_manage && <>
                {s.status !== 'open' && <Button variant="primary" busy={busy} onClick={() => setStatus('open')}>{t('Open booking')}</Button>}
                {s.status === 'open' && <Button busy={busy} onClick={() => setStatus('closed')}>{t('Close booking')}</Button>}
                <Button onClick={() => setEditing(true)}>{t('Edit')}</Button>
                <Button variant="danger" icon={<Trash2 size={16} />} onClick={del} aria-label={t('Delete schedule')} />
              </>}
            </>} />
          <div className="stack">
            {s.notes && <Note>{s.notes}</Note>}
            {s.status === 'draft' && <Note tone="warn">{t('This schedule is a draft. Members cannot see it until you open booking.')}</Note>}
            {s.status === 'closed' && !v.can_manage && <Note>{t('Booking is closed. Ask an appointment manager for changes.')}</Note>}
            {atLimit && !v.can_manage && <Note>{t('You have reached the limit of {n} slots for this schedule.', { n: s.max_per_member })}</Note>}

            <div className="toolbar">
              <div className="segmented compact" role="group" aria-label={t('View')}>
                <button aria-pressed={view === 'positions'} onClick={() => setView('positions')}><LayoutGrid size={15} aria-hidden /> {t('By position')}</button>
                <button aria-pressed={view === 'table'} onClick={() => setView('table')}><Rows3 size={15} aria-hidden /> {t('All positions')}</button>
              </div>
              <div className="segmented compact" role="group" aria-label={t('Time zone')}>
                <button aria-pressed={zone === 'local'} onClick={() => setZone('local')}>{t('My time ({tz})', { tz: user!.time_zone })}</button>
                <button aria-pressed={zone === 'utc'} onClick={() => setZone('utc')}>{t('Game time (UTC)')}</button>
              </div>
              <label className="radio"><input type="checkbox" checked={hidePast} onChange={(e) => setHidePast(e.target.checked)} /> {t('Hide past slots')}</label>
              {view === 'table' && <label className="radio"><input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} /> {t('Only times with free positions')}</label>}
            </div>

            {view === 'positions' ? (
              <>
                <div className="minister-grid">{d.positions.map((p: any) => {
                  const cur = d.bookings.find((b: any) => b.position_id === p.id && new Date(b.slot_start).getTime() <= now && new Date(b.slot_start).getTime() + len > now);
                  return (
                    <button key={p.id} className={`minister-card ${position?.id === p.id ? 'active' : ''}`} onClick={() => setPosId(p.id)}>
                      <span className="minister-name">{p.name}</span>
                      {cur ? <>
                        <span className="minister-holder">{holderName(cur)}</span>
                        <span className="minister-timer">{hms(new Date(cur.slot_start).getTime() + len - now)}</span>
                      </> : <span className="minister-holder muted">{t('Not Appointed')}</span>}
                    </button>
                  );
                })}</div>

                {position && (
                  <Panel title={position.name}>
                    {position.buff && <ul className="buff-list">{position.buff.split(',').map((x: string, i: number) => <li key={i}>{x.trim()}</li>)}</ul>}
                    {visible.length ? (
                      <ul className="slot-list">{(() => { let last = ''; return visible.map((sl) => {
                        const k = key(position.id, sl);
                        const b = byCell.get(k);
                        const end = new Date(new Date(sl).getTime() + len).toISOString();
                        const day = dayLabel(sl, tz);
                        const dayHead = day !== last ? (last = day, <li key={`d-${sl}`} className="slot-day">{day}</li>) : null;
                        const isNow = new Date(sl).getTime() <= now && new Date(sl).getTime() + len > now;
                        return [dayHead, (
                          <li key={sl} className={`slot-row ${b ? 'held' : ''} ${b?.user_id === user!.id ? 'mine' : ''} ${isNow ? 'now' : ''}`}>
                            <span className="slot-time">{clock(sl, tz)}–{clock(end, tz)}{zone === 'local' && <small className="muted block">{clock(sl, 'UTC')} UTC</small>}</span>
                            <span className="slot-main">{b ? heldCell(b) : freeCellAction(position, sl)}</span>
                            {!b && applicantsList(position, sl)}
                          </li>
                        )];
                      }); })()}</ul>
                    ) : <Empty title={t('No slots to show')}>{t('Change the filters above to see more.')}</Empty>}
                  </Panel>
                )}
              </>
            ) : (() => {
              const slots = visible.filter((sl) => !onlyFree || d.positions.some((p: any) => !byCell.has(key(p.id, sl))));
              let lastDay = '';
              return slots.length ? (
                <div className="table-wrap appt-wrap">
                  <table className="table appt-grid">
                    <thead><tr><th className="appt-time">{t('Time')}</th>
                      {d.positions.map((p: any) => <th key={p.id}><b>{p.name}</b>{p.buff && <small className="muted block">{p.buff}</small>}</th>)}</tr></thead>
                    <tbody>{slots.map((sl) => {
                      const day = dayLabel(sl, tz);
                      const dayRow = day !== lastDay ? (lastDay = day, <tr key={`d-${sl}`} className="appt-day"><td colSpan={d.positions.length + 1}>{day}</td></tr>) : null;
                      const started = new Date(sl).getTime() <= now;
                      const end = new Date(new Date(sl).getTime() + len).toISOString();
                      return [dayRow, (
                        <tr key={sl} className={started ? 'past' : ''}>
                          <td className="appt-time"><b>{clock(sl, tz)}–{clock(end, tz)}</b>{zone === 'local' && <small className="muted block">{clock(sl, 'UTC')} UTC</small>}</td>
                          {d.positions.map((p: any) => {
                            const b = byCell.get(key(p.id, sl));
                            return <td key={p.id} className={`appt-cell ${b ? 'taken' : 'free'} ${b?.user_id === user!.id ? 'mine' : ''}`}>
                              {b ? heldCell(b) : freeCellAction(p, sl, true)}
                              {!b && applicantsList(p, sl)}
                            </td>;
                          })}
                        </tr>
                      )];
                    })}</tbody>
                  </table>
                </div>
              ) : <Empty title={t('No slots to show')}>{t('Change the filters above to see more.')}</Empty>;
            })()}
          </div>
          {assign && <AssignModal position={assign.position} slot={assign.slot} tz={user!.time_zone}
            onClose={() => setAssign(null)} onPick={async (uid) => { await book(assign.position, assign.slot, uid); setAssign(null); }} />}
          {editing && <ScheduleForm existing={s} existingPositions={d.positions.map((p: any) => p.id)} onClose={() => setEditing(false)} onSaved={reload} />}
          {copyText && (
            <Modal title={t('Copy schedule')} onClose={() => setCopyText(null)}>
              <textarea className="input codeblock" rows={14} readOnly value={copyText} onFocus={(e) => e.target.select()} />
            </Modal>
          )}
        </>
      );
    }}</Async>
  );
}

function AssignModal({ position, slot, tz, onClose, onPick }: { position: any; slot: string; tz: string; onClose: () => void; onPick: (uid: number) => void }) {
  const { user } = useSession();
  const [term, setTerm] = useState('');
  const results = useLoad<any>(`/appointments/members?q=${encodeURIComponent(term)}`, [term]);
  return (
    <Modal title={t('Assign {position}', { position: position.name })} onClose={onClose}>
      <div className="stack">
        <p className="muted small">{fmtTime(slot, tz)} · {fmtUtc(slot)}</p>
        <Button onClick={() => onPick(user!.id)}>{t('Take it myself')}</Button>
        <Field label={t('Search players')}><Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('Display or in-game name')} autoFocus /></Field>
        <Async state={results}>{(d) => d.users.length ? (
          <ul className="list">{d.users.map((u: any) => (
            <li key={u.id} className="list-row">
              <span><b>{u.ingame_name || u.display_name}</b> <small className="muted">{u.alliance_tag ? `[${u.alliance_tag}]` : ''}</small></span>
              <Button onClick={() => onPick(u.id)}>{t('Assign')}</Button>
            </li>
          ))}</ul>
        ) : <Empty title={t('No matching players')} />}</Async>
      </div>
    </Modal>
  );
}
