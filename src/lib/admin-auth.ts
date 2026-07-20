import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Garda panoului de admin (antetul x-admin-password).
 *
 *  - comparație în timp constant (fără scurgeri prin timing);
 *  - în PRODUCȚIE parola trebuie setată explicit și diferită de „admin” —
 *    altfel panoul e dezactivat (503), nu lăsat deschis pe implicit;
 *  - limitare de încercări eșuate per IP (fereastră glisantă). Limita e
 *    per-instanță (în serverless fiecare instanță numără separat) — nu e
 *    perfectă, dar oprește ghicirea naivă de parole fără infrastructură nouă.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function passwordsMatch(given: string, expected: string): boolean {
  // hash-urile au lungime egală → timingSafeEqual nu aruncă și nu scurge lungimea
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Returnează null dacă cererea e autorizată, altfel răspunsul de eroare
 * (401 parolă greșită, 429 prea multe încercări, 503 parolă neconfigurată).
 */
export function requireAdmin(req: NextRequest): NextResponse | null {
  const configured = process.env.ADMIN_PASSWORD || '';
  if (process.env.NODE_ENV === 'production' && (!configured || configured === 'admin')) {
    return NextResponse.json(
      { error: 'ADMIN_PASSWORD nu e setat (sau e lăsat pe „admin”) — panoul de admin e dezactivat.' },
      { status: 503 }
    );
  }
  const expected = configured || 'admin'; // implicitul „admin” doar în dezvoltare

  const ip = clientIp(req);
  const now = Date.now();
  const entry = failures.get(ip);
  if (entry && entry.resetAt > now && entry.count >= MAX_FAILURES) {
    return NextResponse.json({ error: 'Prea multe încercări eșuate — reîncearcă în câteva minute.' }, { status: 429 });
  }

  if (!passwordsMatch(req.headers.get('x-admin-password') ?? '', expected)) {
    const e = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + WINDOW_MS };
    e.count++;
    failures.set(ip, e);
    if (failures.size > 1000) {
      for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
    }
    return NextResponse.json({ error: 'Neautorizat' }, { status: 401 });
  }

  failures.delete(ip);
  return null;
}
