import { describe, expect, it } from 'vitest';
import { resolveCounty } from '../src/lib/counties';

describe('resolveCounty', () => {
  it('județul explicit are prioritate', () => {
    expect(resolveCounty({ county: 'Cluj', postalCode: '300001', city: 'Iași' })).toBe('Cluj');
  });

  it('derivă din prefixul codului poștal', () => {
    expect(resolveCounty({ postalCode: '300123' })).toBe('Timiș');
    expect(resolveCounty({ postalCode: '400001' })).toBe('Cluj');
    expect(resolveCounty({ postalCode: '010101' })).toBe('București');
  });

  it('cade pe oraș când nu există cod poștal', () => {
    expect(resolveCounty({ city: 'Cluj-Napoca' })).toBe('Cluj');
    expect(resolveCounty({ city: 'Timișoara' })).toBe('Timiș');
  });

  it('null când nu se poate deriva nimic', () => {
    expect(resolveCounty({})).toBeNull();
    expect(resolveCounty({ city: 'Sat Necunoscut' })).toBeNull();
  });
});
