import { describeAmount, parseAmount } from '../lib/amount';
import { t } from '../lib/i18n';
import { Input } from './ui';

/** Number box that accepts 295M / 1.5B / 250K and shows exactly what it means underneath. */
export function AmountInput({ id, value, onChange, label, disabled, placeholder }:
  { id?: string; value: string; onChange: (v: string) => void; label?: string; disabled?: boolean; placeholder?: string }) {
  const n = parseAmount(value);
  const typed = value.trim() !== '';
  return (
    <div className="amount-input">
      <Input id={id} inputMode="text" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} disabled={disabled}
        placeholder={placeholder} aria-invalid={typed && Number.isNaN(n)} autoComplete="off" />
      {typed && (Number.isNaN(n)
        ? <span className="amount-hint bad">{t('Not a number. Type for example 295M or 1.5B.')}</span>
        : /[^\d\s,.]/.test(value) || n >= 1000 ? <span className="amount-hint">= {describeAmount(n)}</span> : null)}
    </div>
  );
}
