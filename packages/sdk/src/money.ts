// Rendering a figure (BLUEPRINT §5.6): whole minor units in integer arithmetic, grouped by the locale ("₹1,24,999" in
// en-IN), the minor digits shown only when there are any. A figure that cannot trace to a cell renders "Cannot verify".
import type { DerivedMoney, MoneyFigure } from './schema.gen.ts';

export const CANNOT_VERIFY = 'Cannot verify';
// The contracts' Ref (core's parseRef grammar), with the snapshot id, row and column captured.
export const REF = /^⟨snap:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})·([0-9]{1,6})·([a-z_][a-z0-9_]{0,62})⟩$/;

/** True when `ref` is a snapshot cell's ref in the contracts' grammar; a figure whose ref is not renders "Cannot verify". */
export function isRef(ref: unknown): ref is string {
  return typeof ref === 'string' && REF.test(ref);
}

function traces(figure: MoneyFigure | DerivedMoney): boolean {
  const refs: unknown = 'ref' in figure ? [figure.ref] : figure.from;
  return (
    Number.isSafeInteger(figure.minor) &&
    /^[A-Z]{3}$/.test(figure.currency) &&
    Array.isArray(refs) &&
    refs.length > 0 &&
    refs.every((r) => typeof r === 'string' && REF.test(r))
  );
}

export function formatMoney(figure: MoneyFigure | DerivedMoney, locale = 'en-IN'): string {
  if (!traces(figure)) return CANNOT_VERIFY;
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency: figure.currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const scale = 10n ** BigInt(digits);
  const minor = BigInt(figure.minor);
  const abs = minor < 0n ? -minor : minor;
  const fraction = abs % scale;
  // A decimal string, not a float: Intl formats it exactly, however large.
  const decimal = `${minor < 0n ? '-' : ''}${abs / scale}${fraction ? `.${fraction.toString().padStart(digits, '0')}` : ''}`;
  const shown = fraction ? digits : 0;
  return new Intl.NumberFormat(locale, { style: 'currency', currency: figure.currency, minimumFractionDigits: shown, maximumFractionDigits: shown }).format(
    decimal as Intl.StringNumericLiteral,
  );
}
