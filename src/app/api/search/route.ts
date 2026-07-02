import { NextRequest, NextResponse } from 'next/server';
import { searchProducts } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const q = sp.get('q') ?? undefined;
  const category = sp.get('category') ?? undefined;
  const city = sp.get('city') ?? undefined;
  const county = sp.get('county') ?? undefined;
  const supermarket = sp.get('supermarket') ?? undefined;

  if (!q && !category) {
    return NextResponse.json({ products: [] });
  }

  try {
    const products = await searchProducts({ q, category, city, county, supermarket });
    return NextResponse.json({ products });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
