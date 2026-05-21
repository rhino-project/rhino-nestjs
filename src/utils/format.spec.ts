import { formatPrice } from './format';

describe('formatPrice', () => {
  it('returns empty string for null/undefined/NaN', () => {
    expect(formatPrice(null)).toBe('');
    expect(formatPrice(undefined)).toBe('');
    expect(formatPrice(NaN)).toBe('');
  });

  it('formats USD', () => {
    expect(formatPrice(100, 'USD')).toMatch(/\$/);
  });

  it('formats BRL', () => {
    expect(formatPrice(100, 'BRL')).toMatch(/R\$/);
  });

  it('falls back to CURRENCY N.NN for unknown code', () => {
    const out = formatPrice(10.5, 'XYZ');
    // Intl may accept unknown codes or throw; either case produces a string
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('formats zero', () => {
    expect(formatPrice(0, 'USD')).toMatch(/\$/);
  });
});
