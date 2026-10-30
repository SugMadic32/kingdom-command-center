import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Pencil, Pin, Plus, Trash2 } from 'lucide-react';
import { FormModal, type FormSpec } from '../components/FormModal';
import { api, fmtDate, fmtTime, localInputToIso } from '../lib/api';
import { useLoad, useSession } from '../lib/session';
import { t } from '../lib/i18n';
import { Async, Button, Countdown, Empty, Field, Input, Modal, PageHeader, Panel, Tag, useAction, useConfirm } from '../components/ui';

export function KvkPage() {
  const { user } = useSession();
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const state = useLoad<any>(`/kingdom/kvk${seasonId ? `?season_id=${seasonId}` : ''}`, [seasonId]);
  const [modal, setModal] = useState<null | 'season' | 'phase' | 'item'>(null);
  const [edit, setEdit] = useState<FormSpec | null>(null);
  const { busy, run } = useAction();
  const { confirm, node } = useConfirm();
  const tz = user!.time_zone;

  async function submit(e: FormEvent<HTMLFormElement>, sid?: number) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const iso = (k: string) => (f.get(k) ? localInputToIso(String(f.get(k)), tz) : null);
    let ok;
    if (modal === 'season') ok = await run(() => api('/kingdom/kvk/seasons', { body: { name: f.get('name'), starts_at: iso('starts_at'), ends_at: iso('ends_at'), notes: f.get('notes') } }), t('Season created'));
    if (modal === 'phase') ok = await run(() => api(`/kingdom/kvk/seasons/${sid}/phases`, { body: { name: f.get('name'), starts_at: iso('starts_at'), ends_at: iso('ends_at'), description: f.get('description') } }), t('Phase added'));
    if (modal === 'item') ok = await run(() => api(`/kingdom/kvk/seasons/${sid}/checklist`, { body: { title: f.get('title'), description: f.get('description') } }), t('Checklist item added'));
    if (ok) { setModal(null); state.reload(); }
  }
  async function tick(item: any) {
    if (await run(() => api(`/kingdom/kvk/checklist/${item.id}/mine`, { method: 'PUT', body: { done: !item.done } }))) state.reload();
  }

  return (
    <Async state={state}>{(d) => {
      const s = d.season;
      const nextPhase = d.phases.find((p: any) => new Date(p.starts_at) > new Date());
      const done = d.checklist.filter((c: any) => c.done).length;
      return (
        <>
          {node}
      {edit && <FormModal {...edit} onClose={() => setEdit(null)} />}
          <PageHeader title={t('KVK preparation')} lead={t('Dates, phases and checklists are set by kingdom officers. Nothing here is hard-coded.')}
            actions={<>
              {d.seasons.length > 1 && (
                <select className="input" value={s?.id ?? ''} onChange={(e) => setSeasonId(Number(e.target.value))} aria-label={t('Season')}>
                  {d.seasons.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              )}
              {d.can_manage && s && <Button icon={<Pencil size={16} />} onClick={() => setEdit({
                title: t('Edit season'),
                fields: [
                  { name: 'name', label: t('Name'), value: s.name, required: true, max: 80 },
                  { name: 'starts_at', label: t('Starts'), value: s.starts_at, type: 'datetime', required: true },
                  { name: 'ends_at', label: t('Ends (optional)'), value: s.ends_at, type: 'datetime' },
                  { name: 'notes', label: t('Notes'), value: s.notes, type: 'textarea', max: 2000 },
                ],
                submit: async (v) => { const ok = await run(() => api(`/kingdom/kvk/seasons/${s.id}`, { method: 'PATCH', body: v }), t('Season saved')); if (ok) state.reload(); return !!ok; },
              })}>{t('Edit season')}</Button>}
              {d.can_manage && s && <Button variant="danger" icon={<Trash2 size={16} />} aria-label={t('Delete season')} onClick={async () => {
                if (await confirm(t('Delete this season?'), t('Its phases, checklist and everyone\'s ticks are deleted too.'), t('Delete season')) &&
                  await run(() => api(`/kingdom/kvk/seasons/${s.id}`, { method: 'DELETE' }), t('Season deleted'))) { setSeasonId(null); state.reload(); }
              }} />}
              {d.can_manage && <Button variant="primary" icon={<Plus size={16} />} onClick={() => setModal('season')}>{t('New season')}</Button>}
            </>} />
          {!s ? <Empty title={t('No KVK season yet')}>{d.can_manage ? t('Create a season once the in-game dates are announced.') : t('Kingdom officers add the season when dates are known.')}</Empty> : (
            <div className="grid-calc">
              <div className="stack">
                <section className="kvk-hero">
                  <p className="kvk-label">{new Date(s.starts_at) > new Date() ? t('{name} begins in', { name: s.name }) : nextPhase ? t('{name} begins in', { name: nextPhase.name }) : s.name}</p>
                  {new Date(s.starts_at) > new Date() ? <Countdown to={s.starts_at} /> : nextPhase ? <Countdown to={nextPhase.starts_at} /> : <p className="kvk-live">{t('Under way')}</p>}
                  {s.notes && <p className="prewrap muted">{s.notes}</p>}
                </section>
                <Panel title={t('Phases')} actions={d.can_manage && <Button icon={<Plus size={16} />} onClick={() => setModal('phase')}>{t('Add phase')}</Button>}>
                  {d.phases.length ? (
                    <ol className="timeline">{d.phases.map((p: any) => (
                      <li key={p.id} className={new Date(p.starts_at) < new Date() ? 'past' : ''}>
                        <b>{p.name}</b>
                        <small className="muted">{fmtTime(p.starts_at, tz)}{p.ends_at ? ` – ${fmtTime(p.ends_at, tz)}` : ''}</small>
                        {p.description && <p className="prewrap">{p.description}</p>}
                        {d.can_manage && <Button variant="quiet" icon={<Pencil size={15} />} aria-label={t('Edit {name}', { name: p.name })} onClick={() => setEdit({
                          title: t('Edit phase'),
                          fields: [
                            { name: 'name', label: t('Name'), value: p.name, required: true, max: 80 },
                            { name: 'starts_at', label: t('Starts'), value: p.starts_at, type: 'datetime', required: true },
                            { name: 'ends_at', label: t('Ends (optional)'), value: p.ends_at, type: 'datetime' },
                            { name: 'description', label: t('Description'), value: p.description, type: 'textarea', max: 2000 },
                          ],
                          submit: async (v) => { const ok = await run(() => api(`/kingdom/kvk/phases/${p.id}`, { method: 'PATCH', body: v }), t('Phase saved')); if (ok) state.reload(); return !!ok; },
                        })} />}
                        {d.can_manage && <Button variant="quiet" icon={<Trash2 size={15} />} aria-label={t('Delete {name}', { name: p.name })} onClick={async () => {
                          if (await confirm(t('Delete this phase?'), p.name, t('Delete phase')) && await run(() => api(`/kingdom/kvk/phases/${p.id}`, { method: 'DELETE' }), t('Phase deleted'))) state.reload();
                        }} />}
                      </li>
                    ))}</ol>
                  ) : <p className="muted">{t('No phases added yet.')}</p>}
                </Panel>
              </div>
              <div className="stack">
                <Panel title={t('My checklist · {done}/{total}', { done, total: d.checklist.length })} actions={d.can_manage && <Button icon={<Plus size={16} />} onClick={() => setModal('item')}>{t('Add item')}</Button>}>
                  {d.checklist.length ? (
                    <ul className="list">{d.checklist.map((c: any) => (
                      <li key={c.id} className={`goal ${c.done ? 'done' : ''}`}>
                        <button className="check" onClick={() => tick(c)} aria-pressed={c.done} aria-label={c.done ? t('Mark not done') : t('Mark done')}>{c.done && <Check size={14} />}</button>
                        <span><b>{c.title}</b>{c.description && <small className="muted block">{c.description}</small>}</span>
                        {d.can_manage && <Button variant="quiet" icon={<Pencil size={15} />} aria-label={t('Edit item')} onClick={() => setEdit({
                          title: t('Edit checklist item'),
                          fields: [
                            { name: 'title', label: t('Title'), value: c.title, required: true, max: 160 },
                            { name: 'description', label: t('Details'), value: c.description, type: 'textarea', max: 1000 },
                          ],
                          submit: async (v) => { const ok = await run(() => api(`/kingdom/kvk/checklist/${c.id}`, { method: 'PATCH', body: v }), t('Saved')); if (ok) state.reload(); return !!ok; },
                        })} />}
                        {d.can_manage && <Button variant="quiet" icon={<Trash2 size={15} />} aria-label={t('Delete item')} onClick={async () => {
                          if (await confirm(t('Delete this checklist item?'), t('Every member loses their tick for it.'), t('Delete item')) && await run(() => api(`/kingdom/kvk/checklist/${c.id}`, { method: 'DELETE' }))) state.reload();
                        }} />}
                      </li>
                    ))}</ul>
                  ) : <p className="muted">{t('No checklist items yet.')}</p>}
                </Panel>
                {d.alliance_progress && d.alliance_progress.length > 0 && (
                  <Panel title={t("My alliance's progress")}>
                    <ul className="list">{d.alliance_progress.map((a: any) => {
                      const pct = a.member_count ? Math.round((100 * a.done_count) / a.member_count) : 0;
                      return (
                        <li key={a.id} className="bar-row">
                          <span className="clamp1">{a.title}</span>
                          <div className="bar" role="img" aria-label={t('{n}% of members', { n: pct })}><i style={{ width: `${pct}%` }} /></div>
                          <span className="num">{a.done_count}/{a.member_count}</span>
                        </li>
                      );
                    })}</ul>
                  </Panel>
                )}
                <Link className="btn btn-ghost" to="/calculator">{t('Plan KVK upgrades in the calculator')}</Link>
              </div>
            </div>
          )}
          {modal && (
            <Modal title={modal === 'season' ? t('New KVK season') : modal === 'phase' ? t('Add phase') : t('Add checklist item')} onClose={() => setModal(null)}>
              <form onSubmit={(e) => submit(e, s?.id)} className="stack">
                {modal === 'item' ? <>
                  <Field label={t('Title')}><Input name="title" required maxLength={160} /></Field>
                  <Field label={t('Details')}><textarea className="input" name="description" rows={3} /></Field>
                </> : <>
                  <Field label={t('Name')}><Input name="name" required maxLength={80} /></Field>
                  <div className="row">
                    <Field label={t('Starts ({tz})', { tz })}><Input name="starts_at" type="datetime-local" required /></Field>
                    <Field label={t('Ends (optional)')}><Input name="ends_at" type="datetime-local" /></Field>
                  </div>
                  <Field label={modal === 'season' ? t('Notes') : t('Description')}><textarea className="input" name={modal === 'season' ? 'notes' : 'description'} rows={3} /></Field>
                </>}
                <Button variant="primary" busy={busy} type="submit">{t('Save')}</Button>
              </form>
            </Modal>
          )}
        </>
      );
    }}</Async>
  );
}

