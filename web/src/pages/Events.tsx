import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api, fmtDate, fmtTime, fmtUtc, isoToLocalInput, localInputToIso } from '../lib/api';
import { useLoad, useSession } from '../lib/session';
import { locale, t } from '../lib/i18n';
import { actionName } from './Admin';
import { Async, Button, Empty, Field, Input, Modal, Note, PageHeader, Panel, Tag, useAction, useConfirm } from '../components/ui';

const TYPES = [['castle', 'Castle'], ['kvk', 'KVK'], ['alliance', 'Alliance'], ['other', 'Other']] as const;
const typeName = (v: string) => t(TYPES.find((x) => x[0] === v)?.[1] ?? 'Other');
const STATUS_NAME: Record<string, string> = { published: 'published', proposed: 'proposed', draft: 'draft', cancelled: 'cancelled' };
const statusName = (s: string) => t(STATUS_NAME[s] ?? s);
const ATT: Record<string, string> = { going: 'Going', maybe: 'Maybe', not_going: 'Not going', attended: 'Attended', absent: 'Absent' };
const STATUS_TONE: Record<string, 'gold' | 'muted' | 'danger' | 'ok'> = { published: 'ok', proposed: 'gold', draft: 'muted', cancelled: 'danger' };

export function EventsPage() {
  const { user, has, isLeader } = useSession();
  const [type, setType] = useState('');
  const [creating, setCreating] = useState(false);
  const state = useLoad<any>(`/events${type ? `?type=${type}` : ''}`, [type]);
  const canCreate = has('event_manager') || isLeader;
  const tz = user!.time_zone;

  return (
    <>
      <PageHeader title={t('Castle & events')} lead={t('Times show in your time zone ({tz}). Every event is stored once in UTC.', { tz })}
        actions={canCreate && <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>{t('New event')}</Button>} />
      <div className="tabs" role="tablist">
        {[['', 'All'], ...TYPES].map(([v, l]) => <button key={v} role="tab" aria-selected={type === v} onClick={() => setType(v)}>{t(l)}</button>)}
      </div>
      <Async state={state}>{(d) => {
        const upcoming = d.events.filter((e: any) => e.status !== 'cancelled' && (!e.starts_at || new Date(e.starts_at).getTime() > Date.now() - 6 * 3600_000));
        const past = d.events.filter((e: any) => !upcoming.includes(e));
        const groups = new Map<string, any[]>();
        for (const e of upcoming) {
          const key = e.starts_at ? new Intl.DateTimeFormat(locale(), { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(e.starts_at)) : t('Time not decided');
          groups.set(key, [...(groups.get(key) ?? []), e]);
        }
        return (
          <div className="stack">
            {groups.size ? [...groups].map(([day, evs]) => (
              <Panel key={day} title={day}>
                <ul className="list">{evs.map((e) => (
                  <li key={e.id}><Link to={`/events/${e.id}`} className="list-row event-row">
                    <span className="event-time">{e.starts_at ? new Intl.DateTimeFormat(locale(), { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(e.starts_at)) : '—'}</span>
                    <span className="grow"><b>{e.title}</b><small className="muted">{typeName(e.type)} · {e.scope === 'kingdom' ? t('Kingdom') : `[${e.alliance_tag}]`}{e.poll_open ? ` · ${t('availability poll open')}` : ''}</small></span>
                    {e.status !== 'published' && <Tag tone={STATUS_TONE[e.status]}>{statusName(e.status)}</Tag>}
                    {e.status === 'published' && <span className="muted small">{t('{n} going', { n: e.going_count })}</span>}
                  </Link></li>
                ))}</ul>
              </Panel>
            )) : <Empty title={t('No upcoming events')}>{canCreate ? t('Create one, or open an availability poll first.') : t('Leaders publish events here.')}</Empty>}
            {past.length > 0 && (
              <details className="level-detail"><summary>{t('Past and cancelled events ({n})', { n: past.length })}</summary>
                <ul className="list">{past.map((e: any) => (
                  <li key={e.id}><Link to={`/events/${e.id}`} className="list-row"><span><b>{e.title}</b> <small className="muted">{fmtTime(e.starts_at, tz)}</small></span><Tag tone={STATUS_TONE[e.status]}>{statusName(e.status)}</Tag></Link></li>
                ))}</ul>
              </details>
            )}
          </div>
        );
      }}</Async>
      {creating && <EventForm onClose={() => setCreating(false)} />}
    </>
  );
}

function EventForm({ onClose, existing, onSaved }: { onClose: () => void; existing?: any; onSaved?: () => void }) {
  const { user, has, isLeader } = useSession();
  const navigate = useNavigate();
  const { busy, run } = useAction();
  const tz = user!.time_zone;
  const [scope, setScope] = useState(existing?.scope ?? (has('event_manager') ? 'kingdom' : 'alliance'));
  const [when, setWhen] = useState(isoToLocalInput(existing?.starts_at ?? null, tz));
  const willPropose = scope === 'kingdom' && !has('event_manager');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: any = {
      type: f.get('type'), title: f.get('title'), description: f.get('description'),
      duration_minutes: Number(f.get('duration')), starts_at: when ? localInputToIso(when, tz) : null,
    };
    if (existing) {
      if (await run(() => api(`/events/${existing.id}`, { method: 'PATCH', body }), existing.status === 'published' && body.starts_at !== existing.starts_at ? t('Event rescheduled. Members have been notified.') : t('Event saved'))) { onSaved?.(); onClose(); }
    } else {
      const r: any = await run(() => api('/events', { body: { ...body, scope } }), willPropose ? t('Proposal sent to kingdom officers') : t('Draft created'));
      if (r) navigate(`/events/${r.event.id}`);
    }
  }
  return (
    <Modal title={existing ? t('Edit event') : t('New event')} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        {!existing && (
          <Field label={t('Who is it for')}>
            <select className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
              {(has('event_manager') || isLeader) && <option value="kingdom">{t('Whole kingdom')}</option>}
              {user!.alliance_id && (isLeader || has('event_manager')) && <option value="alliance">{t('My alliance only')}</option>}
            </select>
          </Field>
        )}
        {willPropose && <Note>{t('Kingdom events from alliance leaders are sent as proposals. An authorised kingdom officer reviews and publishes them.')}</Note>}
        <Field label={t('Title')}><Input name="title" required minLength={2} maxLength={120} defaultValue={existing?.title} /></Field>
        <div className="row">
          <Field label={t('Type')}><select className="input" name="type" defaultValue={existing?.type ?? 'castle'}>{TYPES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select></Field>
          <Field label={t('Duration (minutes)')}><Input name="duration" type="number" min={5} defaultValue={existing?.duration_minutes ?? 60} /></Field>
        </div>
        <Field label={t('Start time ({tz})', { tz })} hint={when ? `= ${fmtUtc(localInputToIso(when, tz))}` : t('Leave empty if you will run an availability poll first.')}>
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label={t('Description')}><textarea className="input" name="description" rows={4} defaultValue={existing?.description} maxLength={4000} /></Field>
        <Button variant="primary" busy={busy} type="submit">{existing ? t('Save changes') : willPropose ? t('Send proposal') : t('Create draft')}</Button>
      </form>
    </Modal>
  );
}

export function EventDetail() {
  const { id } = useParams();
  const { user } = useSession();
  const state = useLoad<any>(`/events/${id}`, [id]);
  const [editing, setEditing] = useState(false);
  const [slotInput, setSlotInput] = useState('');
  const [picked, setPicked] = useState<number[] | null>(null);
  const { busy, run } = useAction();
  const { confirm, node } = useConfirm();
  const tz = user!.time_zone;

  const act = async (path: string, body: any, msg: string, method = 'POST') => {
    if (await run(() => api(`/events/${id}${path}`, { method, body }), msg)) state.reload();
  };

  return (
    <Async state={state}>{(d) => {
      const e = d.event, v = d.viewer;
      const mySlots = picked ?? d.slots.filter((s: any) => s.mine).map((s: any) => s.id);
      return (
        <>
          {node}
          <PageHeader title={e.title}
            lead={<><Tag tone={STATUS_TONE[e.status]}>{statusName(e.status)}</Tag> {e.scope === 'kingdom' ? t('Kingdom event') : t('[{tag}] alliance event', { tag: d.alliance?.tag })}</>}
            actions={v.can_manage || (v.is_proposer && e.status === 'proposed') ? <>
              {e.status !== 'cancelled' && <Button onClick={() => setEditing(true)}>{t('Edit')}</Button>}
              {v.can_manage && ['draft', 'proposed'].includes(e.status) && <Button variant="primary" busy={busy} onClick={() => act('/publish', undefined, t('Event published. Members have been notified.'))}>{t('Publish')}</Button>}
              {e.status !== 'cancelled' && <Button variant="danger" onClick={async () => {
                if (await confirm(t('Cancel this event?'), e.status === 'published' ? t('Everyone in the audience is notified that it is cancelled.') : t('The draft will be closed.'), t('Cancel event'))) act('/cancel', {}, t('Event cancelled'));
              }}>{t('Cancel event')}</Button>}
            </> : undefined} />
          <div className="grid-calc">
            <div className="stack">
              <Panel title={t('When')}>
                {e.starts_at ? (
                  <div className="kv">
                    <div><span>{t('Your time')}</span><b>{fmtTime(e.starts_at, tz)}</b></div>
                    <div><span>{t('Server time (UTC)')}</span><b>{fmtUtc(e.starts_at)}</b></div>
                    <div><span>{t('Duration')}</span><b>{t('{n} min', { n: e.duration_minutes })}</b></div>
                  </div>
                ) : <p className="muted">{t('Start time not decided yet.')}</p>}
                {e.description && <p className="prewrap">{e.description}</p>}
              </Panel>

              {(e.poll_open || d.slots.length > 0) && (
                <Panel title={t('Availability poll')}>
                  {e.poll_open && v.can_respond && <p className="muted small">{t('Tick every time you can make. Leaders confirm one.')}</p>}
                  <ul className="list">{d.slots.map((s: any) => (
                    <li key={s.id} className="list-row">
                      {e.poll_open && v.can_respond ? (
                        <label className="radio"><input type="checkbox" checked={mySlots.includes(s.id)}
                          onChange={() => setPicked(mySlots.includes(s.id) ? mySlots.filter((x: number) => x !== s.id) : [...mySlots, s.id])} />
                          {fmtTime(s.starts_at, tz)}</label>
                      ) : <span>{fmtTime(s.starts_at, tz)}</span>}
                      <span className="row-actions">
                        <span className="muted small">{t('{n} available', { n: s.votes })}</span>
                        {v.can_manage && e.poll_open && <Button onClick={() => act('/confirm-slot', { slot_id: s.id }, t('Time confirmed'))}>{t('Confirm this time')}</Button>}
                        {v.can_manage && e.poll_open && <Button variant="quiet" icon={<Trash2 size={15} />} aria-label={t('Remove time')} onClick={() => act(`/slots/${s.id}`, undefined, t('Time removed'), 'DELETE')} />}
                      </span>
                    </li>
                  ))}</ul>
                  {e.poll_open && v.can_respond && d.slots.length > 0 && (
                    <Button variant="primary" busy={busy} onClick={() => act('/availability', { slot_ids: mySlots }, t('Availability saved'), 'PUT')}>{t('Save my availability')}</Button>
                  )}
                </Panel>
              )}
              {v.can_manage && ['draft', 'proposed'].includes(e.status) && (
                <Panel title={t('Propose times')}>
                  <div className="inline-form">
                    <Input type="datetime-local" value={slotInput} onChange={(ev) => setSlotInput(ev.target.value)} aria-label={t('Proposed time in {tz}', { tz })} />
                    <Button disabled={!slotInput} onClick={() => { act('/slots', { starts_at: [localInputToIso(slotInput, tz)] }, t('Time added. Poll is open.')); setSlotInput(''); }}>{t('Add time')}</Button>
                  </div>
                  <p className="muted small">{t("Adding a time opens the poll to the event's audience.")}</p>
                </Panel>
              )}
            </div>

            <div className="stack">
              {e.status === 'published' && v.can_respond && (
                <Panel title={t('Your response')}>
                  <div className="segmented" role="group" aria-label={t('Attendance')}>
                    {['going', 'maybe', 'not_going'].map((s) => (
                      <button key={s} aria-pressed={d.my_attendance?.status === s} onClick={() => act('/attendance', { status: s }, t('Response saved'), 'PUT')}>{t(ATT[s])}</button>
                    ))}
                  </div>
                  {d.my_attendance?.assignment && <Note>{t('Your assignment: {text}', { text: d.my_attendance.assignment })}</Note>}
                  <p className="muted small">{t('You get a reminder before it starts unless you answer Not going.')}</p>
                </Panel>
              )}
              <Panel title={v.can_manage ? t('Attendance & assignments') : t('Going')}>
                {d.attendance.length ? (
                  <ul className="list">{d.attendance.map((a: any) => (
                    <li key={a.user_id} className="list-row">
                      <span><b>{a.display_name}</b>{a.assignment && !v.can_manage && <small className="muted"> · {a.assignment}</small>}</span>
                      {v.can_manage ? (
                        <span className="row-actions">
                          <select className="input input-sm" value={a.status} aria-label={t('Status for {name}', { name: a.display_name })}
                            onChange={(ev) => act(`/attendance/${a.user_id}`, { status: ev.target.value }, t('Updated'), 'PUT')}>
                            {Object.keys(ATT).map((s) => <option key={s} value={s}>{t(ATT[s])}</option>)}
                          </select>
                          <Input className="input input-sm" defaultValue={a.assignment} placeholder={t('Assignment')} aria-label={t('Assignment for {name}', { name: a.display_name })}
                            onBlur={(ev) => ev.target.value !== a.assignment && act(`/attendance/${a.user_id}`, { assignment: ev.target.value }, t('Assignment saved'), 'PUT')} />
                        </span>
                      ) : <Tag>{t(ATT[a.status] ?? a.status)}</Tag>}
                    </li>
                  ))}</ul>
                ) : <p className="muted">{t('No responses yet.')}</p>}
              </Panel>
              <Panel title={t('History')}>
                <ul className="list small">{d.history.map((h: any, i: number) => (
                  <li key={i}>{h.actor ?? t('System')} · {actionName(h.action)} · {fmtDate(h.created_at)}</li>
                ))}</ul>
              </Panel>
            </div>
          </div>
          {editing && <EventForm existing={e} onClose={() => setEditing(false)} onSaved={state.reload} />}
        </>
      );
    }}</Async>
  );
}
