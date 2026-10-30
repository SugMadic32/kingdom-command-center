import { useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useSession } from '../lib/session';
import { t } from '../lib/i18n';

export function PageHeader({ title, lead, actions }: { title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'quiet'; busy?: boolean; icon?: ReactNode };
export function Button({ variant = 'ghost', busy, icon, children, className = '', disabled, ...rest }: BtnProps) {
  return (
    <button className={`btn btn-${variant} ${className}`} disabled={disabled || busy} {...rest}>
      {busy ? <Loader2 size={16} className="spin" aria-hidden /> : icon}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Panel({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input className="input" {...p} />;

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Loading() {
  return <div className="loading"><Loader2 size={20} className="spin" aria-hidden /> {t('Loading')}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="note note-error" role="alert"><AlertTriangle size={16} aria-hidden /> <div>{children}</div></div>;
}
export function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return <div className={`note note-${tone}`}>{tone === 'warn' && <AlertTriangle size={16} aria-hidden />}<div>{children}</div></div>;
}

/** Wraps a page's data state so every page handles loading/error the same way. */
export function Async<T>({ state, children }: { state: { data: T | null; error: string | null; loading: boolean }; children: (d: T) => ReactNode }) {
  if (state.error) return <ErrorNote>{state.error}</ErrorNote>;
  if (!state.data) return <Loading />;
  return <>{children(state.data)}</>;
}

const STATUS_LABEL: Record<string, string> = {
  in_game_confirmed: 'In-game confirmed', cross_checked: 'Cross-checked', single_source: 'Single source',
  conflicting: 'Conflicting', missing: 'Missing',
};
/** Verification status mark: shape + text, never colour alone. */
export function StatusMark({ status }: { status: string }) {
  return <span className={`status status-${status}`}><i aria-hidden />{STATUS_LABEL[status] ? t(STATUS_LABEL[status]) : status}</span>;
}
export const statusOptions = () => Object.entries(STATUS_LABEL).map(([k, v]) => [k, t(v)] as [string, string]);

export function Tag({ children, tone }: { children: ReactNode; tone?: 'gold' | 'muted' | 'danger' | 'ok' }) {
  return <span className={`tag ${tone ? `tag-${tone}` : ''}`}>{children}</span>;
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onCancel={onClose}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label={t('Close')}><X size={18} /></button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </dialog>
  );
}

/** Confirmation for destructive actions. */
export function useConfirm() {
  const [state, setState] = useState<null | { title: string; body: ReactNode; action: string; resolve: (v: boolean) => void }>(null);
  const confirm = (title: string, body: ReactNode, action = t('Delete')) =>
    new Promise<boolean>((resolve) => setState({ title, body, action, resolve }));
  const node = state && (
    <Modal title={state.title} onClose={() => { state.resolve(false); setState(null); }}
      footer={<>
        <Button onClick={() => { state.resolve(false); setState(null); }}>{t('Keep it')}</Button>
        <Button variant="danger" onClick={() => { state.resolve(true); setState(null); }}>{state.action}</Button>
      </>}>
      {state.body}
    </Modal>
  );
  return { confirm, node };
}

/** Run an async action with busy state and toast feedback. */
export function useAction() {
  const { toast } = useSession();
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const out = await fn();
      if (success) toast(success);
      return out;
    } catch (e: any) {
      toast(e.details?.length ? `${e.message} ${e.details.slice(0, 3).join(' ')}` : e.message, 'error');
      return undefined;
    } finally { setBusy(false); }
  };
  return { busy, run };
}

export function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const diff = Math.max(0, new Date(to).getTime() - now);
  const parts = [Math.floor(diff / 86400000), Math.floor(diff / 3600000) % 24, Math.floor(diff / 60000) % 60, Math.floor(diff / 1000) % 60];
  return (
    <div className="countdown" aria-label={t('Time remaining')}>
      {[t('days'), t('hrs'), t('min'), t('sec')].map((l, i) => (
        <div key={i}><b>{String(parts[i]).padStart(2, '0')}</b><span>{l}</span></div>
      ))}
    </div>
  );
}
