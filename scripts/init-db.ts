import { db } from '../src/lib/db';
import { ensureSchema } from '../src/lib/schema';

async function main(): Promise<void> {
  await ensureSchema(db());
  console.log('✔ Schema aplicată.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
