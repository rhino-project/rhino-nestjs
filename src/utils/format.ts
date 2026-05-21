/**
 * Currency-formatting helper. Equivalent to Laravel's
 * `ViewModelHelpers::formatPrice()` — use inside `computedAttributes` to
 * emit pre-formatted price strings.
 */
export type CurrencyCode = 'USD' | 'EUR' | 'BRL' | 'GBP' | 'JPY' | 'CNY' | 'CAD' | 'AUD' | string;

const CURRENCY_LOCALES: Record<string, { locale: string; currency: string }> = {
  USD: { locale: 'en-US', currency: 'USD' },
  EUR: { locale: 'de-DE', currency: 'EUR' },
  BRL: { locale: 'pt-BR', currency: 'BRL' },
  GBP: { locale: 'en-GB', currency: 'GBP' },
  JPY: { locale: 'ja-JP', currency: 'JPY' },
  CNY: { locale: 'zh-CN', currency: 'CNY' },
  CAD: { locale: 'en-CA', currency: 'CAD' },
  AUD: { locale: 'en-AU', currency: 'AUD' },
};

export function formatPrice(
  amount: number | null | undefined,
  currency: CurrencyCode = 'USD',
): string {
  if (amount == null || !Number.isFinite(amount)) return '';
  const cfg = CURRENCY_LOCALES[currency] ?? { locale: 'en-US', currency };
  try {
    return new Intl.NumberFormat(cfg.locale, {
      style: 'currency',
      currency: cfg.currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
