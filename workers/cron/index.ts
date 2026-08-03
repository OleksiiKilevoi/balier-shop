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

async function releaseExpiredReservations(_env: Env): Promise<void> {
  // Phase 3: delete stock_reservations WHERE expires_at < now(), and move the
  // owning order to `cancelled` when it is still awaiting payment.
  // Uses createTxDb from ~/lib/db — the delete and the status change are atomic.
  console.log('releaseExpiredReservations: not implemented until Phase 3');
}

async function syncNovaPoshta(_env: Env): Promise<void> {
  // Phase 3: page through Address.getSettlements + Address.getWarehouses and
  // upsert into np_settlements / np_warehouses.
  console.log('syncNovaPoshta: not implemented until Phase 3');
}
