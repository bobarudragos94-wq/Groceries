import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.AUTH_SECRET = 'test-secret';
});

describe('semnarea cookie-ului de sesiune', () => {
  it('semnează și verifică un uid', async () => {
    const { signUid, verifyUid } = await import('../src/lib/session');
    const cookie = signUid(42);
    expect(cookie.startsWith('42.')).toBe(true);
    expect(verifyUid(cookie)).toBe(42);
  });

  it('respinge valori falsificate', async () => {
    const { signUid, verifyUid } = await import('../src/lib/session');
    const cookie = signUid(42);
    const forged = cookie.replace('42.', '1.');
    expect(verifyUid(forged)).toBeNull();
    expect(verifyUid('7')).toBeNull();
    expect(verifyUid('7.semnatura-falsa')).toBeNull();
    expect(verifyUid(undefined)).toBeNull();
    expect(verifyUid('')).toBeNull();
  });
});
