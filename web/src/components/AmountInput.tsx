import { describeAmount, parseAmount } from '../lib/amount';
import { t } from '../lib/i18n';
import { Input } from './ui';

/** Number box that accepts 295M / 1.5B / 250K and shows exactly what it means underneath. */
export function AmountInput({ id, value, onChange, label, disabled, placeholder, warnSmall }:
  { id?: string; value: string; onChange: (v: string) => void; label?: string; disabled?: boolean; placeholder?: string; warnSmall?: boolean }) {
  const n = parseAmount(value);
  const typed = value.trim() !== '';
  // Bread/Wood/Stone/Iron are usually millions: a plain 141 is almost always a typo for 141M
  const looksTooSmall = warnSmall && typed && !Number.isNaN(n) && n > 0 && n < 10000 && /^[\d\s,.]+$/.test(value.trim());
  return (
    <div className="amount-input">
      <Input id={id} inputMode="text" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} disabled={disabled}
        placeholder={placeholder} aria-invalid={typed && Number.isNaN(n)} autoComplete="off" />
      {typed && (Number.isNaN(n)
        ? <span className="amount-hint bad">{t('Not a number. Type for example 295M or 1.5B.')}</span>
        : looksTooSmall ? <span className="amount-hint warn">{t('Only {n}. Did you mean {n}M?', { n: value.trim() })}</span>
        : /[^\d\s,.]/.test(value) || n >= 1000 ? <span className="amount-hint">= {describeAmount(n)}</span> : null)}
    </div>
  );
}
