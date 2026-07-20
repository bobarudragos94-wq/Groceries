import { describe, expect, it } from 'vitest';
import { normalizeText, parseKauflandBasePrice, parseUnitSize, pricePerUnit } from '../src/lib/normalize';

describe('normalizeText', () => {
  it('elimină diacriticele și pune pe litere mici', () => {
    expect(normalizeText('Roșii Țărănești')).toBe('rosii taranesti');
    expect(normalizeText('Brânză și Șuncă')).toBe('branza si sunca');
  });

  it('păstrează cifrele și semnele din gramaje', () => {
    expect(normalizeText('Lapte 1,5% UHT 1L')).toBe('lapte 1,5% uht 1l');
  });

  it('comprimă spațiile și taie marginile', () => {
    expect(normalizeText('  apă   plată  ')).toBe('apa plata');
  });
});

describe('parseUnitSize', () => {
  it('parsează formate simple', () => {
    expect(parseUnitSize('1 L')).toEqual({ quantity: 1, unit: 'l' });
    expect(parseUnitSize('500g')).toEqual({ quantity: 0.5, unit: 'kg' });
    expect(parseUnitSize('750 ml')).toEqual({ quantity: 0.75, unit: 'l' });
    expect(parseUnitSize('10 buc')).toEqual({ quantity: 10, unit: 'buc' });
    expect(parseUnitSize('10 ouă')).toEqual({ quantity: 10, unit: 'buc' });
  });

  it('parsează multipack', () => {
    expect(parseUnitSize('6x1,5l')).toEqual({ quantity: 9, unit: 'l' });
    expect(parseUnitSize('4 x 100 g')).toEqual({ quantity: 0.4, unit: 'kg' });
  });

  it('acceptă virgula ca separator zecimal', () => {
    expect(parseUnitSize('1,5 l')).toEqual({ quantity: 1.5, unit: 'l' });
  });

  it('„bucata” fără număr = 1 buc', () => {
    expect(parseUnitSize('la bucata')).toEqual({ quantity: 1, unit: 'buc' });
  });

  it('returnează null pentru text nerecunoscut sau gol', () => {
    expect(parseUnitSize('promoție de vară')).toBeNull();
    expect(parseUnitSize('')).toBeNull();
    expect(parseUnitSize(null)).toBeNull();
    expect(parseUnitSize(undefined)).toBeNull();
  });

  it('extrage gramajul din numele produsului, sărind peste procente', () => {
    expect(parseUnitSize('Lapte Zuzu 1,5% 1 l')).toEqual({ quantity: 1, unit: 'l' });
  });
});

describe('pricePerUnit', () => {
  it('calculează lei/unitate de bază', () => {
    expect(pricePerUnit(5, { quantity: 0.5, unit: 'kg' })).toEqual({ value: 10, unit: 'kg' });
    expect(pricePerUnit(9, { quantity: 9, unit: 'l' })).toEqual({ value: 1, unit: 'l' });
  });

  it('null pentru cantitate lipsă sau zero', () => {
    expect(pricePerUnit(5, null)).toBeNull();
    expect(pricePerUnit(5, { quantity: 0, unit: 'kg' })).toBeNull();
  });
});

describe('parseKauflandBasePrice', () => {
  it('parsează formatul de preț de referință', () => {
    expect(parseKauflandBasePrice('(=1 kg 37.98)')).toEqual({ value: 37.98, unit: 'kg' });
    expect(parseKauflandBasePrice('(=100 g 3.80)')).toEqual({ value: 38, unit: 'kg' });
  });

  it('null pentru format necunoscut', () => {
    expect(parseKauflandBasePrice('preț special')).toBeNull();
    expect(parseKauflandBasePrice(null)).toBeNull();
  });
});
