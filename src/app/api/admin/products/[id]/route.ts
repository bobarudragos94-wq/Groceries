import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';
import { normalizeText, parseUnitSize, pricePerUnit } from '@/lib/normalize';

export const dynamic = 'force-dynamic';

function buildNormalizedName(name: string, brand?: string): string {
  const n = normalizeText(name);
  if (!brand) return n;
  const b = normalizeText(String(brand));
  return b && !n.includes(b) ? `${b} ${n}` : n;
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const id = parseInt(params.id, 10);
  if (!id) return NextResponse.json({ error: 'Id invalid' }, { status: 400 });

  const body = await req.json();
  const { name, brand, category, unitSize, price } = body ?? {};
  const client = db();

  if (name || brand !== undefined || category || unitSize !== undefined) {
    const parsed = parseUnitSize(unitSize);
    await client.execute({
      sql: `UPDATE products SET
              name = COALESCE(?, name),
              normalized_name = CASE WHEN ? IS NULL THEN normalized_name ELSE ? END,
              brand = COALESCE(?, brand),
              category = COALESCE(?, category),
              unit_size = COALESCE(?, unit_size),
              quantity = COALESCE(?, quantity),
              unit = COALESCE(?, unit)
            WHERE id = ?`,
      args: [
        name ?? null,
        name ?? null,
        name ? buildNormalizedName(String(name), brand) : null,
        brand ?? null,
        category ?? null,
        unitSize ?? null,
        parsed?.quantity ?? null,
        parsed?.unit ?? null,
        id
      ]
    });
  }

  if (Number(price) > 0) {
    const prod = await client.execute({ sql: `SELECT unit_size FROM products WHERE id = ?`, args: [id] });
    const parsed = parseUnitSize(unitSize ?? (prod.rows[0]?.unit_size as string | undefined));
    const ppu = pricePerUnit(Number(price), parsed);
    await client.execute({
      sql: `INSERT INTO prices (product_id, store_id, price, price_per_unit, per_unit, updated_at)
            VALUES (?, 0, ?, ?, ?, datetime('now'))
            ON CONFLICT(product_id, store_id) DO UPDATE SET
              price = excluded.price, price_per_unit = excluded.price_per_unit,
              per_unit = excluded.per_unit, updated_at = excluded.updated_at`,
      args: [id, Number(price), ppu?.value ?? null, ppu?.unit ?? null]
    });
    await client.execute({
      sql: `INSERT INTO price_history (product_id, store_id, price) VALUES (?, 0, ?)`,
      args: [id, Number(price)]
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const id = parseInt(params.id, 10);
  if (!id) return NextResponse.json({ error: 'Id invalid' }, { status: 400 });

  await db().execute({ sql: `DELETE FROM products WHERE id = ?`, args: [id] });
  return NextResponse.json({ ok: true });
}
