import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, BookOpen, Calculator, ClipboardCheck, CalendarClock, CalendarDays, ClipboardList, Crown, Flag, History, LayoutDashboard,
  Languages, LogOut, Megaphone, Menu, Moon, Package, Settings, Shield, Sun, Swords, X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { LANGS, t, type Lang } from '../lib/i18n';
import { APP_VERSION } from '../version';

const nav = [
  { group: 'Kingdom', items: [
    { to: '/', label: 'Overview', icon: Crown, end: true },
    { to: '/alliances', label: 'Alliances', icon: Flag },
    { to: '/announcements', label: 'Announcements', icon: Megaphone },
    { to: '/events', label: 'Castle & events', icon: CalendarDays },
    { to: '/kvk', label: 'KVK preparation', icon: Swords },
    { to: '/appointments', label: "King's appointments", icon: CalendarClock },
  ] },
  { group: 'My progress', items: [
    { to: '/me', label: 'My dashboard', icon: LayoutDashboard, end: true },
    { to: '/me/resources', label: 'Resources & buildings', icon: Package },
    { to: '/calculator', label: 'Upgrade calculator', icon: Calculator },
    { to: '/plans', label: 'Saved plans', icon: ClipboardList },
  ] },
  { group: 'Reference', items: [
    { to: '/data', label: 'Game data library', icon: BookOpen },
  ] },
];

export function Layout() {
  const { user, isAdmin, isLeader, has, refresh, lang, changeLang } = useSession();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [theme, setTheme] = useState(() => localStorage.getItem('kc-theme') ?? 'dark');
  const loc = useLocation();
  const navigate = useNavigate();

  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('kc-theme', theme); } catch { /* storage unavailable */ }
  }, [theme]);
  useEffect(() => {
    let alive = true;
    const poll = () => api<{ unread: number }>('/me/notifications').then((r) => alive && setUnread(r.unread)).catch(() => {});
    poll();
    const t = setInterval(poll, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [loc.pathname]);

  const showAdmin = isAdmin || has('integration_manager');
  const showAudit = isAdmin || isLeader;
  const showPlanning = isAdmin || isLeader || has('alliance_manager');

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    await refresh();
    navigate('/login');
  }

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label={t('Main navigation')}>
        <div className="brand">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden><path d="M7 23V12l4 3 5-6 5 6 4-3v11z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
          <div><b>{t('Kingdom')}</b><span>{t('Command Center')}</span></div>
          <button className="icon-btn only-mobile" onClick={() => setOpen(false)} aria-label={t('Close menu')}><X size={18} /></button>
        </div>
        <nav>
          {nav.map((g) => (
            <div key={g.group} className="nav-group">
              <p className="nav-group-label">{t(g.group)}</p>
              {g.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className="nav-link"><Icon size={18} aria-hidden />{t(label)}</NavLink>
              ))}
            </div>
          ))}
          {(showAdmin || showAudit || showPlanning) && (
            <div className="nav-group">
              <p className="nav-group-label">{t('Leadership')}</p>
              {showPlanning && <NavLink to="/planning" className="nav-link"><ClipboardCheck size={18} aria-hidden />{t('Member planning')}</NavLink>}
              {showAdmin && <NavLink to="/admin" className="nav-link"><Shield size={18} aria-hidden />{t('Admin console')}</NavLink>}
              {showAudit && <NavLink to="/audit" className="nav-link"><History size={18} aria-hidden />{t('Audit history')}</NavLink>}
            </div>
          )}
        </nav>
        <p className="sidebar-foot">{t('Fan-made planning tool. Not affiliated with Century Games.')}<br /><span className="version">v{APP_VERSION}</span></p>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden />}

      <div className="main">
        <header className="topbar">
          <button className="icon-btn only-mobile" onClick={() => setOpen(true)} aria-label={t('Open menu')}><Menu size={20} /></button>
          <div className="topbar-space" />
          <label className="lang-select">
            <Languages size={18} aria-hidden />
            <span className="sr-only">{t('Language')}</span>
            <select value={lang} onChange={(e) => changeLang(e.target.value as Lang)}>
              {LANGS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </label>
          <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? t('Switch to light theme') : t('Switch to dark theme')}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <NavLink to="/notifications" className="icon-btn bell" aria-label={t('Notifications, {n} unread', { n: unread })}>
            <Bell size={18} />{unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
          </NavLink>
          <NavLink to="/settings" className="user-chip" aria-label={t('Account settings')}>
            <span className="avatar" aria-hidden>{user?.display_name.slice(0, 1).toUpperCase()}</span>
            <span className="user-meta">
              <b>{user?.display_name}</b>
              <small>{user?.kingdom_role === 'member' ? (user.alliance_rank ?? t('Member')) : user?.kingdom_role === 'admin' ? t('Kingdom admin') : t('Officer')}</small>
            </span>
            <Settings size={16} aria-hidden className="hide-mobile" />
          </NavLink>
          <button className="icon-btn" onClick={logout} aria-label={t('Sign out')}><LogOut size={18} /></button>
        </header>
        <main className="content" id="main"><Outlet /></main>
      </div>
    </div>
  );
}

