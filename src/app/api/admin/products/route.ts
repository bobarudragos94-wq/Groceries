import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAdmin } from '@/lib/admin-auth';
import { normalizeText, parseUnitSize, pricePerUnit } from '@/lib/normalize';
import { mapCategory } from '@/lib/categories';

export const dynamic = 'force-dynamic';

function buildNormalizedName(name: string, brand?: string): string {
  const n = normalizeText(name);
  if (!brand) return n;
  const b = normalizeText(String(brand));
  return b && !n.includes(b) ? `${b} ${n}` : n;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdmin(req)) return NextResponse.json({ error: 'Neautorizat' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const q = sp.get('q');
  const offset = parseInt(sp.get('offset') ?? '0', 10) || 0;

  const where = q ? `WHERE p.normalized_name LIKE ?` : '';
  const args: (string | number)[] = q ? [`%${normalizeText(q)}%`] : [];
  args.push(offset);

  const rs = await db().execute({
    sql: `SELECT p.id, p.name, p.brand, p.category, p.unit_size, s.name AS supermarket,
                 (SELECT MIN(price) FROM prices WHERE product_id = p.id) AS price,
                 (SELECT MAX(updated_at) FROM prices WHERE product_id = p.id) AS updated_at
          FROM products p JOIN supermarkets s ON s.id = p.supermarket_id
          ${where}
          ORDER BY p.id DESC LIMIT 50 OFFSET ?`,
    args
  });
  return NextResponse.json({ products: rs.rows });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAdmin(req)) return NextResponse.json({ error: 'Neautorizat' }, { status: 401 });

  const body = await req.json();
  const { supermarketSlug, name, brand, category, unitSize, price } = body ?? {};
  if (!supermarketSlug || !name || !(Number(price) > 0)) {
    return NextResponse.json({ error: 'Câmpuri obligatorii: supermarketSlug, name, price' }, { status: 400 });
  }

  const client = db();
  const sm = await client.execute({
    sql: `SELECT id FROM supermarkets WHERE slug = ?`,
    args: [supermarketSlug]
  });
  if (sm.rows.length === 0) {
    return NextResponse.json({ error: `Supermarket necunoscut: ${supermarketSlug}` }, { status: 400 });
  }

  const parsed = parseUnitSize(unitSize);
  const externalId = `admin-${normalizeText(name).replace(/\s+/g, '-').slice(0, 60)}`;
  const rs = await client.execute({
    sql: `INSERT INTO products (supermarket_id, external_id, name, normalized_name, brand, category,
            unit_size, quantity, unit)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(supermarket_id, external_id) DO UPDATE SET
            name = excluded.name, normalized_name = excluded.normalized_name,
            brand = excluded.brand, category = excluded.category, unit_size = excluded.unit_size,
            quantity = excluded.quantity, unit = excluded.unit
          RETURNING id`,
    args: [
      Number(sm.rows[0].id),
      externalId,
      String(name),
      buildNormalizedName(String(name), brand),
      brand ?? null,
      category || mapCategory(null, String(name)),
      unitSize ?? null,
      parsed?.quantity ?? null,
      parsed?.unit ?? null
    ]
  });
  const productId = Number(rs.rows[0].id);
  const ppu = pricePerUnit(Number(price), parsed);

  await client.execute({
    sql: `INSERT INTO prices (product_id, store_id, price, price_per_unit, per_unit, updated_at)
          VALUES (?, 0, ?, ?, ?, datetime('now'))
          ON CONFLICT(product_id, store_id) DO UPDATE SET
            price = excluded.price, price_per_unit = excluded.price_per_unit,
            per_unit = excluded.per_unit, updated_at = excluded.updated_at`,
    args: [productId, Number(price), ppu?.value ?? null, ppu?.unit ?? null]
  });

  return NextResponse.json({ id: productId }, { status: 201 });
}
