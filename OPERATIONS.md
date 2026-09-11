# Smartbasket operations upgrade

Extends the existing Cloudflare Pages advanced Worker and Supabase-backed application. Existing accounts, sessions, shipment photos and shipments remain in place. No new frontend framework or external client API credentials.

## Features

- Search by tracking number, customer code, name or phone; combine country, mode, trip and status filters.
- Trip manifests with customer count, separate kg/m³ totals, status distribution, CSV/print and version-checked bulk transfer/status updates.
- Local Excel/CSV parsing in a time-limited Web Worker; column mapping; per-batch customer-code mapping; placeholder exclusion; explicit review of duplicates and existing records. Commit is atomic and checks the reviewed row versions.
- Barcode camera/image/manual entry, duplicate-scan prevention and persistent reconciliation reports. Scanning does not change shipment status.
- Attention list, grouped in-app notifications, customer-controlled WhatsApp opt-in, immutable invoice/rate snapshots, payments and audit history.
- Backward-compatible staff role plus warehouse/accountant roles; API checks permissions independently of the UI.

## Deployment

The app retains its existing host, `wrangler.jsonc` and secrets. The additive database upgrade is in `db/operations.sql` and is recorded as `smartbasket_operations_upgrade`. Do not replay or edit an applied upgrade; append a new schema change for subsequent revisions. Frontend files and the Worker must be deployed together after the database upgrade. Libraries in `vendor/` must also be present.

The Worker only serves an explicit static-asset allowlist. SQL, tests and WhatsApp setup/dispatcher source are not accessible through the application domain.

## WhatsApp

See `whatsapp/SETUP.md`. This optional integration is **not enabled or scheduled** by this release. It requires Meta onboarding, template approval, server-side credentials and an approved test recipient. No historical notification backfill or automatic customer opt-in. Unknown send outcomes are held for review rather than blindly retried.

## Testing

`node --test tests/core.test.mjs tests/api.test.mjs`

`tests/database-rollback.sql` tests live schema behavior in an explicit transaction, with fixture records rolled back. It must never be run without its enclosing transaction. A separate read-only check verifies zero residual QA accounts/shipments. Security advisor informational notices for RLS without policies are expected: these tables are intentionally inaccessible to anon/authenticated clients and accessed only through the authenticated application server's service role. The project's pre-existing Supabase Auth leaked-password warning is separate from this application's existing custom account authentication.

## Vendored dependencies

- SheetJS CE **0.20.3**, Apache-2.0, [official distribution](https://docs.sheetjs.com/docs/getting-started/installation/standalone/). SHA-256 of `xlsx.full.min.js`: `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41`.
- ZXing Browser **0.1.5**, MIT, [official project](https://github.com/zxing-js/browser), distributed through jsDelivr's versioned npm mirror. SHA-256 of `zxing-browser.min.js`: `b5ad3df920738ca7adcb74508d7e6b6a5b9024993fb9a0c702da1ad8964eca07`.
- License notices are retained in `vendor/`.

## Limits and operational notes

Imports: 10 MB, 1,000 shipment rows per batch, at most 20 sheets. Numeric Excel tracking identifiers of 16+ digits are rejected because Excel may already have lost digits; the source tracking identifier must be text. Footer totals are excluded, and formulas are not executed. One unit per import batch; air uses kg and sea uses m³. Existing manual-entry quantity precision is preserved.

Invoices use an exact category/rate match. No monetary rates are seeded. Invoices and payments are append-only in this release; correcting issued financial records needs a separately authorized credit/reversal workflow. Notifications/audit begin when the database upgrade is enabled, not retroactively.
