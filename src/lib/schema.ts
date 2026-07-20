/**
 * Schema bazei de date (SQLite / Turso).
 *
 * Modelul suportă prețuri diferite pe magazin/oraș:
 *  - `stores` = magazine fizice (cu oraș); store_id 0 în `prices` = preț național.
 *  - `prices` = prețul curent (unic per produs + magazin).
 *  - `price_history` = istoric pentru grafice/alerte (se adaugă la fiecare schimbare).
 */
import type { Client } from '@libsql/client';

/**
 * Migrări pentru baze create înainte de adăugarea unei coloane.
 * Se rulează după SCHEMA_STATEMENTS; erorile "duplicate column" se ignoră.
 */
export const MIGRATION_STATEMENTS: string[] = [
  `ALTER TABLE stores ADD COLUMN county TEXT`,
  `ALTER TABLE stores ADD COLUMN postal_code TEXT`
];

/** Aplică schema + migrările (idempotent). */
export async function ensureSchema(client: Client): Promise<void> {
  // prima trecere poate eșua pe indecși care depind de coloane noi
  // (bază creată înainte de migrare) — migrările rulează între treceri
  for (const stmt of SCHEMA_STATEMENTS) {
    try {
      await client.execute(stmt);
    } catch (err) {
      if (!/no such column/i.test((err as Error).message)) throw err;
    }
  }
  for (const stmt of MIGRATION_STATEMENTS) {
    try {
      await client.execute(stmt);
    } catch (err) {
      if (!/duplicate column/i.test((err as Error).message)) throw err;
    }
  }
  for (const stmt of SCHEMA_STATEMENTS) {
    await client.execute(stmt);
  }
  await ensureFts(client);
}

/**
 * Index full-text (FTS5) peste numele normalizate — căutarea cu instr()
 * scanează întreaga tabelă și nu scalează la cataloage complete.
 * Dacă build-ul de SQLite nu are FTS5, căutarea revine automat la instr()
 * (vezi src/lib/queries.ts) — de aceea eșecul aici nu e fatal.
 */
export async function ensureFts(client: Client): Promise<boolean> {
  try {
    // tokenchars aliniat cu normalizeText (păstrează %,./+- în interiorul
    // cuvintelor) ca interogarea și indexul să taie cuvintele identic
    await client.execute(
      `CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
        normalized_name,
        content='products',
        content_rowid='id',
        tokenize="unicode61 tokenchars '%,./+-'"
      )`
    );
    await client.execute(
      `CREATE TRIGGER IF NOT EXISTS products_fts_ai AFTER INSERT ON products BEGIN
        INSERT INTO products_fts(rowid, normalized_name) VALUES (new.id, new.normalized_name);
      END`
    );
    await client.execute(
      `CREATE TRIGGER IF NOT EXISTS products_fts_ad AFTER DELETE ON products BEGIN
        INSERT INTO products_fts(products_fts, rowid, normalized_name) VALUES ('delete', old.id, old.normalized_name);
      END`
    );
    await client.execute(
      `CREATE TRIGGER IF NOT EXISTS products_fts_au AFTER UPDATE OF normalized_name ON products BEGIN
        INSERT INTO products_fts(products_fts, rowid, normalized_name) VALUES ('delete', old.id, old.normalized_name);
        INSERT INTO products_fts(rowid, normalized_name) VALUES (new.id, new.normalized_name);
      END`
    );
    // baze existente: produsele dinaintea creării indexului nu sunt în FTS
    const [fts, products] = await Promise.all([
      client.execute(`SELECT count(*) AS c FROM products_fts`),
      client.execute(`SELECT count(*) AS c FROM products`)
    ]);
    if (Number(fts.rows[0].c) !== Number(products.rows[0].c)) {
      await client.execute(`INSERT INTO products_fts(products_fts) VALUES('rebuild')`);
    }
    return true;
  } catch {
    return false;
  }
}

export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS supermarkets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    logo_url TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supermarket_id INTEGER NOT NULL REFERENCES supermarkets(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    county TEXT,
    postal_code TEXT,
    address TEXT,
    lat REAL,
    lng REAL,
    UNIQUE(supermarket_id, external_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stores_county ON stores(county)`,
  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supermarket_id INTEGER NOT NULL REFERENCES supermarkets(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    brand TEXT,
    category TEXT,
    raw_category TEXT,
    unit_size TEXT,
    quantity REAL,
    unit TEXT,
    image_url TEXT,
    url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(supermarket_id, external_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_products_normalized_name ON products(normalized_name)`,
  `CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)`,
  `CREATE TABLE IF NOT EXISTS prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    store_id INTEGER NOT NULL DEFAULT 0,
    price REAL NOT NULL,
    old_price REAL,
    price_per_unit REAL,
    per_unit TEXT,
    currency TEXT NOT NULL DEFAULT 'RON',
    valid_from TEXT,
    valid_to TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(product_id, store_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prices_product ON prices(product_id)`,
  `CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    store_id INTEGER NOT NULL DEFAULT 0,
    price REAL NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id, recorded_at)`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS scrape_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supermarket TEXT NOT NULL,
    status TEXT NOT NULL,
    products_found INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
  )`
];
