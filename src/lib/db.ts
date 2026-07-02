import { createClient, type Client } from '@libsql/client';

let client: Client | null = null;

/**
 * Turso în producție (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN),
 * altfel SQLite local (file:local.db) pentru dezvoltare.
 */
export function db(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL || 'file:local.db';
    client = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN || undefined
    });
    if (url.startsWith('file:')) {
      // două procese (ex. scrapere în paralel) nu trebuie să pice pe SQLITE_BUSY
      client.execute('PRAGMA busy_timeout = 30000').catch(() => undefined);
    }
  }
  return client;
}
