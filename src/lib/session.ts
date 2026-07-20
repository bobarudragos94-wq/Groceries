import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Semnarea cookie-ului de sesiune (uid). Un cookie nesemnat ar permite
 * oricui să se dea drept orice utilizator schimbând valoarea.
 *
 * AUTH_SECRET trebuie setat în producție; în dezvoltare se generează un
 * secret efemer per proces (sesiunile expiră la restart — acceptabil local).
 */

let devSecret: string | null = null;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET nu e setat — necesar în producție pentru semnarea sesiunilor.');
  }
  if (!devSecret) devSecret = randomBytes(32).toString('hex');
  return devSecret;
}

function sign(value: string): string {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

/** Valoarea cookie-ului: "<uid>.<semnătură>". */
export function signUid(uid: number): string {
  return `${uid}.${sign(String(uid))}`;
}

/** Returnează uid-ul dacă semnătura e validă, altfel null. */
export function verifyUid(cookieValue: string | undefined): number | null {
  if (!cookieValue) return null;
  const dot = cookieValue.indexOf('.');
  if (dot <= 0) return null;
  const uid = cookieValue.slice(0, dot);
  const givenSig = Buffer.from(cookieValue.slice(dot + 1));
  const expectedSig = Buffer.from(sign(uid));
  if (givenSig.length !== expectedSig.length || !timingSafeEqual(givenSig, expectedSig)) return null;
  const n = Number(uid);
  return Number.isInteger(n) && n > 0 ? n : null;
}
