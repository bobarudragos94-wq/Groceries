import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin-auth';
import { parseCsv, rowsToScrapeResults } from '../../../../../scraper/csv';
import { saveScrapeResult } from '../../../../../scraper/save';

export const dynamic = 'force-dynamic';

/** Import CSV din panoul de admin (același format ca `npm run import:csv`). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAdmin(req)) return NextResponse.json({ error: 'Neautorizat' }, { status: 401 });

  const text = await req.text();
  if (!text.trim()) return NextResponse.json({ error: 'CSV gol' }, { status: 400 });

  const rows = parseCsv(text);
  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'CSV invalid. Antet minim: supermarket,external_id,name,price' },
      { status: 400 }
    );
  }

  let total = 0;
  const perSupermarket: Record<string, number> = {};
  for (const result of rowsToScrapeResults(rows)) {
    const { products } = await saveScrapeResult(result);
    perSupermarket[result.supermarket.slug] = products;
    total += products;
  }

  return NextResponse.json({ imported: total, perSupermarket });
}
