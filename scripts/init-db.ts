import { db } from '../src/lib/db';
import { SCHEMA_STATEMENTS } from '../src/lib/schema';

async function main(): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await db().execute(stmt);
  }
  console.log('✔ Schema aplicată.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
