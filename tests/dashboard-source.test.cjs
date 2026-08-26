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
  assert.match(source, /FlavourBlasterLive\.mergePayloads/);
  assert.doesNotMatch(source, /const start = '2019-01-01'/);
  assert.match(source, /Shopify-authoritative financials/);
  assert.match(source, /c\.k === 'd2c' \|\| c\.k === 'b2b'/);
  assert.match(source, /repCur:'GBP'/);
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

test('total sales is the first KPI and drives the default overview chart', () => {
  const source = fs.readFileSync('Sales Dashboard v2.dc.html', 'utf8');
  assert.match(source, /const kpisAll = \[\s*\{ k:'total', label:'Total sales', val:this\.money\(cur\.ts\)/);
  assert.match(source, /selKpi:'total'/);
  assert.match(source, /total:\['Total sales over time', d => d\.ts/);
  assert.match(source, /gross:\['Gross sales over time', d => d\.s/);
});

test('total sales breakdown is collapsed by default and remains accessible', () => {
  const source = fs.readFileSync('Sales Dashboard v2.dc.html', 'utf8');
  assert.match(source, /salesBreakdownOpen:false/);
  assert.match(source, /aria-expanded="\{\{ salesBreakdownExpanded \}\}"/);
  assert.match(source, /<sc-if value="\{\{ salesBreakdownOpen \}\}" hint-placeholder-val="\{\{ false \}\}">/);
  assert.match(source, /salesBreakdownTotal:this\.money2\(cur\.ts \|\| 0\)/);
  assert.match(source, /salesBreakdownToggle:\(\)=>this\.setState\(\{salesBreakdownOpen:!st\.salesBreakdownOpen\}\)/);
});

test('selected date range stays readable on one line in the desktop control bar', () => {
  const source = fs.readFileSync('Sales Dashboard v2.dc.html', 'utf8');
  assert.match(source, /\.sd-date-btn \{ flex:none;white-space:nowrap;font-variant-numeric:tabular-nums; \}/);
  assert.match(source, /class="btn btn-secondary sd-date-btn"/);
  assert.match(source, /class="sd-date-btn-label">\{\{ dateBtnLabel \}\}<\/span>/);
});

test('mobile dashboard is title-first, truthful, progressive, and touch accessible', () => {
  const source = fs.readFileSync('Sales Dashboard v2.dc.html', 'utf8');
  assert.match(source, /#lg-kpistrip \{ display:grid !important;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(source, /Shopify-app order: the sales chart sits above the Overview title bar/);
  assert.match(source, /Sample data is intentionally hidden so it cannot be mistaken for Shopify data\./);
  assert.match(source, /<button type="button" onClick="\{\{ n\.goMenu \}\}" aria-label="Open \{\{ n\.label \}\}"/);
  assert.match(source, /id="lg-mobile-filter" type="button"/);
  assert.match(source, /class="prod-mobile-list"/);
  assert.match(source, /mobileProdRows:prodRows\.slice\(0, st\.mobileProductLimit \|\| 20\)/);
  assert.match(source, /mobileDirRows:dirRows\.slice\(0, st\.mobileDirectoryLimit \|\| 20\)/);
  assert.match(source, /class="morning-brief-toggle m-only"/);
});

test('dashboard keeps the public address at the canonical root URL', () => {
  const source = fs.readFileSync('Sales Dashboard v2.dc.html', 'utf8');
  const routing = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  assert.equal(fs.existsSync('index.html'), false);
  assert.deepEqual(routing.rewrites, [{
    source: '/',
    destination: '/Sales%20Dashboard%20v2.dc',
  }]);
  assert.match(source, /history\.replaceState\(null, '', '\/'\)/);
  assert.doesNotMatch(source, /const h = '#' \+ parts\.join/);
});

test('orders view applies active channel and region filters to rows and hourly data', () => {
  const source = fs.readFileSync('Sales Dashboard v2.dc.html', 'utf8');
  assert.match(source, /st\.livePayload\.recentOrders\.filter\(order =>/);
  assert.match(source, /!!st\.chOn\[channelKey\] && !!st\.rgOn\[regionKey\]/);
  assert.match(source, /d\.hcr\[c\.k\]\?\.\[gi\]/);
  assert.match(source, /out\.hw = hourTotal > 0 \? filteredHours\.map/);
  assert.match(source, /No orders match the selected channels, regions, or table filter\./);
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

test('Shopify B2B classification uses purchasing company, company membership, and qualifying tags', () => {
  const source = fs.readFileSync('supabase/migrations/202608240007_shopify_b2b_classification.sql', 'utf8');
  assert.match(source, /purchasingcompany/);
  assert.match(source, /wholesale\|distributor\|b2b/);
  assert.match(source, /from public\.fb_company_contacts contact/);
  assert.match(source, /join public\.fb_companies company/);
  assert.match(source, /new\.source_store = 'jetchill-mixology'/);
  assert.match(source, /new\.channel := case/);
  assert.match(source, /b2b_classification_reasons/);
  assert.match(source, /revoke all on function public\.fb_shopify_b2b_reasons/);
  assert.match(source, /grant execute on function public\.fb_shopify_b2b_reasons/);
});

test('Shopify B2B classification refreshes historical orders after directory changes', () => {
  const source = fs.readFileSync('supabase/migrations/202608240008_shopify_b2b_dependency_refresh.sql', 'utf8');
  assert.match(source, /create trigger fb_customers_reclassify_shopify_orders/);
  assert.match(source, /create trigger fb_company_contacts_reclassify_shopify_orders/);
  assert.match(source, /create trigger fb_companies_reclassify_shopify_orders/);
  assert.match(source, /set channel = orders\.channel/);
  assert.match(source, /orders\.source_store = 'jetchill-mixology'/);
  assert.match(source, /revoke all on function public\.fb_reclassify_shopify_customer_orders/);
  assert.match(source, /grant execute on function public\.fb_reclassify_shopify_company_orders/);
});

test('customer reclassification trigger guards table-specific record fields', () => {
  const source = fs.readFileSync('supabase/migrations/20260825092439_fix_customer_reclassification_trigger.sql', 'utf8');
  assert.match(source, /if tg_table_name = 'fb_customers' then/);
  assert.match(source, /elsif tg_table_name = 'fb_company_contacts' then/);
  assert.match(source, /old\.tags is not distinct from new\.tags/);
  assert.match(source, /old\.shopify_company_id is not distinct from new\.shopify_company_id/);
  assert.match(source, /raise exception 'Unsupported trigger table/);
  assert.match(source, /revoke all on function public\.fb_reclassify_shopify_customer_orders/);
  assert.match(source, /grant execute on function public\.fb_reclassify_shopify_customer_orders/);
});
