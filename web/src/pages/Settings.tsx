import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { api, download, timeZones } from '../lib/api';
import { useLoad, useSession } from '../lib/session';
import { LANGS, t, type Lang } from '../lib/i18n';
import { Async, Button, Field, Input, Modal, Note, PageHeader, Panel, useAction } from '../components/ui';

function urlB64ToUint8(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function SettingsPage() {
  const { refresh, lang, changeLang } = useSession();
  const navigate = useNavigate();
  const state = useLoad<any>('/me/profile');
  const [p, setP] = useState<any>(null);
  const [code, setCode] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { busy, run } = useAction();
  useEffect(() => { if (state.data) setP(state.data.profile); }, [state.data]);

  const save = async (patch: any, msg = t('Saved')) => {
    if (await run(() => api('/me/profile', { method: 'PATCH', body: patch }), msg)) { state.reload(); refresh(); }
  };

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    await save({ display_name: p.display_name, ingame_name: p.ingame_name || null, time_zone: p.time_zone, reminder_minutes: Number(p.reminder_minutes) }, t('Profile saved'));
  }

  async function enablePush() {
    const key = state.data.push_public_key;
    await run(async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error(t('This browser does not support notifications.'));
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error(t('Notifications were blocked. Allow them in your browser settings, then try again.'));
      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(key) });
      await api('/me/push/subscribe', { body: sub.toJSON() });
    }, t('Browser notifications on'));
    state.reload();
  }
  async function disablePush() {
    await run(async () => {
      const reg = await navigator.serviceWorker?.getRegistration('/sw.js');
      await (await reg?.pushManager.getSubscription())?.unsubscribe();
      await api('/me/push/unsubscribe', { method: 'POST' });
    }, t('Browser notifications off'));
    state.reload();
  }

  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const form = e.currentTarget;
    if (await run(() => api('/auth/change-password', { body: { current: f.get('current'), next: f.get('next') } }), t('Password changed. Other devices were signed out.'))) form.reset();
  }
  async function deleteAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (await run(() => api('/me/delete-account', { body: { password: f.get('password'), confirm: f.get('confirm') } }), t('Account deleted'))) {
      await refresh(); navigate('/login');
    }
  }

  return (
    <>
      <PageHeader title={t('Account, privacy & preferences')} />
      <Async state={state}>{(d) => p && (
        <div className="grid-2">
          <Panel title={t('Profile')}>
            <form onSubmit={saveProfile} className="stack">
              <Field label={t('Display name')}><Input value={p.display_name} onChange={(e) => setP({ ...p, display_name: e.target.value })} required minLength={2} maxLength={40} /></Field>
              <Field label={t('In-game name')}><Input value={p.ingame_name ?? ''} onChange={(e) => setP({ ...p, ingame_name: e.target.value })} maxLength={40} /></Field>
              <Field label={t('Language')}>
                <select className="input" value={lang} onChange={(e) => changeLang(e.target.value as Lang)}>
                  {LANGS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                </select>
              </Field>
              <Field label={t('Time zone')} hint={t('Every event time is shown in this zone.')}>
                <select className="input" value={p.time_zone} onChange={(e) => setP({ ...p, time_zone: e.target.value })}>
                  {timeZones.map((z) => <option key={z}>{z}</option>)}
                </select>
              </Field>
              <Field label={t('Remind me before events (minutes)')}><Input type="number" min={5} max={1440} value={p.reminder_minutes} onChange={(e) => setP({ ...p, reminder_minutes: e.target.value })} /></Field>
              <Button variant="primary" busy={busy} type="submit">{t('Save profile')}</Button>
            </form>
          </Panel>

          <Panel title={t('Privacy')}>
            <div className="stack">
              <p className="muted small">{t('Your inventory and building levels are private by default. Sharing only reaches the R4/R5 of your own alliance, never the whole kingdom.')}</p>
              <label className="radio"><input type="checkbox" checked={p.share_inventory} onChange={(e) => save({ share_inventory: e.target.checked }, e.target.checked ? t('Inventory shared with alliance leaders') : t('Inventory is private.'))} /> {t('Share my inventory with my alliance leaders')}</label>
              <label className="radio"><input type="checkbox" checked={p.share_buildings} onChange={(e) => save({ share_buildings: e.target.checked }, e.target.checked ? t('Building levels shared') : t('Building levels are private'))} /> {t('Share my building levels with my alliance leaders')}</label>
              <p className="muted small">{t('Individual plans are shared from the plan page.')}</p>
            </div>
          </Panel>

          <Panel title={t('Notifications')}>
            <div className="stack">
              <label className="radio"><input type="checkbox" checked={p.notify_site} onChange={(e) => save({ notify_site: e.target.checked })} /> {t('On this website')}</label>
              <div className="inline-form">
                <span className="grow">{t('Browser notifications')}: <b>{p.notify_push ? t('on') : t('off')}</b></span>
                {d.push_public_key
                  ? p.notify_push ? <Button onClick={disablePush}>{t('Turn off')}</Button> : <Button onClick={enablePush}>{t('Turn on')}</Button>
                  : <span className="muted small">{t('Not set up on this server')}</span>}
              </div>
              <div className="inline-form">
                <span className="grow">{t('Discord direct messages')}: <b>{p.discord_linked ? (p.notify_discord ? t('on') : t('off')) : t('account not linked')}</b></span>
                {p.discord_linked
                  ? <>
                      <Button onClick={() => save({ notify_discord: !p.notify_discord })}>{p.notify_discord ? t('Turn off') : t('Turn on')}</Button>
                      <Button variant="quiet" onClick={async () => { if (await run(() => api('/me/discord/unlink', { method: 'POST' }), t('Discord unlinked'))) state.reload(); }}>{t('Unlink')}</Button>
                    </>
                  : <Button onClick={async () => { const r: any = await run(() => api('/me/discord/link-code', { method: 'POST' })); if (r) setCode(r.code); }}>{t('Link Discord')}</Button>}
              </div>
              {code && <Note>{t('In the kingdom Discord server, type /link {code}. The code expires in 15 minutes. Then refresh this page.', { code })}</Note>}
              <p className="muted small">{t('Reminders only arrive on channels that are switched on and working. Failed deliveries are logged for admins.')}</p>
            </div>
          </Panel>

          <Panel title={t('Security')}>
            <form onSubmit={changePassword} className="stack">
              <Field label={t('Current password')}><Input name="current" type="password" required autoComplete="current-password" /></Field>
              <Field label={t('New password')} hint={t('At least 10 characters.')}><Input name="next" type="password" minLength={10} required autoComplete="new-password" /></Field>
              <Button busy={busy} type="submit">{t('Change password')}</Button>
            </form>
            <p className="muted small">{t('This site never asks for your KingShot game password.')}</p>
          </Panel>

          <Panel title={t('Your data')}>
            <div className="stack">
              <Button icon={<Download size={16} />} onClick={() => download('/me/export.json')}>{t('Download all my data')}</Button>
              <Button variant="danger" onClick={() => setDeleting(true)}>{t('Delete my account')}</Button>
              <p className="muted small">{t('Deleting removes your inventory, buildings, plans, goals and responses. Your name is removed from the audit history.')}</p>
            </div>
          </Panel>
        </div>
      )}</Async>
      {deleting && (
        <Modal title={t('Delete account')} onClose={() => setDeleting(false)}>
          <form onSubmit={deleteAccount} className="stack">
            <Note tone="warn">{t('This cannot be undone.')}</Note>
            <Field label={t('Password')}><Input name="password" type="password" required /></Field>
            <Field label={t('Type DELETE to confirm')}><Input name="confirm" required pattern="DELETE" /></Field>
            <Button variant="danger" busy={busy} type="submit">{t('Delete my account')}</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
