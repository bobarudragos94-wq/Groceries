-- Coșul Ieftin — schema completă (SQLite / Turso)
-- Web-only: copiază tot și lipește în consola SQL din dashboard-ul Turso
-- (turso.tech → baza ta → tab-ul "SQL" / "Shell"), apoi rulează.
-- Rularea e sigură de repetat: toate folosesc IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS supermarkets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  logo_url TEXT
);

CREATE TABLE IF NOT EXISTS stores (
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
);
CREATE INDEX IF NOT EXISTS idx_stores_county ON stores(county);

CREATE TABLE IF NOT EXISTS products (
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
);
CREATE INDEX IF NOT EXISTS idx_products_normalized_name ON products(normalized_name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

CREATE TABLE IF NOT EXISTS prices (
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
);
CREATE INDEX IF NOT EXISTS idx_prices_product ON prices(product_id);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store_id INTEGER NOT NULL DEFAULT 0,
  price REAL NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id, recorded_at);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scrape_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supermarket TEXT NOT NULL,
  status TEXT NOT NULL,
  products_found INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

-- Cele 10 supermarketuri (optional, dar util ca sa apara in aplicatie).
INSERT INTO supermarkets (slug, name) VALUES
  ('lidl', 'Lidl'),
  ('kaufland', 'Kaufland'),
  ('profi', 'Profi'),
  ('carrefour', 'Carrefour'),
  ('mega-image', 'Mega Image'),
  ('penny', 'Penny'),
  ('auchan', 'Auchan'),
  ('selgros', 'Selgros'),
  ('metro', 'Metro'),
  ('la-cocos', 'La Cocoș')
ON CONFLICT(slug) DO UPDATE SET name = excluded.name;
