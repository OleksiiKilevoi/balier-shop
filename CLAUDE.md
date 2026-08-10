# balier.ua — CLAUDE.md

> Read automatically each session. Keep SHORT. Details live in docs/. This file only routes + reports.

## ⏯️ SESSION START PROTOCOL (every session, before any work)

1. Read `docs/STATE.md`.
2. Read aloud to me in ≤8 lines: **Last done / In progress / Next step / Blockers (waiting on me)**.
3. Ask: "Continue with the next step, or something else?" — do not start until I answer.

## ▶️ How to run

pnpm workspace: `apps/site` (storefront Worker), `apps/admin` (admin-panel Worker),
`packages/lib` (shared domain code + all tests), `workers/cron`.

```bash
pnpm dev                  # storefront dev server, port 4321 (alias of dev:site)
pnpm dev:admin            # admin-panel dev server, port 4322
pnpm check && pnpm build  # the gate, recursive over all packages — run before considering any task done
pnpm deploy:site          # build + wrangler deploy the storefront
pnpm deploy:admin         # build + wrangler deploy the admin panel
```

There is deliberately no root `deploy` script — `pnpm deploy` is a pnpm workspace builtin and
would shadow it. Package manager is pnpm, pinned in `packageManager`. Full command list:
`docs/CONVENTIONS.md`.

## 🧭 Docs map (load only when relevant — don't auto-read these)

- `docs/STATE.md` — current state + session log (updated every session)
- `docs/history.md` — the session log for finished phases, split out of STATE.md. Never read at
  session start; read it when you need why something already built was built that way
- `docs/OVERVIEW.md` — what it is, stack, architecture, module map, integrations, sharp edges
- `docs/CONVENTIONS.md` — rules to always follow (domain, design, code, safety)
- `docs/plans/roadmap.md` — the phased build plan and the open decisions

## 🔒 Hard rules (full list in docs/CONVENTIONS.md)

1. Money is **integer kopiykas**, and the server recalculates every total from DB prices — client
   amounts are intent, never truth.
2. An order becomes `paid` **only** in the Monobank webhook handler, never on the success page.
3. Cart items and order items reference **`variantId`**, never `productId`. Availability is the
   variant's **`in_stock` flag** — no counts, no reservations; only a manager ever writes it.
4. Workers runtime: no Node APIs, no `process.env`, no module-scope state — env comes from
   `import { env } from 'cloudflare:workers'`.
5. Do not expand a phase's scope from `docs/plans/roadmap.md` without discussion, and do not build
   on a guessed answer to an open decision — ask.

## 🗒️ Doc update policy

- Update `docs/STATE.md` at the END of every session (always) or on "update docs".
- Don't spawn new per-session .md files — append to STATE.md's session log.
- **Keep the CURRENT STATE block to one "Last done"**, not a chain of them. It grew to 548 lines of
  entries that were already written out in the session log below it; the log is the history, that
  block is the handover. When a phase closes, move its log entries to `docs/history.md`.
- Other docs change only when I explicitly ask.
