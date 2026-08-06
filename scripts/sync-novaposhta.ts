import { config as loadEnv } from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@balier/lib/db/schema';
import { createNovaPoshtaClient } from '@balier/lib/novaposhta/client';
import { syncNovaPoshtaReferenceData } from '@balier/lib/novaposhta/sync';

loadEnv({ path: '.dev.vars', quiet: true });
loadEnv({ quiet: true });

const databaseUrl = process.env.DATABASE_URL;
const apiKey = process.env.NOVAPOSHTA_API_KEY;

if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .dev.vars.example to .dev.vars first.');
  process.exit(1);
}

if (!apiKey) {
  console.error('NOVAPOSHTA_API_KEY is not set.');
  process.exit(1);
}

/**
 * Manual/initial full sync — `workers/cron/index.ts` runs the same
 * `syncNovaPoshtaReferenceData` daily to keep it fresh; this is for
 * populating a fresh database (dev, or a first run after Phase 5's account
 * migration) without waiting for the next 04:00 UTC cron tick.
 */
async function main() {
  const db = drizzle(neon(databaseUrl!), { schema });
  const client = createNovaPoshtaClient(apiKey!);

  console.log('Syncing Nova Poshta reference data — this can take a few minutes…');
  const result = await syncNovaPoshtaReferenceData(client, db);
  console.log(
    `Synced ${result.settlements} settlements and ${result.warehouses} warehouses ` +
      `(${result.retired} no longer in the feed, retired).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
