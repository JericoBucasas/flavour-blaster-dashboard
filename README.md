# Flavour Blaster Sales Dashboard

Claude Design export with a server-only live-data bridge for the Flavour Blaster Shopify sales dashboard.

## Working source

`Sales Dashboard v2.dc.html` is the current editable dashboard source. It requests aggregated Shopify data from `/api/dashboard`; the browser never receives a Supabase secret. Until the disabled sync workflows are configured, approved, and run, the interface shows a clearly labelled deterministic fallback.

`dashboard-live.js` maps the API payload into the existing dashboard model. `support.js` is generated runtime code and must not be edited manually. Supporting design-system files are stored in `_ds/`.

## Data path

1. n8n synchronizes Shopify orders and the complete product catalog into Supabase. The customer/company directory workflow is stored disabled with a closed development gate; it follows the product workflow's six-hour Europe/London schedule, bounded pagination, retries, success-only cursor advancement, and soft-deletion finalization.
2. n8n upserts normalized rows into the `fb_*` Supabase tables.
3. Server-only database functions return sales aggregates, the product catalog, and a privacy-safe customer/company directory to the Vercel API.
4. The dashboard loads those payloads and visibly reports live, stale, empty, or unavailable state. Protected customer fields remain server-side; email addresses, phone numbers, notes, full postal addresses, and raw Shopify records are not returned to the unauthenticated browser.

Google Sheets is an audit/output destination only; it is not a dashboard runtime dependency.

## Customer and B2B directory

The Customers view contains separate Customers, Companies, and Locations tabs with selectable columns, sortable desktop tables, expandable details, and condensed mobile cards. The default columns are deliberately concise while Supabase retains the complete approved dataset.

The disabled n8n workflow requires a Shopify Admin API connection with customer and B2B company access, plus the existing Supabase service connection. It must remain disabled until a bounded first-run plan and activation are separately approved.

## Required server environment

Copy `.env.example` to a local environment file and set a Supabase secret key only in the server environment. Never add that key to browser code or commit it.

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

The legacy `SUPABASE_SERVICE_ROLE_KEY` name is accepted temporarily for migration compatibility.

## Local preview

```sh
python3 -m http.server 3001
```

Then open:

`http://127.0.0.1:3001/Sales%20Dashboard%20v2.dc.html`

Static local preview cannot serve `/api/dashboard`; it will therefore show the labelled fallback state. Use a local Vercel runtime with the required environment variables for end-to-end live API testing.

## Tests

```sh
node --test tests/*.test.cjs
```

## Database migrations

The ordered, already-applied development schema is in `supabase/migrations/`. Do not rewrite applied migrations; add a new migration for subsequent schema changes.

## Deployment

The root entry point opens the v2 dashboard source. Vercel also detects `api/dashboard.js` as a server function. Production deployment and production environment changes require separate approval.
