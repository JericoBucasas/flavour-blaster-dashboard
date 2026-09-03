'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync('workflows/google-ads/flavour-blaster-reporting.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/202609030001_google_ads_reporting.sql', 'utf8');

function scriptRuntime() {
  const context = { Object, Date, Math, Number, String, Boolean, JSON, RegExp, Array, Error };
  vm.runInNewContext(script, context);
  return context;
}

test('Google Ads script is pinned to the verified account and uses only placeholder credentials', () => {
  assert.match(script, /CUSTOMER_ID: '9329387049'/);
  assert.match(script, /CURRENCY_CODE: 'GBP'/);
  assert.match(script, /TIME_ZONE: 'Europe\/London'/);
  assert.match(script, /HISTORICAL_FLOOR: '2025-01-01'/);
  assert.match(script, /ROLLING_DAYS: 4/);
  assert.match(script, /CORRECTION_DAYS: 35/);
  assert.match(script, /SAMPLE_DATE: ''/);
  assert.match(script, /REPLACE_WITH_N8N_WEBHOOK_URL/);
  assert.match(script, /REPLACE_WITH_RANDOM_32_BYTE_OR_LONGER_SECRET/);
  assert.doesNotMatch(script, /https:\/\/[a-z0-9-]+\.supabase\.co/i);
});

test('Google Ads script is reporting-only and preview mode suppresses webhook writes', () => {
  assert.match(script, /AdsApp\.currentAccount\(\)/);
  assert.match(script, /AdsApp\.search\(query\)/);
  assert.match(script, /FROM campaign/);
  assert.match(script, /FROM user_location_view/);
  assert.match(script, /FROM geo_target_constant/);
  assert.match(script, /metrics\.conversions, metrics\.conversions_value/);
  assert.match(script, /AdsApp\.getExecutionInfo\(\)\.isPreview\(\)/);
  assert.match(script, /!preview && !sampleMode && nextBackfillWindow/);
  assert.match(script, /if \(preview\)[\s\S]*logPreview\(payload\)[\s\S]*continue/);
  assert.deepEqual([...script.matchAll(/AdsApp\.(\w+)/g)].map((match) => match[1]).sort(), ['currentAccount','getExecutionInfo','search','search','search']);
  assert.doesNotMatch(script, /\.pause\s*\(|\.enable\s*\(|\.remove\s*\(|\.new\w*Builder\s*\(|AdsApp\.mutate\s*\(/);
});

test('Google Ads script normalizes micros and applies the shared five-region taxonomy', () => {
  const live = scriptRuntime();
  const metrics = live.metricFields({ costMicros:'1234567', impressions:'100', clicks:'5', conversions:'1.25', conversionsValue:'20.5' });
  assert.equal(metrics.costMicros, '1234567');
  assert.equal(metrics.conversions, 1.25);
  assert.equal(metrics.conversionValue, 20.5);
  assert.equal(live.regionCode('US'), 'us');
  assert.equal(live.regionCode('GB'), 'gb');
  assert.equal(live.regionCode('AU'), 'aus');
  assert.equal(live.regionCode('DE'), 'eur');
  assert.equal(live.regionCode('CA'), 'other');
});

test('Google Ads migration is bounded, transactional, browser-denied, and service-role-only', () => {
  assert.match(migration, /create table if not exists public\.fb_google_ads_campaign_daily/);
  assert.match(migration, /create table if not exists public\.fb_google_ads_campaign_country_daily/);
  assert.match(migration, /create table if not exists public\.fb_google_ads_backfill_windows/);
  assert.match(migration, /create or replace function public\.fb_google_ads_replace_window\(p_payload jsonb\)/);
  assert.match(migration, /Google Ads window exceeds 35 days/);
  assert.match(migration, /p_payload->>'customerId' is distinct from v_customer_id/);
  assert.match(migration, /delete from public\.fb_google_ads_campaign_country_daily[\s\S]*delete from public\.fb_google_ads_campaign_daily/);
  assert.match(migration, /on conflict \(customer_id, window_start\) do update/);
  assert.match(migration, /b\.window_end >= least\(/);
  assert.match(migration, /source_key, cursor_updated_at, last_success_at, last_run_id/);
  assert.match(migration, /'coverage_start', least\(/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on table public\.fb_google_ads_campaign_daily from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.fb_google_ads_dashboard_snapshot\(date, date\) to service_role/);
  assert.doesNotMatch(migration, /security definer/i);
});

test('Google Ads snapshot keeps geography strict and leaves campaign totals authoritative', () => {
  assert.match(migration, /coalesce\(t\.cost_micros, 0\) <> coalesce\(c\.cost_micros, 0\)/);
  assert.match(migration, /abs\(coalesce\(t\.conversions, 0\) - coalesce\(c\.conversions, 0\)\) > 0\.01/);
  assert.match(migration, /'geoComplete', v_geo_complete/);
  assert.match(migration, /'dailyTotals'/);
  assert.match(migration, /'dailyRegions'/);
  assert.match(migration, /'campaigns'/);
  assert.match(migration, /'campaignRegions'/);
  assert.match(migration, /now\(\) - interval '2 hours'/);
  assert.match(migration, /when v_checkpoint\.source_key is null then 'unavailable'/);
});
