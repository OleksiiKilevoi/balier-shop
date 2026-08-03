/**
 * Fire-and-forget cart popup trigger. Decoupled from `CartPopup.astro` through a
 * DOM event so any page can call `openCartPopup` without importing the
 * component or caring whether it has mounted yet — same shape as the toast it
 * replaced.
 */

export const CART_POPUP_EVENT = 'cart:popup';

export function openCartPopup(): void {
  document.dispatchEvent(new CustomEvent(CART_POPUP_EVENT));
}
