import { and, inArray, lt, sql } from 'drizzle-orm';
import { createDb, createTxDb } from '~/lib/db';
import { orders, stockReservations } from '~/lib/db/schema';
import { createNovaPoshtaClient } from '~/lib/novaposhta/client';
import { syncNovaPoshtaReferenceData } from '~/lib/novaposhta/sync';

/**
 * Scheduled jobs run in their own Worker rather than in the Astro Worker.
 *
 * The Astro adapter owns the app Worker's entrypoint and exports only `fetch`,
 * so there is nowhere to hang a `scheduled` handler. Keeping crons separate also
 * means a slow reference-data sync can never eat into request-path CPU budget,
 * and the two deploy and roll back independently. Shared domain code is imported
 * straight from `src/lib`.
 *
 * Deploy: pnpm cron:deploy
 * Dev:    pnpm cron:dev, then hit the printed `__scheduled` URL with a cron= param.
 */
export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    switch (event.cron) {
      // Every 15 minutes — release reservations for orders that were never paid.
      case '*/15 * * * *':
        ctx.waitUntil(releaseExpiredReservations(env));
        break;

      // 04:00 UTC daily — refresh the Nova Poshta settlement/warehouse cache.
      case '0 4 * * *':
        ctx.waitUntil(syncNovaPoshta(env));
        break;

      default:
        console.warn(`Unhandled cron trigger: ${event.cron}`);
    }
  },
} satisfies ExportedHandler<Env>;

/**
 * A 30-minute reservation TTL is meaningless without this: a card checkout
 * that never reaches payment would otherwise hold its stock forever. Cash on
 * delivery never leaves a reservation lying around — `createOrder` resolves
 * it immediately — so this only ever finds card orders that stalled at
 * `pending`/`awaiting_payment`.
 */
async function releaseExpiredReservations(env: Env): Promise<void> {
  const { db, close } = createTxDb(env.DATABASE_URL);

  try {
    await db.transaction(async (tx) => {
      const expired = await tx
        .delete(stockReservations)
        .where(lt(stockReservations.expiresAt, sql`now()`))
        .returning({ orderId: stockReservations.orderId });

      const orderIds = [...new Set(expired.map((row) => row.orderId))];
      if (orderIds.length === 0) return;

      await tx
        .update(orders)
        .set({ status: 'cancelled', cancelledAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(inArray(orders.id, orderIds), inArray(orders.status, ['pending', 'awaiting_payment'])),
        );
    });
  } finally {
    await close();
  }
}

async function syncNovaPoshta(env: Env): Promise<void> {
  const db = createDb(env.DATABASE_URL);
  const client = createNovaPoshtaClient(env.NOVAPOSHTA_API_KEY);
  const result = await syncNovaPoshtaReferenceData(client, db);
  console.log(`Nova Poshta sync: ${result.settlements} settlements, ${result.warehouses} warehouses.`);
}
