/**
 * The panel's enhancement layer, in one place.
 *
 * A panel screen is a set of plain `<form method="post">` blocks that each
 * change something and are answered with a 303 back to the same URL. That works
 * with no script at all, and it is what every screen still does when this file
 * never runs. What it costs is a full page load per save: the browser throws the
 * rendered page away, scrolls to the top, and the manager who pressed «Зберегти»
 * three screens down is now looking at the header.
 *
 * This removes exactly that, and nothing else. Every submit inside `root`
 * becomes a `fetch` of the very POST the browser would have made; `fetch`
 * follows the 303 itself, so what comes back is the same page rendered by the
 * same frontmatter, and it replaces `root`'s contents in place. The server
 * contract is byte-identical — same bodies, same renders — and any failure falls
 * back to a real submit, so the scriptless behaviour is always one line away.
 *
 * The answer moves with it. A reload put the banner at the top of the page and
 * scrolled there; a swap leaves the manager where they clicked, so the same
 * server-rendered `<p>` is moved into the fixed toast host (`admin-toast-host`
 * in `admin.css`) and a confirmation is allowed to expire. There is no toast
 * component and no second copy of the message: with script off it stays a banner
 * above the form, which is where the scriptless page has to put it.
 *
 * Kept deliberately dumb: no client-side state beyond three flags, no client
 * rendering, no diffing. The server remains the only thing that decides what a
 * screen looks like; this is transport.
 *
 * NOT for `/admin/orders/new`. That page is one draft form that re-renders as it
 * is typed into — it debounces, it abandons in-flight renders for newer ones,
 * and its single create submit is the guarded one. Here every POST writes a row,
 * so submits are serialised instead, and nothing happens without a button.
 */

/** How long a confirmation stays. A refusal has no timer — see `showAnswer`. */
const TOAST_MS = 4000;

export interface AdminFormsOptions {
  /**
   * The container that is swapped in place. It must carry an `id`: that is how
   * the same element is found again in the response.
   */
  root: HTMLElement;
  /** The fixed `.admin-toast-host`, outside `root` so a swap cannot clear it. */
  toastHost: HTMLElement;
  /** `id` of the banner the server renders inside `root`, when it renders one. */
  messageId: string;
  /**
   * Runs after every swap, for the page-specific state a response cannot know —
   * anything a listener would have held on a node that has just been replaced.
   */
  onRender?: () => void;
}

