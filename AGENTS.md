# Pashu Saathi — agent instructions

## Ownership and scope

This repository owns the responsive storefront, shared customer/admin application,
Capacitor customer/admin Android targets, Neon backend, tests, and release automation. Work on
`feat/initial-commerce` until a reviewed pull request is ready; do not merge or
change the umbrella workspace checkout. The default branch initially contains
only an empty bootstrap commit so all implementation can be reviewed in a PR.

Read `okf/contract.md` before editing. It is the integration contract; coordinate
changes rather than inventing incompatible client/server field names. One writer
per file. Do not edit other projects or the umbrella index/HEAD.

## Requirements that must not regress

- Fixed bags, jars, bottles, pieces and packs; integer quantities. No loose-goods workflow.
- Public catalog responses and pages must omit prices. Estimates require server-confirmed customer approval; quotes and bills retain private prices.
- Public, indexable English catalog; Google login for online orders/history.
- Quote-first online ordering, 48-hour quote validity, reservations on acceptance.
- Exact stock by product/package, purchase costs private, recorded counter sales.
- Cash/manual UPI, deposits/balances, per-sale credit approval, advances/dues ledger.
- Shop-arranged tempo/e-rickshaw, own-driver collection, or pickup. No courier API.
- No GST calculation or claim of legal tax exemption. Sales bills and receipts.
- Several admins; only server-authorized admins can grant/revoke staff access.
- Optional Firebase SMS verification is billable on Blaze. Never enable billing,
  send real SMS, deploy, alter DNS, or submit a Play release without authorization.
- No secrets/customer data in Git, public artifacts, logs, or client bundles.
- All money is integer INR paise; all posted financial changes are auditable.
- A view switch never grants permissions. Server authorization is mandatory.
- Offline browsing/cart only: no fake successful orders, payments, or ledger writes.

## Structure and documentation

Supporting documentation lives in `okf/`. No inherited formal OKF schema was
available when this project was initialized; these plain Markdown documents are
project documentation, not a claim of conformance to an unspecified standard.

The site must contain the workspace's canonical hire-me footer with unchanged
links. Use design tokens, accessible controls, responsive layouts, and no
invented reviews, shop addresses, or real-looking sample transactions.

## Setup and verification

Use the pinned Node/npm dependencies in `package-lock.json`. The coordinator owns
`package.json` and the lockfile. Do not run parallel dependency installs.

Target verification commands (record actual results in `okf/verification.md`):

```sh
npm ci
npm run check
npm test
npm run test:db
npm run build
npm run test:e2e
npm run android:sync
```

The database suite applies Neon migrations to isolated PGlite fixtures. These
checks do not establish real concurrent PostgreSQL behavior. Fixtures and
unsigned builds do not prove production credentials, delivery, or Play approval.

Review the initial revision and the final revision independently. Never bypass
hooks, checks, required reviews, or branch protection. Commit only task-owned
files. A pushed PR is not a merged or deployed product.
