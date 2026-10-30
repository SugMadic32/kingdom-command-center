import { Link } from 'react-router-dom';
import { Pin } from 'lucide-react';
import { fmtTime, fmtDate } from '../lib/api';
import { useLoad, useSession } from '../lib/session';
import { t } from '../lib/i18n';
import { Async, Countdown, Empty, PageHeader, Panel, Tag } from '../components/ui';

export const memberCount = (n: number) => (n === 1 ? t('1 member') : t('{n} members', { n }));

export function Overview() {
  const { user } = useSession();
  const state = useLoad<any>('/kingdom/overview');
  const tz = user!.time_zone;
  return (
    <>
      <PageHeader title={t('Kingdom overview')} lead={t('What is happening across the kingdom right now.')} />
      <Async state={state}>{(d) => {
        const nextPhase = d.phases.find((p: any) => new Date(p.starts_at) > new Date());
        const target = d.season && new Date(d.season.starts_at) > new Date() ? d.season.starts_at : nextPhase?.starts_at;
        return (
          <div className="grid-overview">
            <section className="kvk-hero">
              {d.season ? (
                <>
                  <p className="kvk-label">{target === d.season.starts_at ? t('{name} begins in', { name: d.season.name })
                    : nextPhase ? t('{name} begins in', { name: nextPhase.name }) : t('{name} is under way', { name: d.season.name })}</p>
                  {target ? <Countdown to={target} /> : <p className="kvk-live">{t('All phases have started')}</p>}
                  <p className="muted small">{target ? fmtTime(target, tz) : ''}</p>
                  <Link to="/kvk" className="btn btn-ghost">{t('Open KVK preparation')}</Link>
                </>
              ) : (
                <Empty title={t('No KVK season scheduled')}>{t('Kingdom officers add the season dates when they are announced in game.')}</Empty>
              )}
            </section>

            <div className="stat-row">
              <div className="stat"><b>{d.stats.players}</b><span>{t('players registered')}</span></div>
              <div className="stat"><b>{d.stats.alliances}</b><span>{t('alliances')}</span></div>
              <div className="stat"><b>{d.stats.upcoming_events}</b><span>{t('upcoming events')}</span></div>
              <div className="stat"><b>{d.stats.plans}</b><span>{t('upgrade plans saved')}</span></div>
            </div>

            <Panel title={t('Upcoming events')} actions={<Link to="/events">{t('All events')}</Link>}>
              {d.events.length ? (
                <ul className="list">
                  {d.events.map((e: any) => (
                    <li key={e.id}>
                      <Link to={`/events/${e.id}`} className="list-row">
                        <span><b>{e.title}</b><small className="muted">{fmtTime(e.starts_at, tz)}</small></span>
                        <Tag tone={e.scope === 'kingdom' ? 'gold' : undefined}>{e.scope === 'kingdom' ? t('Kingdom') : e.alliance_tag}</Tag>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <Empty title={t('Nothing scheduled')}>{t('Published events will appear here.')}</Empty>}
            </Panel>

            <Panel title={t('Announcements')} actions={<Link to="/announcements">{t('All announcements')}</Link>}>
              {d.announcements.length ? (
                <ul className="list">
                  {d.announcements.map((a: any) => (
                    <li key={a.id} className="announce">
                      <p className="announce-title">{a.pinned && <Pin size={14} aria-label={t('Pinned')} />} {a.title}</p>
                      <p className="clamp">{a.body}</p>
                      <small className="muted">{a.scope === 'kingdom' ? t('Kingdom') : a.alliance_tag} · {a.author} · {fmtDate(a.created_at)}</small>
                    </li>
                  ))}
                </ul>
              ) : <Empty title={t('No announcements yet')} />}
            </Panel>

            <Panel title={t('Alliance directory')} actions={<Link to="/alliances">{t('Directory')}</Link>}>
              {d.alliances.length ? (
                <ul className="list">
                  {d.alliances.map((a: any) => (
                    <li key={a.id}><Link to={`/alliances/${a.id}`} className="list-row"><span><b>[{a.tag}]</b> {a.name}</span><span className="muted">{memberCount(a.member_count)}</span></Link></li>
                  ))}
                </ul>
              ) : <Empty title={t('No alliances yet')}>{t('An admin adds alliances, starting with GTO.')}</Empty>}
            </Panel>

            {d.checklist.length > 0 && (
              <Panel title={t('KVK checklist completion')}>
                <ul className="list">
                  {d.checklist.map((c: any) => (
                    <li key={c.tag} className="bar-row">
                      <span>[{c.tag}]</span>
                      <div className="bar" role="img" aria-label={t('{n}% complete', { n: c.pct ?? 0 })}><i style={{ width: `${c.pct ?? 0}%` }} /></div>
                      <span className="num">{c.pct ?? 0}%</span>
                    </li>
                  ))}
                </ul>
                <p className="muted small">{t('Shows checklist completion only. Individual inventories are never shared kingdom-wide.')}</p>
              </Panel>
            )}
          </div>
        );
      }}</Async>
    </>
  );
}
