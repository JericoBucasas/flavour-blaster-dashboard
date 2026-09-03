# Flavour Blaster Google Ads reporting

This integration exports aggregate, reporting-only data from Google Ads customer
`932-938-7049` to the protected dashboard data path:

`Google Ads Script -> authenticated n8n webhook -> service-role Supabase RPC -> dashboard API`

The repository contains no usable webhook URL, sync key, Google credential, or
Supabase credential. The Google Ads Script validates the customer ID, GBP
currency, and Europe/London timezone before querying or sending anything.

## Approval-gated activation

Keep each stage separate and stop if any verification fails:

1. Review and apply `supabase/migrations/202609030001_google_ads_reporting.sql`.
2. Import `workflows/n8n/fb-dashboard-google-ads-ingest.disabled.json`; leave it
   inactive and keep `DEVELOPMENT_GATE = false`.
3. Configure its existing Supabase service-role credential and create a Header
   Auth credential whose header is `X-FB-Ads-Sync-Key`. Generate at least 32
   random bytes and do not place the value in source control or logs.
4. After approval, open Google Ads as `contact@couchnconnections.com`, verify
   customer `932-938-7049`, create a script from
   `flavour-blaster-reporting.js`, and replace the two placeholders only in the
   private Google Ads editor.
5. Open the n8n development gate and use the workflow's test webhook URL. Run
   the Ads script in Preview first; the log must say that no webhook request was
   sent and the Google Ads change history must remain empty.
6. Temporarily set `SAMPLE_DATE` to one completed London date for the first real
   run. Sample mode sends only that day and suppresses backfill. Reconcile
   cost, primary conversions, conversion value, campaign rows, and actual-user
   geography against Google Ads. Run the same window again and confirm the
   stored result is unchanged.
7. Clear `SAMPLE_DATE`. Only after reconciliation, use the production webhook URL and activate the
   hourly Google Ads schedule. Each run refreshes four days; the 03:00 London
   run refreshes 35 days, and one missing calendar month is backfilled per run
   from `2025-01-01`.
8. Verify the dashboard in preview before separately approving production.

Google-attributed conversion value is labelled as attribution data and never as
Shopify-authoritative revenue. Meta Ads, fulfilment, payment fees, blended ROAS,
contribution, and contribution margin remain unavailable until their complete
sources are connected.
