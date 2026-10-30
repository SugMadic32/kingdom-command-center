import { useState } from 'react';
import { KeyRound, RotateCw } from 'lucide-react';
import { api, fmtDate, fmtTime } from '../lib/api';
import { useLoad, useSession } from '../lib/session';
import { t } from '../lib/i18n';
import { Async, Button, Empty, Field, Input, Modal, Note, PageHeader, Panel, Tag, useAction, useConfirm } from '../components/ui';

const PERMS: [string, string, string][] = [
  ['event_manager', 'Event manager', 'Publish kingdom events and KVK seasons'],
  ['announcement_manager', 'Announcements', 'Publish kingdom announcements'],
  ['data_curator', 'Data curator', 'Edit and publish game data'],
  ['alliance_manager', 'Alliance manager', 'Create alliances and set any rank'],
  ['integration_manager', 'Integrations', 'Discord settings and delivery logs'],
  ['appointment_manager', 'Appointment manager', "Run King's appointment schedules and assign members"],
];
export const permName = (k: string) => t(PERMS.find((p) => p[0] === k)?.[1] ?? k);
const ACTIONS: Record<string, string> = {
  create: 'created', update: 'updated', delete: 'deleted', publish: 'published', propose: 'proposed', cancel: 'cancelled',
  reschedule: 'rescheduled', add_slots: 'added times', confirm_slot: 'confirmed a time', set_attendance: 'set attendance',
  import: 'imported', set_role: 'changed role', set_permissions: 'changed permissions', issue_reset_link: 'issued reset link',
  add_member: 'added member', update_member: 'updated member', remove_member: 'removed member', leave: 'left',
  view_shared: 'viewed shared data', register: 'registered', change_password: 'changed password', reset_password: 'reset password',
  delete_account: 'deleted account', book: 'booked a slot', unbook: 'freed a slot',
  apply: 'applied', withdraw: 'withdrew', approve: 'appointed',
  status_open: 'opened booking', status_closed: 'closed booking', status_draft: 'set to draft',
};
export const actionName = (a: string) => (ACTIONS[a] ? t(ACTIONS[a]) : a.replace(/_/g, ' '));
const RECORDS: Record<string, string> = {
  event: 'event', announcement: 'announcement', alliance: 'alliance', user: 'member', building_level: 'building level',
  dataset_version: 'dataset version', game_building: 'building', kvk_season: 'KVK season', kvk_phase: 'KVK phase',
  kvk_checklist_item: 'checklist item', integration: 'integration', resource_type: 'resource type',
  appointment_schedule: 'appointment schedule', appointment_position: 'appointment position',
};
const recordName = (r: string) => (RECORDS[r] ? t(RECORDS[r]) : r.replace(/_/g, ' '));

export function AdminPage() {
  const { isAdmin, has } = useSession();
  const [tab, setTab] = useState<'members' | 'integrations' | 'deliveries'>(isAdmin ? 'members' : 'integrations');
  return (
    <>
      <PageHeader title={t('Admin console')} lead={t('Roles, permissions and integrations. Every change here is recorded in the audit history.')} />
      <div className="tabs" role="tablist">
        {isAdmin && <button role="tab" aria-selected={tab === 'members'} onClick={() => setTab('members')}>{t('Members & roles')}</button>}
        {has('integration_manager') && <button role="tab" aria-selected={tab === 'integrations'} onClick={() => setTab('integrations')}>{t('Integrations')}</button>}
        {has('integration_manager') && <button role="tab" aria-selected={tab === 'deliveries'} onClick={() => setTab('deliveries')}>{t('Delivery log')}</button>}
      </div>
      {tab === 'members' && isAdmin && <Members />}
      {tab === 'integrations' && <Integrations />}
      {tab === 'deliveries' && <Deliveries />}
    </>
  );
}

