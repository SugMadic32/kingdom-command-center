import { useState, type FormEvent } from 'react';
import { isoToLocalInput, localInputToIso } from '../lib/api';
import { useSession } from '../lib/session';
import { t } from '../lib/i18n';
import { Button, Field, Input, Modal } from './ui';

export interface FormField {
  name: string; label: string; value?: string | number | null;
  type?: 'text' | 'textarea' | 'number' | 'datetime'; required?: boolean; hint?: string; max?: number; min?: number;
}
export interface FormSpec {
  title: string; fields: FormField[];
  /** Return true when saved; the modal then closes. Empty optional fields arrive as null. */
  submit: (values: Record<string, any>) => Promise<boolean | undefined>;
}

/** Small reusable edit form. Date-time fields are shown in the member's time zone and sent as UTC. */
export function FormModal({ title, fields, submit, onClose }: FormSpec & { onClose: () => void }) {
  const { user } = useSession();
  const tz = user?.time_zone ?? 'UTC';
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const out: Record<string, any> = {};
    for (const fl of fields) {
      const raw = String(f.get(fl.name) ?? '');
      if (fl.type === 'datetime') out[fl.name] = raw ? localInputToIso(raw, tz) : null;
      else if (fl.type === 'number') out[fl.name] = raw === '' ? null : Number(raw);
      else out[fl.name] = fl.required || raw !== '' ? raw : (fl.type === 'textarea' ? '' : null);
    }
    setBusy(true);
    try { if (await submit(out)) onClose(); } finally { setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={onSubmit} className="stack">
        {fields.map((fl) => {
          const label = fl.type === 'datetime' ? `${fl.label} (${tz})` : fl.label;
          if (fl.type === 'textarea') return <Field key={fl.name} label={label} hint={fl.hint}><textarea className="input" name={fl.name} rows={4} defaultValue={fl.value ?? ''} required={fl.required} maxLength={fl.max} /></Field>;
          if (fl.type === 'datetime') return <Field key={fl.name} label={label} hint={fl.hint}><Input type="datetime-local" name={fl.name} defaultValue={isoToLocalInput((fl.value as string) ?? null, tz)} required={fl.required} /></Field>;
          return <Field key={fl.name} label={label} hint={fl.hint}><Input name={fl.name} type={fl.type === 'number' ? 'number' : 'text'} defaultValue={fl.value ?? ''} required={fl.required} maxLength={fl.type === 'number' ? undefined : fl.max} max={fl.type === 'number' ? fl.max : undefined} min={fl.min} /></Field>;
        })}
        <Button variant="primary" busy={busy} type="submit">{t('Save changes')}</Button>
      </form>
    </Modal>
  );
}
