import { NextRequest, NextResponse } from 'next/server';
import { compareBasket, type BasketItem } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { items?: BasketItem[]; city?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalid' }, { status: 400 });
  }

  const items = (body.items ?? []).filter((i) => typeof i.query === 'string' && i.query.trim().length > 0);
  if (items.length === 0) {
    return NextResponse.json({ error: 'Coșul este gol' }, { status: 400 });
  }
  if (items.length > 50) {
    return NextResponse.json({ error: 'Maxim 50 de articole' }, { status: 400 });
  }

  try {
    const comparisons = await compareBasket(items, body.city || undefined);
    return NextResponse.json({ comparisons });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
