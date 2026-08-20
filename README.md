# Flavour Blaster Sales Dashboard

Claude Design export with a server-only live-data bridge for the Flavour Blaster Shopify sales dashboard.

## Working source

`Sales Dashboard v2.dc.html` is the current editable dashboard source. It requests aggregated Shopify data from `/api/dashboard`; the browser never receives a Supabase secret. Until the disabled sync workflows are configured, approved, and run, the interface shows a clearly labelled deterministic fallback.

`dashboard-live.js` maps the API payload into the existing dashboard model. `support.js` is generated runtime code and must not be edited manually. Supporting design-system files are stored in `_ds/`.

## Data path

1. Disabled n8n development workflows contain bounded Shopify fetches, closed safety gates, and a 50-page safety design. Cursor looping and success-only cursor advancement must be completed and verified before either write workflow can be tested or activated.
2. n8n upserts normalized rows into the `fb_*` Supabase tables.
3. The server-only `fb_dashboard_snapshot` function returns aggregates to the Vercel API.
4. The dashboard loads those aggregates and visibly reports live, stale, empty, or unavailable state.

Google Sheets is an audit/output destination only; it is not a dashboard runtime dependency.

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
