import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pencil, Plus, UserMinus } from 'lucide-react';
import { FormModal, type FormSpec } from '../components/FormModal';
import { api, fmtDate, fmtNum, fmtShort } from '../lib/api';
import { useLoad, useSession } from '../lib/session';
import { levelLabel, resName, t } from '../lib/i18n';
import { QualityTag } from './Plans';
import { memberCount } from './Overview';
import { Async, Button, Empty, Field, Input, Modal, Note, PageHeader, Panel, Tag, useAction, useConfirm } from '../components/ui';

export function Alliances() {
  const { has } = useSession();
  const state = useLoad<any>('/alliances');
  const [creating, setCreating] = useState(false);
  const { busy, run } = useAction();
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ok = await run(() => api('/alliances', { body: { tag: f.get('tag'), name: f.get('name'), description: f.get('description') } }), t('Alliance created'));
    if (ok) { setCreating(false); state.reload(); }
  }
  return (
    <>
      <PageHeader title={t('Alliances')} lead={t('Every alliance in the kingdom has its own space.')}
        actions={has('alliance_manager') && <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>{t('Add alliance')}</Button>} />
      <Async state={state}>{(d) => d.alliances.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('Tag')}</th><th>{t('Name')}</th><th>{t('Leader')}</th><th className="num">{t('Members')}</th><th className="num">{t('Reported power')}</th></tr></thead>
            <tbody>
              {d.alliances.map((a: any) => (
                <tr key={a.id}>
                  <td><Link to={`/alliances/${a.id}`}><b>[{a.tag}]</b></Link></td>
                  <td>{a.name}</td><td>{a.leader ?? <span className="muted">{t('Not set')}</span>}</td>
                  <td className="num">{a.member_count}</td><td className="num" title={fmtNum(a.total_power)}>{a.total_power ? fmtShort(a.total_power) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty title={t('No alliances yet')}>{has('alliance_manager') ? t('Add GTO first, then the other alliances in the kingdom.') : t('The kingdom admin will add alliances.')}</Empty>}</Async>
      {creating && (
        <Modal title={t('Add alliance')} onClose={() => setCreating(false)}>
          <form onSubmit={create} className="stack">
            <Field label={t('Tag')} hint={t('2–6 letters or numbers, as shown in game.')}><Input name="tag" required maxLength={6} /></Field>
            <Field label={t('Name')}><Input name="name" required /></Field>
            <Field label={t('Description')}><textarea className="input" name="description" rows={3} /></Field>
            <Button variant="primary" busy={busy} type="submit">{t('Add alliance')}</Button>
          </form>
        </Modal>
      )}
    </>
  );
}

const RANKS = ['R1', 'R2', 'R3', 'R4', 'R5'];

export function AllianceDetail() {
  const { id } = useParams();
  const { user, refresh, has } = useSession();
  const state = useLoad<any>(`/alliances/${id}`, [id]);
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<FormSpec | null>(null);
  const [tab, setTab] = useState<'members' | 'shared'>('members');
  const { run } = useAction();
  const { confirm, node } = useConfirm();

  async function setRank(userId: number, rank: string) {
    if (await run(() => api(`/alliances/${id}/members/${userId}`, { method: 'PATCH', body: { rank } }), t('Rank updated'))) state.reload();
  }
  async function remove(m: any) {
    const self = m.id === user!.id;
    if (!(await confirm(self ? t('Leave this alliance?') : t('Remove {name}?', { name: m.display_name }),
      self ? t('Your shared plans stop being visible to this alliance.') : t('They lose access to alliance-only events and announcements.'),
      self ? t('Leave alliance') : t('Remove member')))) return;
    if (await run(() => api(`/alliances/${id}/members/${m.id}`, { method: 'DELETE' }), self ? t('You left the alliance') : t('Member removed'))) {
      if (self) await refresh();
      state.reload();
    }
  }

  return (
    <Async state={state}>{(d) => (
      <>
        {node}
        {edit && <FormModal {...edit} onClose={() => setEdit(null)} />}
        <PageHeader title={`[${d.alliance.tag}] ${d.alliance.name}`} lead={d.alliance.description || undefined}
          actions={<>
            <Link className="btn btn-ghost" to={`/announcements?alliance_id=${d.alliance.id}`}>{t('Announcements')}</Link>
            <Link className="btn btn-ghost" to="/events">{t('Events')}</Link>
            {d.viewer.can_manage && <Button icon={<Pencil size={16} />} onClick={() => setEdit({
              title: t('Edit alliance'),
              fields: [
                ...(has('alliance_manager') ? [{ name: 'tag', label: t('Tag'), value: d.alliance.tag, required: true, max: 6, hint: t('2–6 letters or numbers, as shown in game.') }] : []),
                { name: 'name', label: t('Name'), value: d.alliance.name, required: true, max: 60 },
                { name: 'description', label: t('Description'), value: d.alliance.description, type: 'textarea' as const, max: 1000 },
              ],
              submit: async (v) => { const ok = await run(() => api(`/alliances/${d.alliance.id}`, { method: 'PATCH', body: v }), t('Alliance saved')); if (ok) state.reload(); return !!ok; },
            })}>{t('Edit')}</Button>}
            {d.viewer.can_manage && <Button variant="primary" icon={<Plus size={16} />} onClick={() => setAdding(true)}>{t('Add member')}</Button>}
          </>} />
        {d.viewer.can_manage && d.viewer.is_member && (
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'members'} onClick={() => setTab('members')}>{t('Members')}</button>
            <button role="tab" aria-selected={tab === 'shared'} onClick={() => setTab('shared')}>{t('Shared with leaders')}</button>
          </div>
        )}
        {tab === 'members' ? (
          <Panel>
            {d.members.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{t('Player')}</th><th>{t('In-game name')}</th><th>{t('Rank')}</th><th className="num">{t('Power')}</th><th>{t('Joined')}</th><th /></tr></thead>
                  <tbody>
                    {d.members.map((m: any) => (
                      <tr key={m.id}>
                        <td>{m.display_name}{m.id === user!.id && <Tag tone="muted">{t('You')}</Tag>}</td>
                        <td>{m.ingame_name ?? '—'}</td>
                        <td>{d.viewer.can_manage && m.id !== user!.id ? (
                          <select className="input input-sm" value={m.rank} onChange={(e) => setRank(m.id, e.target.value)} aria-label={t('Rank for {name}', { name: m.display_name })}>
                            {RANKS.map((r) => <option key={r}>{r}</option>)}
                          </select>
                        ) : <Tag tone={m.rank >= 'R4' ? 'gold' : undefined}>{m.rank}</Tag>}</td>
                        <td className="num">{m.power ? fmtShort(m.power) : '—'}</td>
                        <td>{fmtDate(m.joined_at)}</td>
                        <td className="row-actions">
                          {(d.viewer.can_manage || m.id === user!.id) && (
                            <Button variant="quiet" icon={<UserMinus size={16} />} onClick={() => remove(m)} aria-label={m.id === user!.id ? t('Leave alliance') : t('Remove {name}?', { name: m.display_name })} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty title={t('No members yet')} />}
            {d.viewer.can_manage && <p className="muted small">{t('The server checks every rank change: R4 manages R1–R3, R5 can also appoint R4, and only a kingdom alliance manager can set R5.')}</p>}
          </Panel>
        ) : <SharedData allianceId={d.alliance.id} />}
        {adding && <AddMember allianceId={d.alliance.id} onDone={() => { setAdding(false); state.reload(); }} />}
      </>
    )}</Async>
  );
}

function AddMember({ allianceId, onDone }: { allianceId: number; onDone: () => void }) {
  const [term, setTerm] = useState('');
  const [rank, setRank] = useState('R1');
  const results = useLoad<any>(`/alliances/${allianceId}/candidates?q=${encodeURIComponent(term)}`, [term]);
  const { run } = useAction();
  async function add(userId: number) {
    if (await run(() => api(`/alliances/${allianceId}/members`, { body: { user_id: userId, rank } }), t('Member added'))) onDone();
  }
  return (
    <Modal title={t('Add member')} onClose={onDone}>
      <div className="stack">
        <div className="row">
          <Field label={t('Search players')}><Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('Display or in-game name')} autoFocus /></Field>
          <Field label={t('Rank')}><select className="input" value={rank} onChange={(e) => setRank(e.target.value)}>{RANKS.map((r) => <option key={r}>{r}</option>)}</select></Field>
        </div>
        <p className="muted small">{t('Only players who have an account and are not in another alliance are listed.')}</p>
        <Async state={results}>{(d) => d.users.length ? (
          <ul className="list">
            {d.users.map((u: any) => (
              <li key={u.id} className="list-row">
                <span><b>{u.display_name}</b> <small className="muted">{u.ingame_name}</small></span>
                <Button onClick={() => add(u.id)}>{t('Add as {rank}', { rank })}</Button>
              </li>
            ))}
          </ul>
        ) : <Empty title={t('No matching players')} />}</Async>
      </div>
    </Modal>
  );
}

function SharedData({ allianceId }: { allianceId: number }) {
  const state = useLoad<any>(`/alliances/${allianceId}/shared`, [allianceId]);
  return (
    <Async state={state}>{(d) => {
      const byUser = new Map<string, Record<string, number>>();
      for (const r of d.inventory) byUser.set(r.display_name, { ...(byUser.get(r.display_name) ?? {}), [r.resource_key]: r.amount });
      const keys = Array.from(new Set(d.inventory.map((r: any) => r.resource_key))) as string[];
      return (
        <div className="stack">
          <Note>{t('Only what each member chose to share appears here. Members can stop sharing at any time. Viewing this page is recorded in the audit history.')}</Note>
          <Panel title={t('Shared inventories')}>
            {byUser.size ? (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>{t('Member')}</th>{keys.map((k) => <th key={k} className="num">{resName(k)}</th>)}</tr></thead>
                <tbody>{[...byUser].map(([name, inv]) => (
                  <tr key={name}><td>{name}</td>{keys.map((k) => <td key={k} className="num" title={fmtNum(inv[k])}>{inv[k] != null ? fmtShort(inv[k]) : '—'}</td>)}</tr>
                ))}</tbody>
              </table></div>
            ) : <Empty title={t('No one is sharing inventory')} />}
          </Panel>
          <Panel title={t('Shared upgrade plans')}>
            {d.plans.length ? (
              <ul className="list">{d.plans.map((p: any) => (
                <li key={p.id} className="list-row"><span><b>{p.name}</b> <small className="muted">{t('by {name}', { name: p.display_name })}</small></span>
                  <span><QualityTag result={p.result} /></span></li>
              ))}</ul>
            ) : <Empty title={t('No shared plans')} />}
          </Panel>
          <Panel title={t('Shared building levels')}>
            {d.buildings.length ? (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>{t('Member')}</th><th>{t('Building')}</th><th className="num">{t('Level')}</th></tr></thead>
                <tbody>{d.buildings.map((b: any, i: number) => <tr key={i}><td>{b.display_name}</td><td>{b.building}</td><td className="num">{levelLabel(b.level)}</td></tr>)}</tbody>
              </table></div>
            ) : <Empty title={t('No one is sharing building levels')} />}
          </Panel>
        </div>
      );
    }}</Async>
  );
}
