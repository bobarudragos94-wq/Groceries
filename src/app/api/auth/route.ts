import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Autentificare simplă doar cu email (fără parolă) — suficientă pentru MVP.
 * Setează un cookie cu id-ul utilizatorului; de înlocuit ulterior cu
 * magic link / NextAuth când conturile devin importante.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let email = '';
  try {
    email = String((await req.json()).email ?? '').trim().toLowerCase();
  } catch {
    /* cade în validarea de mai jos */
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'Email invalid' }, { status: 400 });
  }

  const rs = await db().execute({
    sql: `INSERT INTO users (email) VALUES (?)
          ON CONFLICT(email) DO UPDATE SET email = excluded.email
          RETURNING id, email`,
    args: [email]
  });
  const user = rs.rows[0];

  const res = NextResponse.json({ id: Number(user.id), email: String(user.email) });
  res.cookies.set('uid', String(user.id), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365
  });
  return res;
}
