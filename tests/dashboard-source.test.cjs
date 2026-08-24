'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

test('dashboard loads only the selected and comparison ranges without reload loops', () => {
  const source = fs.readFileSync('Sales Dashboard v2.dc.html', 'utf8');
  assert.equal((source.match(/\bcomponentDidUpdate\s*\(/g) || []).length, 1);
  assert.match(source, /componentDidUpdate\(prevState\)/);
  assert.doesNotMatch(source, /componentDidUpdate\([^)]*,/);
  assert.match(source, /\['overview','products','customers'\]/);
  assert.doesNotMatch(source, /\? 'all' : this\.state\.view/);
  assert.match(source, /alignToLatest/);
  assert.match(source, /rangeKey:coverageEndMs === this\.NOW - this\.D \? 'yesterday' : 'custom'/);
  assert.match(source, /liveBounds\(st = this\.state\)/);
  assert.match(source, /const rangeChanged = prevState\.start !== st\.start/);
  assert.match(source, /this\.state\.dataRequestKey === requestKey/);
  assert.match(source, /FlavourBlasterLive\.loadRange/);
  assert.doesNotMatch(source, /const start = '2019-01-01'/);
  assert.match(source, /Shopify-authoritative financials/);
  assert.match(source, /c\.k === 'd2c' \|\| c\.k === 'b2b'/);
  assert.doesNotMatch(source, /d2c:true, b2b:true, amzus:true, amzuk:true/);
  assert.doesNotMatch(source, /Sample fallback/);
});

test('GBP reporting snapshot preserves Shopify values and converts Amazon rows', () => {
  const source = fs.readFileSync('supabase/migrations/202608240002_gbp_reporting_snapshot.sql', 'utf8');
  assert.match(source, /'reportingCurrencyCode', 'GBP'/);
  assert.match(source, /in \('shopify_d2c', 'shopify_b2b'\) then 1::numeric else 0\.79::numeric/);
  assert.match(source, /when r->>'currency_code' = 'GBP'/);
  assert.match(source, /revoke all on function public\.fb_dashboard_snapshot_v3/);
  assert.match(source, /grant execute on function public\.fb_dashboard_snapshot_v3\(date, date\) to service_role/);
});

test('AOV snapshot uses initial order sales and keeps draft-order completion edits', () => {
  const source = fs.readFileSync('supabase/migrations/202608240003_shopify_aov.sql', 'utf8');
  assert.match(source, /create or replace function public\.fb_dashboard_snapshot_v4/);
  assert.match(source, /'draft_order' = any\(o\.tags\).*agreement_reason = 'ORDER_EDIT'/s);
  assert.match(source, /'aov_sales'/);
  assert.match(source, /'aov_orders'/);
  assert.match(source, /revoke all on function public\.fb_dashboard_snapshot_v4/);
  assert.match(source, /grant execute on function public\.fb_dashboard_snapshot_v4\(date, date\) to service_role/);
});

test('dashboard uses Shopify-compatible two-decimal presentation for AOV', () => {
  const source = fs.readFileSync('Sales Dashboard v2.dc.html', 'utf8');
  assert.match(source, /money2Aov\(v\).*Math\.trunc/s);
  assert.match(source, /Average order value', val:this\.money2Aov\(cAov\)/);
});

test('Shopify financials never fall back to order snapshot formulas', () => {
  const source = fs.readFileSync('supabase/migrations/202608240004_shopify_event_authority.sql', 'utf8');
  assert.match(source, /create or replace function public\.fb_dashboard_snapshot_v5/);
  assert.match(source, /'financial_source', 'sales_events'/);
  assert.match(source, /'shopifyReconciliation'/);
  assert.match(source, /'missingInitialOrders'/);
  assert.match(source, /revoke all on function public\.fb_dashboard_snapshot_v5/);
  assert.match(source, /grant execute on function public\.fb_dashboard_snapshot_v5\(date, date\) to service_role/);
  assert.doesNotMatch(source, /financial_source', 'order_snapshots'/);
});

test('Shopify order-edit updates adjust gross sales and discounts without changing AOV', () => {
  const source = fs.readFileSync('supabase/migrations/202608240005_shopify_update_sales.sql', 'utf8');
  assert.match(source, /create or replace function public\.fb_dashboard_snapshot_v6/);
  assert.match(source, /e\.action_type = 'UPDATE'/);
  assert.match(source, /gross_adjustment/);
  assert.match(source, /discount_adjustment/);
  assert.doesNotMatch(source, /'aov_sales'/);
});

test('Shopify AOV uses the original order state including immediate finalization agreements', () => {
  const source = fs.readFileSync('supabase/migrations/202608240006_shopify_aov_original_state.sql', 'utf8');
  assert.match(source, /create or replace function public\.fb_dashboard_snapshot_v7/);
  assert.match(source, /e\.agreement_reason = 'ORDER'/);
  assert.match(source, /e\.agreement_reason = 'ORDER_EDIT'/);
  assert.match(source, /interval '90 seconds'/);
  assert.match(source, /'aov_source', 'shopify_original_order_state'/);
  assert.match(source, /grant execute on function public\.fb_dashboard_snapshot_v7\(date, date\) to service_role/);
});