export function AnnouncementsPage() {
  const { user, isLeader, has } = useSession();
  const [params] = useSearchParams();
  const allianceId = params.get('alliance_id');
  const state = useLoad<any>(`/kingdom/announcements${allianceId ? `?alliance_id=${allianceId}` : ''}`, [allianceId]);
  const [writing, setWriting] = useState(false);
  const [edit, setEdit] = useState<FormSpec | null>(null);
  const { busy, run } = useAction();
  const { confirm, node } = useConfirm();
  const canWrite = has('announcement_manager') || isLeader;

  async function post(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (await run(() => api('/kingdom/announcements', { body: {
      scope: f.get('scope'), title: f.get('title'), body: f.get('body'), pinned: f.get('pinned') === 'on', notify: f.get('notify') === 'on',
    } }), t('Announcement published'))) { setWriting(false); state.reload(); }
  }
  return (
    <>
      {node}
      {edit && <FormModal {...edit} onClose={() => setEdit(null)} />}
      <PageHeader title={t('Announcements')} lead={t("Official kingdom news and your alliance's posts.")}
        actions={canWrite && <Button variant="primary" icon={<Plus size={16} />} onClick={() => setWriting(true)}>{t('Write announcement')}</Button>} />
      <Async state={state}>{(d) => d.announcements.length ? (
        <div className="stack">{d.announcements.map((a: any) => (
          <article key={a.id} className="panel announce-card">
            <header>
              <h2>{a.pinned && <Pin size={16} aria-label={t('Pinned')} />} {a.title}</h2>
              <Tag tone={a.scope === 'kingdom' ? 'gold' : undefined}>{a.scope === 'kingdom' ? t('Kingdom') : `[${a.alliance_tag}]`}</Tag>
            </header>
            <p className="prewrap">{a.body}</p>
            <footer className="muted small">
              {a.author} · {fmtDate(a.created_at)}
              {a.can_edit && <span className="row-actions">
                <Button variant="quiet" icon={<Pencil size={15} />} onClick={() => setEdit({
                  title: t('Edit announcement'),
                  fields: [
                    { name: 'title', label: t('Title'), value: a.title, required: true, max: 120 },
                    { name: 'body', label: t('Message'), value: a.body, type: 'textarea', required: true, max: 8000 },
                  ],
                  submit: async (v) => { const ok = await run(() => api(`/kingdom/announcements/${a.id}`, { method: 'PATCH', body: v }), t('Announcement saved')); if (ok) state.reload(); return !!ok; },
                })}>{t('Edit')}</Button>
                <Button variant="quiet" onClick={async () => { if (await run(() => api(`/kingdom/announcements/${a.id}`, { method: 'PATCH', body: { pinned: !a.pinned } }))) state.reload(); }}>{a.pinned ? t('Unpin') : t('Pin')}</Button>
                <Button variant="quiet" icon={<Trash2 size={15} />} aria-label={t('Delete announcement')} onClick={async () => {
                  if (await confirm(t('Delete this announcement?'), a.title, t('Delete')) && await run(() => api(`/kingdom/announcements/${a.id}`, { method: 'DELETE' }), t('Deleted'))) state.reload();
                }} />
              </span>}
            </footer>
          </article>
        ))}</div>
      ) : <Empty title={t('No announcements yet')} />}</Async>
      {writing && (
        <Modal title={t('Write announcement')} onClose={() => setWriting(false)}>
          <form onSubmit={post} className="stack">
            <Field label={t('Audience')}>
              <select className="input" name="scope">
                {has('announcement_manager') && <option value="kingdom">{t('Whole kingdom')}</option>}
                {user!.alliance_id && (isLeader || has('announcement_manager')) && <option value="alliance">{t('My alliance')}</option>}
              </select>
            </Field>
            <Field label={t('Title')}><Input name="title" required maxLength={120} /></Field>
            <Field label={t('Message')}><textarea className="input" name="body" rows={6} required maxLength={8000} /></Field>
            <label className="radio"><input type="checkbox" name="pinned" /> {t('Pin to top')}</label>
            <label className="radio"><input type="checkbox" name="notify" defaultChecked /> {t('Notify members')}</label>
            <Button variant="primary" busy={busy} type="submit">{t('Publish')}</Button>
          </form>
        </Modal>
      )}
    </>
  );
}

export function NotificationsPage() {
  const state = useLoad<any>('/me/notifications');
  const { run } = useAction();
  return (
    <>
      <PageHeader title={t('Notifications')} lead={<>{t('Choose how you are reminded in')} <Link to="/settings">{t('Settings')}</Link>.</>}
        actions={<Button onClick={async () => { if (await run(() => api('/me/notifications/read', { body: {} }))) state.reload(); }}>{t('Mark all read')}</Button>} />
      <Async state={state}>{(d) => d.notifications.length ? (
        <Panel>
          <ul className="list">{d.notifications.map((n: any) => (
            <li key={n.id} className={`notif ${n.read_at ? '' : 'unread'}`}>
              {n.link ? <Link to={n.link} onClick={() => api('/me/notifications/read', { body: { ids: [n.id] } })}><b>{n.title}</b></Link> : <b>{n.title}</b>}
              {n.body && <p className="muted">{n.body}</p>}
              <small className="muted">{fmtDate(n.created_at)}</small>
            </li>
          ))}</ul>
        </Panel>
      ) : <Empty title={t('You are all caught up')} />}</Async>
    </>
  );
}