function Members() {
  const { user, refresh } = useSession();
  const [term, setTerm] = useState('');
  const state = useLoad<any>(`/admin/users?q=${encodeURIComponent(term)}`, [term]);
  const [editing, setEditing] = useState<any>(null);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const { run } = useAction();
  const { confirm, node } = useConfirm();

  async function setRole(u: any, role: string) {
    if (role === 'admin' && !(await confirm(t('Make {name} a kingdom admin?', { name: u.display_name }), t('Admins hold every permission, including changing roles.'), t('Make admin')))) return;
    if (await run(() => api(`/admin/users/${u.id}/role`, { method: 'PATCH', body: { role } }), t('Role updated'))) {
      state.reload();
      if (u.id === user!.id) refresh();
    }
  }
  async function reset(u: any) {
    if (!(await confirm(t('Create a reset link for {name}?', { name: u.display_name }), t('Send it to them privately. It works once and expires in 24 hours.'), t('Create link')))) return;
    const r: any = await run(() => api(`/admin/users/${u.id}/reset-link`, { method: 'POST' }));
    if (r) setResetUrl(r.url);
  }

  return (
    <Panel>
      {node}
      <div className="inline-form"><Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('Search name or email')} aria-label={t('Search members')} /></div>
      <Async state={state}>{(d) => d.users.length ? (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('Player')}</th><th>{t('Alliance')}</th><th>{t('Kingdom role')}</th><th>{t('Permissions')}</th><th /></tr></thead>
          <tbody>{d.users.map((u: any) => (
            <tr key={u.id}>
              <td><b>{u.display_name}</b><small className="muted block">{u.email}</small></td>
              <td>{u.alliance_tag ? `[${u.alliance_tag}] ${u.rank}` : '—'}</td>
              <td>
                <select className="input input-sm" value={u.kingdom_role} onChange={(e) => setRole(u, e.target.value)} aria-label={t('Role for {name}', { name: u.display_name })}>
                  <option value="member">{t('Member')}</option><option value="officer">{t('Officer')}</option><option value="admin">{t('Admin')}</option>
                </select>
              </td>
              <td>{u.kingdom_role === 'admin' ? <Tag tone="gold">{t('All')}</Tag>
                : u.permissions.length ? u.permissions.map((p: string) => <Tag key={p}>{permName(p)}</Tag>) : <span className="muted">{t('None')}</span>}</td>
              <td className="row-actions">
                {u.kingdom_role === 'officer' && <Button variant="quiet" onClick={() => setEditing(u)}>{t('Permissions')}</Button>}
                <Button variant="quiet" icon={<KeyRound size={15} />} onClick={() => reset(u)} aria-label={t('Reset link for {name}', { name: u.display_name })} />
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty title={t('No members match')} />}</Async>
      <p className="muted small">{t('Officers have no powers until you grant specific permissions. Keep them narrow.')}</p>
      {editing && <PermissionEditor u={editing} onClose={() => setEditing(null)} onSaved={state.reload} />}
      {resetUrl && (
        <Modal title={t('Reset link')} onClose={() => setResetUrl(null)}>
          <div className="stack">
            <Input readOnly value={resetUrl} onFocus={(e) => e.target.select()} aria-label={t('Reset link')} />
            <Button onClick={() => navigator.clipboard?.writeText(resetUrl)}>{t('Copy link')}</Button>
            <p className="muted small">{t('Send it by private message only. It will not be shown again.')}</p>
          </div>
        </Modal>
      )}
    </Panel>
  );
}

function PermissionEditor({ u, onClose, onSaved }: { u: any; onClose: () => void; onSaved: () => void }) {
  const [perms, setPerms] = useState<string[]>(u.permissions);
  const { busy, run } = useAction();
  async function save() {
    if (await run(() => api(`/admin/users/${u.id}/permissions`, { method: 'PUT', body: { permissions: perms } }), t('Permissions saved'))) { onSaved(); onClose(); }
  }
  return (
    <Modal title={t('Permissions for {name}', { name: u.display_name })} onClose={onClose} footer={<Button variant="primary" busy={busy} onClick={save}>{t('Save permissions')}</Button>}>
      <div className="stack">
        {PERMS.map(([k, l, d]) => (
          <label key={k} className="radio"><input type="checkbox" checked={perms.includes(k)}
            onChange={(e) => setPerms(e.target.checked ? [...perms, k] : perms.filter((p) => p !== k))} /> <span><b>{t(l)}</b> <small className="muted block">{t(d)}</small></span></label>
        ))}
      </div>
    </Modal>
  );
}

function Integrations() {
  const state = useLoad<any>('/admin/integrations');
  const [channel, setChannel] = useState<string | null>(null);
  const { busy, run } = useAction();
  return (
    <Async state={state}>{(d) => {
      const s = d.discord;
      const ch = channel ?? s.settings.channel_id ?? '';
      const save = async (enabled: boolean) => {
        if (await run(() => api('/admin/integrations/discord', { method: 'PUT', body: { enabled, channel_id: ch } }), t('Discord settings saved'))) state.reload();
      };
      return (
        <div className="grid-2">
          <Panel title={t('Discord bot')}>
            <div className="kv">
              <div><span>{t('Bot token on server')}</span><b>{s.token_present ? t('Present') : t('Not set')}</b></div>
              <div><span>{t('Application ID')}</span><b>{s.app_id_present ? t('Present') : t('Not set')}</b></div>
              <div><span>{t('Server (guild) ID')}</span><b>{s.guild_id ?? t('Not set — commands register globally')}</b></div>
              <div><span>{t('Connection')}</span><b>{s.connected ? t('Connected') : t('Not connected')}</b></div>
            </div>
            {!s.token_present && <Note tone="warn">{t('Set DISCORD_BOT_TOKEN and DISCORD_APP_ID in the server environment and restart. The token is never entered or shown in the website.')}</Note>}
            <Field label={t('Announcement channel ID')} hint={t('Right-click the channel in Discord with Developer Mode on, then Copy Channel ID.')}>
              <Input value={ch} onChange={(e) => setChannel(e.target.value)} inputMode="numeric" />
            </Field>
            <div className="row-actions">
              {s.settings.enabled
                ? <><Button busy={busy} onClick={() => save(true)}>{t('Save channel')}</Button><Button variant="danger" busy={busy} onClick={() => save(false)}>{t('Turn off channel posts')}</Button></>
                : <Button variant="primary" busy={busy} onClick={() => save(true)}>{t('Turn on channel posts')}</Button>}
            </div>
            <p className="muted small">{s.settings.enabled ? t('Channel posts are on.') : t('Channel posts are off.')} {t('Kingdom events, changes and reminders are posted there in English. Members link their own accounts in Settings to get direct messages in their language.')}</p>
          </Panel>
          <Panel title={t('Browser notifications')}>
            <p>{d.push.configured ? t('Configured. Members can turn them on in Settings.') : t('Not configured.')}</p>
            {!d.push.configured && <p className="muted small">{t('Generate keys with npx web-push generate-vapid-keys and set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY on the server.')}</p>}
          </Panel>
        </div>
      );
    }}</Async>
  );
}

function Deliveries() {
  const { user } = useSession();
  const [status, setStatus] = useState('');
  const state = useLoad<any>(`/admin/deliveries${status ? `?status=${status}` : ''}`, [status]);
  const { run } = useAction();
  return (
    <Panel title={t('Push and Discord deliveries')} actions={
      <select className="input input-sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('Filter by status')}>
        <option value="">{t('All')}</option><option value="failed">{t('failed')}</option><option value="pending">{t('pending')}</option><option value="sent">{t('sent')}</option>
      </select>}>
      <Async state={state}>{(d) => d.deliveries.length ? (
        <div className="table-wrap"><table className="table table-tight">
          <thead><tr><th>{t('When')}</th><th>{t('Channel')}</th><th>{t('To')}</th><th>{t('Message')}</th><th>{t('Status')}</th><th /></tr></thead>
          <tbody>{d.deliveries.map((n: any) => (
            <tr key={n.id}>
              <td className="small">{fmtTime(n.sent_at ?? n.scheduled_for, user!.time_zone, false)}</td>
              <td>{n.channel}</td><td>{n.recipient ?? t('Channel')}</td><td>{n.title}</td>
              <td>{n.status === 'failed' ? <><Tag tone="danger">{t('failed')}</Tag><small className="muted block">{n.error}</small></> : <Tag tone={n.status === 'sent' ? 'ok' : 'muted'}>{t(n.status)}</Tag>}</td>
              <td>{n.status === 'failed' && <Button variant="quiet" icon={<RotateCw size={15} />} aria-label={t('Retry')}
                onClick={async () => { if (await run(() => api(`/admin/deliveries/${n.id}/retry`, { method: 'POST' }), t('Queued for retry'))) state.reload(); }} />}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty title={t('No deliveries yet')} />}</Async>
    </Panel>
  );
}

export function AuditPage() {
  const [type, setType] = useState('');
  const [before, setBefore] = useState<number | null>(null);
  const state = useLoad<any>(`/admin/audit?${new URLSearchParams({ ...(type ? { type } : {}), ...(before ? { before: String(before) } : {}) })}`, [type, before]);
  return (
    <>
      <PageHeader title={t('Audit history')} lead={t('Who created, changed, published or deleted shared records.')} />
      <Async state={state}>{(d) => (
        <Panel actions={
          <select className="input input-sm" value={type} onChange={(e) => { setType(e.target.value); setBefore(null); }} aria-label={t('Record type')}>
            <option value="">{t('All records')}</option>
            {Object.keys(RECORDS).map((k) => <option key={k} value={k}>{recordName(k)}</option>)}
          </select>}>
          {d.scope === 'alliance' && <Note>{t("You are seeing your alliance's history only.")}</Note>}
          {d.logs.length ? (
            <div className="table-wrap"><table className="table table-tight">
              <thead><tr><th>{t('When')}</th><th>{t('Who')}</th><th>{t('Action')}</th><th>{t('Record')}</th><th>{t('Details')}</th></tr></thead>
              <tbody>{d.logs.map((l: any) => (
                <tr key={l.id}>
                  <td className="small">{fmtDate(l.created_at)} {new Date(l.created_at).toISOString().slice(11, 16)} UTC</td>
                  <td>{l.actor ?? t('System')}</td><td>{actionName(l.action)}</td>
                  <td>{recordName(l.record_type)} #{l.record_id}</td>
                  <td><details><summary className="small">{t('View')}</summary><pre className="codeblock">{JSON.stringify(l.summary, null, 2)}</pre></details></td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty title={t('No entries')} />}
          <div className="row-actions">
            {before && <Button onClick={() => setBefore(null)}>{t('Newest')}</Button>}
            {d.logs.length === 100 && <Button onClick={() => setBefore(d.logs[d.logs.length - 1].id)}>{t('Older entries')}</Button>}
          </div>
        </Panel>
      )}</Async>
    </>
  );
}