export function enhanceAdminForms({
  root,
  toastHost,
  messageId,
  onRender,
}: AdminFormsOptions): void {
  /** Where a render is still *this page*; anything else is a navigation. */
  const SELF = window.location.pathname;
  const rootId = root.id;

  /** Set once the fetch path has failed: submits go back to the browser. */
  let bypass = false;
  /** Every POST here writes a row, so exactly one may be in flight. */
  let busy = false;
  /** Following a redirect (session expired, or the row is gone): stop. */
  let navigating = false;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  root.addEventListener('submit', (event) => {
    if (bypass) return;
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    event.preventDefault();
    const submitter =
      event instanceof SubmitEvent && event.submitter instanceof HTMLButtonElement
        ? event.submitter
        : null;
    void post(form, submitter);
  });

  // Whatever the server already rendered for this load — a row just created, or
  // a save that went through the scriptless path.
  showAnswer();

  async function post(form: HTMLFormElement, submitter: HTMLButtonElement | null) {
    if (busy || navigating) return;

    busy = true;
    // Dims the screen and stops it taking a second click while it works.
    root.setAttribute('aria-busy', 'true');

    const body = new FormData(form);
    if (submitter?.name) body.append(submitter.name, submitter.value);

    /*
     * Only the round trip is guarded, and the swap deliberately happens after
     * it: falling back means submitting `form` for real, and by the time
     * anything has been rendered `form` is a detached node that
     * `requestSubmit` would quietly ignore. So the answer is held here and
     * handed on once there is nothing left that could fail into the wrong
     * recovery.
     */
    let html: string | null = null;

    try {
      const response = await fetch(form.action, { method: 'POST', body });

      // The 303 every successful action answers with has already been followed
      // by `fetch`, so this is the GET that came back from it. Landing anywhere
      // but here is a decision — the login form, most likely — and has to be
      // shown as one.
      if (new URL(response.url).pathname !== SELF) {
        navigating = true;
        window.location.assign(response.url);
        return;
      }

      if (!response.ok) throw new Error(`POST ${response.status}`);

      html = await response.text();
    } catch {
      // The scriptless path still works; take it rather than strand the click
      // behind a broken fetch.
      bypass = true;
      form.requestSubmit(submitter ?? undefined);
    } finally {
      busy = false;
      if (!navigating) root.removeAttribute('aria-busy');
    }

    if (html !== null) render(html, form.dataset.form ?? null);
  }

  function render(html: string, formKey: string | null) {
    const next = new DOMParser().parseFromString(html, 'text/html').getElementById(rootId);
    if (!next) {
      // Not this page — whatever it is, show it honestly.
      window.location.reload();
      return;
    }

    /*
     * Two things the response cannot know, because they are how the manager has
     * the screen arranged rather than anything the server was told: which
     * disclosures are open, and where the keyboard is. Both are read off the
     * live DOM before it is replaced and put back after.
     */
    const opened = [...root.querySelectorAll('details[open]')]
      .map((node) => node.id)
      .filter((id) => id !== '');
    const focused =
      document.activeElement instanceof HTMLElement ? document.activeElement.id : '';

    root.innerHTML = next.innerHTML;

    /*
     * The banner leaves the flow before anything below forces a layout.
     * `focus()` flushes one, and with the banner still a block above the
     * viewport at that moment, the browser picks its scroll anchor against a
     * page one banner taller than the one finally painted — then "corrects" the
     * scroll by that height, a small upward jump on every save. Moved out
     * first, no intermediate layout differs from the painted one and there is
     * nothing to correct.
     */
    showAnswer();

    for (const id of opened) {
      const node = document.getElementById(id);
      if (node instanceof HTMLDetailsElement) node.open = true;
    }

    /*
     * Enter in a field submits the form around it, so the keyboard may have
     * been in a named control; a mouse leaves it on the button, which has no
     * id, and `data-form` finds that form's button again. A form that the
     * action removed — the photo it belonged to is gone — has neither, and
     * focus is left where the browser put it.
     */
    const field = focused ? document.getElementById(focused) : null;
    if (field) {
      field.focus({ preventScroll: true });
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        try {
          field.setSelectionRange(field.value.length, field.value.length);
        } catch {
          /* not a text-entry field */
        }
      }
    } else if (formKey) {
      const button = root.querySelector(
        `[data-form="${CSS.escape(formKey)}"] button[type="submit"]`,
      );
      if (button instanceof HTMLElement) button.focus({ preventScroll: true });
    }

    /* A refusal marks the field it is about, and «Зберегти» can be a screen
       below it. `nearest` means an already-visible field is not scrolled. */
    root.querySelector('.border-danger')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    onRender?.();
  }

  /**
   * Moves the server's banner into the fixed host, so an answer is visible from
   * wherever the click was made.
   */
  function showAnswer() {
    clearTimeout(toastTimer);

    const message = root.querySelector(`#${CSS.escape(messageId)}`);
    if (!(message instanceof HTMLElement)) {
      toastHost.replaceChildren();
      return;
    }

    // The host is the live region now. Left in place, the banner's own `role`
    // would make a screen reader announce the same sentence twice.
    message.removeAttribute('role');
    toastHost.replaceChildren(message);

    // Which is also why it can be clicked away: the one below has no timer, and
    // it sits over the bottom of the page.
    message.addEventListener('click', () => message.remove(), { once: true });

    // A confirmation is redundant the moment it is read — what it confirms is
    // on screen. A refusal is the only record of why nothing changed, so it
    // stays until it is dismissed or the next action replaces it.
    if (message.dataset.tone === 'ok') {
      toastTimer = setTimeout(() => message.remove(), TOAST_MS);
    }
  }
}
