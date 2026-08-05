import type { NotifierPort } from '~/lib/ports';

/**
 * A notifier that sends nothing.
 *
 * `createOrder` always notifies — that is the right default for an order that
 * arrives on its own, at any hour, with nobody watching. An order typed into
 * the admin panel is the opposite case: the manager is the notification, they
 * are already in the conversation the order came from, and a Telegram message
 * telling them what they just did is noise in the channel that exists to catch
 * the orders nobody saw.
 *
 * So the manager-facing channel gets this and the customer-facing email gets a
 * real adapter. Passing this rather than making the dependency optional keeps
 * `createOrder` with one code path: there is no "notify?" branch to get wrong,
 * and adding a third caller means choosing a notifier, not remembering a flag.
 */
export function createNoopNotifier(): NotifierPort {
  return {
    async orderCreated() {},
    async orderPaid() {},
    async paymentAfterCancellation() {},
  };
}
