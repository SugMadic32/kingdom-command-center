import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Languages } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { LANGS, t, type Lang } from '../lib/i18n';
import { Button, ErrorNote, Field, Input } from '../components/ui';

function AuthFrame({ title, children, foot }: { title: string; children: ReactNode; foot?: ReactNode }) {
  const { lang, changeLang } = useSession();
  return (
    <div className="auth">
      <label className="lang-select auth-lang">
        <Languages size={18} aria-hidden />
        <span className="sr-only">{t('Language')}</span>
        <select value={lang} onChange={(e) => changeLang(e.target.value as Lang)}>
          {LANGS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
      </label>
      <div className="auth-side" aria-hidden>
        <svg viewBox="0 0 32 32" width="56" height="56"><path d="M7 23V12l4 3 5-6 5 6 4-3v11z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        <p className="auth-word">Kingdom<br />Command<br />Center</p>
        <p className="auth-tag">{t('Plan upgrades, prepare for KVK and line up castle times with your alliance.')}</p>
      </div>
      <div className="auth-card">
        <h1>{title}</h1>
        {children}
        {foot && <p className="auth-foot">{foot}</p>}
      </div>
    </div>
  );
}

export function Login() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError('');
    try {
      await api('/auth/login', { body: { email: f.get('email'), password: f.get('password') } });
      await refresh();
      navigate('/');
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <AuthFrame title={t('Sign in')} foot={<>{t('New to the kingdom?')} <Link to="/register">{t('Create an account')}</Link></>}>
      <form onSubmit={submit} className="stack">
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label={t('Email')}><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label={t('Password')}><Input name="password" type="password" autoComplete="current-password" required /></Field>
        <Button variant="primary" busy={busy} type="submit">{t('Sign in')}</Button>
        <p className="muted small">{t('Forgot your password? Ask your kingdom admin for a reset link.')}</p>
      </form>
    </AuthFrame>
  );
}

export function Register() {
  const { refresh, lang } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError('');
    try {
      await api('/auth/register', { body: {
        email: f.get('email'), password: f.get('password'), display_name: f.get('display_name'),
        ingame_name: f.get('ingame_name') || undefined, time_zone: tz, language: lang,
      } });
      await refresh();
      navigate('/me');
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <AuthFrame title={t('Create your account')} foot={<>{t('Already registered?')} <Link to="/login">{t('Sign in')}</Link></>}>
      <form onSubmit={submit} className="stack">
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label={t('Display name')}><Input name="display_name" required minLength={2} maxLength={40} /></Field>
        <Field label={t('In-game name')} hint={t('So your alliance leaders can find you.')}><Input name="ingame_name" maxLength={40} /></Field>
        <Field label={t('Email')}><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label={t('Password')} hint={t('At least 10 characters. Never use your KingShot game password here.')}>
          <Input name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <p className="muted small">{t('Time zone detected: {tz}. You can change it later in Settings.', { tz })}</p>
        <Button variant="primary" busy={busy} type="submit">{t('Create account')}</Button>
      </form>
    </AuthFrame>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get('password') !== f.get('confirm')) return setError(t('The two passwords do not match.'));
    setBusy(true); setError('');
    try {
      await api('/auth/reset-password', { body: { token: params.get('token'), password: f.get('password') } });
      navigate('/login');
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <AuthFrame title={t('Set a new password')}>
      <form onSubmit={submit} className="stack">
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label={t('New password')}><Input name="password" type="password" minLength={10} required autoComplete="new-password" /></Field>
        <Field label={t('Repeat new password')}><Input name="confirm" type="password" minLength={10} required autoComplete="new-password" /></Field>
        <Button variant="primary" busy={busy} type="submit">{t('Save password')}</Button>
      </form>
    </AuthFrame>
  );
}
