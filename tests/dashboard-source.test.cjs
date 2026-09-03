'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

test('dashboard loads only the selected and comparison ranges without reload loops', () => {
  const source = fs.readFileSync('Sales Dashboard v2.dc.html', 'utf8');
  assert.equal((source.match(/\bcomponentDidUpdate\s*\(/g) || []).length, 1);
  assert.match(source, /componentDidUpdate\(\)/);
  assert.doesNotMatch(source, /prevState\.(start|end|view|continuous|dataStatus)/);
  assert.match(source, /const boundsPrefix = bounds\.start \+ '\\|' \+ bounds\.end \+ '\\|'/);
  assert.match(source, /const rangeChanged = !String\(st\.dataRequestKey \|\| ''\)\.startsWith\(boundsPrefix\)/);
  assert.match(source, /const needsTraffic = \(st\.view === 'overview' \|\| st\.view === 'traffic'\) && !st\.livePayload\?\.traffic/);
  assert.match(source, /st\.dataStatus !== 'loading' && \(needsTraffic \|\| needsAds \|\| needsProducts \|\| needsCustomers \|\| needsAll\)/);
  assert.match(source, /this\.state\.continuous \? \['all'\] : \[this\.state\.view\]/);
  assert.doesNotMatch(source, /\['overview','products','customers'\]/);
  assert.match(source, /alignToLatest/);
  assert.match(source, /rangeKey:coverageEndMs === this\.NOW - this\.D \? 'yesterday' : 'custom'/);
  assert.match(source, /liveBounds\(st = this\.state\)/);
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

test('Finance navigation and dashboard surface follow the approved hierarchy', () => {
  const source = fs.readFileSync('Sales Dashboard v2.dc.html', 'utf8');
  assert.match(source, /\['overview','Overview','ph-gauge'\],\['finance','Finance','ph-coins'\]/);
  assert.match(source, /const VK = \['overview','finance','traffic'/);
  assert.match(source, /const V = \['overview','finance','traffic'/);
  assert.match(source, /<option value="overview">Overview<\/option><option value="finance">Finance<\/option>/);
  assert.match(source, /<section id="sec-finance"/);
  assert.match(source, /class="sd-card finance-summary-link"[^>]+onClick="\{\{ goFinance \}\}"/);
  assert.match(source, /financeEquation/);
  assert.match(source, /Cumulative Gross profit/);
  assert.match(source, /const financeHeadlineMetrics = \[/);
  assert.match(source, /label:'Contribution margin'.*note:'Additional costs not connected'/);
  assert.match(source, /label:'Gross margin'.*grossMarginReady/);
  assert.match(source, /label:'Orders'.*this\.num\(cur\.o\)/);
  assert.match(source, /label:'Google Ads ROAS'.*Google-attributed revenue · Meta not connected/);
  assert.match(source, /label:'Blended ROAS', value:'—', note:'Meta Ads not connected'/);
  assert.match(source, /\.finance-metric-grid \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\) !important; \}/);
  assert.doesNotMatch(source, /const financeKeyMetrics = \[/);
  assert.match(source, /zeroY:Y\(0\)\.toFixed\(1\)/);
  assert.match(source, /const areaP = areaPoints\.length/);
  assert.match(source, /'Relative day', true/);
  assert.match(source, /Shopify return fees are excluded/);
  assert.match(source, /bottomNav:navItems\.filter\(n => \['Overview','Orders','Products'\]\.includes\(n\.label\)\)/);
  assert.match(source, /menuNav:navItems\.filter\(n => !\['Overview','Orders','Products'\]\.includes\(n\.label\)\)/);
});

test('Finance COGS coverage is exact and incomplete metrics remain blocked', () => {
  const source = fs.readFileSync('Sales Dashboard v2.dc.html', 'utf8');
  const live = fs.readFileSync('dashboard-live.js', 'utf8');
  assert.doesNotMatch(source, /cogs:src\.cogs \* f/);
  assert.match(source, /costedU','uncostedU','covRows','covKnown/);
  assert.match(source, /Incomplete cost coverage/);
  assert.match(source, /selectedReady:false, comparisonReady:false, lowerIsBetter:true, note:'Payment processor not connected/);
  assert.match(live, /costed_units/);
  assert.match(live, /uncosted_units/);
  assert.match(live, /contributionComplete:false/);
});

test('Finance snapshot adds strict net-unit cost coverage without applying it', () => {
  const source = fs.readFileSync('supabase/migrations/202609020001_finance_cost_coverage.sql', 'utf8');
  assert.match(source, /create or replace function public\.fb_dashboard_snapshot_v8/);
  assert.match(source, /greatest\(l\.quantity - l\.refunded_quantity, 0\)/);
  assert.match(source, /l\.cogs is not null or l\.unit_cost is not null or canonical\.unit_cost is not null/);
  assert.match(source, /costed_units/);
  assert.match(source, /uncosted_units/);
  assert.match(source, /grant execute on function public\.fb_dashboard_snapshot_v8\(date, date\) to service_role/);
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

test('GA4 storage is aggregate-only, browser-restricted, and exposed through its own reporting RPC', () => {
  const source = fs.readFileSync('supabase/migrations/202609010001_ga4_traffic_reporting.sql', 'utf8');
  assert.match(source, /create table if not exists public\.fb_ga4_daily/);
  assert.match(source, /create table if not exists public\.fb_ga4_dimensions/);
  assert.doesNotMatch(source, /client_id|visitor_id|email_address|raw_event/);
  assert.match(source, /alter table public\.fb_ga4_daily enable row level security/);
  assert.match(source, /revoke all on table public\.fb_ga4_daily from public, anon, authenticated/);
  assert.match(source, /grant select, insert, update, delete on table public\.fb_ga4_daily to service_role/);
  assert.match(source, /security invoker/);
  assert.match(source, /create or replace function public\.fb_ga4_dashboard_snapshot/);
  assert.match(source, /interval '12 hours'/);
  assert.match(source, /grant execute on function public\.fb_ga4_dashboard_snapshot\(date, date\) to service_role/);
});

test('Google Ads live UI is partial, region-aware, and never substitutes synthetic account data', () => {
  const source = fs.readFileSync('Sales Dashboard v2.dc.html', 'utf8');
  assert.match(source, /FlavourBlasterLive\.adsRange/);
  assert.match(source, /Google Ads connected · Meta Ads not connected/);
  assert.match(source, /Google-attributed revenue/);
  assert.match(source, /channel filters do not allocate Google Ads spend/);
  assert.match(source, /Google Ads spend · partial/);
  assert.match(source, /No partial or estimated advertising figures are shown/);
  assert.match(source, /Google Ads connected · data needs refresh/);
  assert.match(source, /name:'Previous period'.*adsPrevious\.ds/s);
  assert.doesNotMatch(source, /const adSpendTot = cur\.s \* 0\.108/);
  assert.doesNotMatch(source, /Sample figures modelled from the period's sales/);
});

test('dashboard renders GA4 Overview KPIs and a filter-aware Traffic page without treating GA4 as commerce authority', () => {
  const source = fs.readFileSync('Sales Dashboard v2.dc.html', 'utf8');
  assert.match(source, /\['overview','finance','traffic','channels'/);
  assert.match(source, /const sections = this\.state\.continuous \? \['all'\] : \[this\.state\.view\]/);
  assert.doesNotMatch(source, /this\.state\.continuous \? \['overview','products','customers'\]/);
  assert.match(source, /Website sessions · GA4/);
  assert.match(source, /GA4 purchase conversion/);
  assert.match(source, /Shopify web order conversion/);
  assert.match(source, /Website analytics are not applicable to Amazon-only channels\./);
  assert.match(source, /canShowShopifyWebConv = trafficAvailable && !!st\.chOn\.d2c && !!st\.chOn\.b2b/);
  assert.match(source, /GA4 is diagnostic\. Shopify remains authoritative for commerce\./);
  assert.match(source, /<section id="sec-traffic"/);
  assert.match(source, /<option value="traffic">Traffic<\/option>/);
  assert.match(source, /const migratedOrder = .*k === 'conv' \? 'ga4conv'/);
  assert.doesNotMatch(source, /GA4 sample|sample GA4|fallback GA4/i);
});
