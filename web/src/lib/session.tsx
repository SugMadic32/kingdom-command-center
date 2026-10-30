import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { getLang, isLang, setLang, type Lang } from './i18n';

export type Permission = 'event_manager' | 'data_curator' | 'alliance_manager' | 'announcement_manager' | 'integration_manager';
export interface User {
  id: number; email: string; display_name: string; ingame_name: string | null;
  kingdom_role: 'member' | 'officer' | 'admin'; time_zone: string; language: string; permissions: Permission[];
  alliance_id: number | null; alliance_rank: string | null;
}

interface SessionCtx {
  user: User | null; loading: boolean; refresh: () => Promise<void>;
  has: (p: Permission) => boolean; isAdmin: boolean; isLeader: boolean;
  toast: (msg: string, kind?: 'ok' | 'error') => void;
  lang: Lang; changeLang: (l: Lang) => Promise<void>;
}
const Ctx = createContext<SessionCtx>(null as any);
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState<Lang>(getLang());
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);

  const refresh = useCallback(async () => {
    try {
      const u = (await api<{ user: User | null }>('/auth/me')).user;
      if (u && isLang(u.language) && u.language !== getLang()) { setLang(u.language); setLangState(u.language); }
      setUser(u);
    }
    catch { setUser(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const toast = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);

  const changeLang = useCallback(async (l: Lang) => {
    setLang(l);
    setLangState(l);
    if (user) { try { await api('/me/profile', { method: 'PATCH', body: { language: l } }); } catch { /* keep local choice */ } }
  }, [user]);

  const isAdmin = user?.kingdom_role === 'admin';
  const value: SessionCtx = {
    user, loading, refresh, toast, isAdmin, lang, changeLang,
    has: (p) => !!user && (isAdmin || user.permissions.includes(p)),
    isLeader: !!user && (user.alliance_rank === 'R4' || user.alliance_rank === 'R5'),
  };
  return (
    <Ctx.Provider value={value}>
      <div key={lang} className="lang-root">{children}</div>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.msg}</div>)}
      </div>
    </Ctx.Provider>
  );
}

/** Small data-loading hook with a reload function. */
export function useLoad<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try { setData(await api<T>(path)); setError(null); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}
