import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAdmin } from '@/lib/admin-auth';
import { normalizeText } from '@/lib/normalize';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdmin(req)) return NextResponse.json({ error: 'Neautorizat' }, { status: 401 });

  const rs = await db().execute(
    `SELECT s.id, s.slug, s.name,
            COUNT(DISTINCT p.id) AS products,
            COUNT(DISTINCT st.id) AS stores,
            COUNT(DISTINCT st.city) AS cities
     FROM supermarkets s
     LEFT JOIN products p ON p.supermarket_id = s.id
     LEFT JOIN stores st ON st.supermarket_id = s.id
     GROUP BY s.id ORDER BY s.name`
  );
  const runs = await db().execute(
    `SELECT supermarket, status, products_found, message, finished_at
     FROM scrape_runs ORDER BY id DESC LIMIT 10`
  );
  return NextResponse.json({ supermarkets: rs.rows, lastRuns: runs.rows });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAdmin(req)) return NextResponse.json({ error: 'Neautorizat' }, { status: 401 });

  const { name } = await req.json();
  if (!name || String(name).trim().length < 2) {
    return NextResponse.json({ error: 'Nume invalid' }, { status: 400 });
  }
  const slug = normalizeText(String(name)).replace(/\s+/g, '-');
  const rs = await db().execute({
    sql: `INSERT INTO supermarkets (slug, name) VALUES (?, ?)
          ON CONFLICT(slug) DO UPDATE SET name = excluded.name RETURNING id`,
    args: [slug, String(name).trim()]
  });
  return NextResponse.json({ id: Number(rs.rows[0].id), slug }, { status: 201 });
}
