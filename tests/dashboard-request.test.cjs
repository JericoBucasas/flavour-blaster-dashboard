'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDate, buildSnapshotRequest, buildCatalogRequest, buildDirectoryRequest, sanitizeSnapshot } = require('../lib/dashboard-request');

test('parseDate accepts ISO dates and falls back safely', () => {
  assert.equal(parseDate('2026-08-20', '2025-01-01'), '2026-08-20');
  assert.equal(parseDate('not-a-date', '2025-01-01'), '2025-01-01');
});

test('snapshot request keeps the secret in server headers only', () => {
  const request = buildSnapshotRequest('https://hnmmlfelaezmijbbwzsg.supabase.co/', '[test-secret]', '2025-01-01', '2026-08-20');
  assert.equal(request.url, 'https://hnmmlfelaezmijbbwzsg.supabase.co/rest/v1/rpc/fb_dashboard_snapshot_v3');
  assert.equal(request.options.headers.apikey, '[test-secret]');
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(request.options.headers['User-Agent'], 'FlavourBlasterDashboard-Vercel/1.0');
  assert.deepEqual(JSON.parse(request.options.body), { p_start:'2025-01-01', p_end:'2026-08-20' });
});

test('catalog request keeps the secret server-side and targets the catalog RPC', () => {
  const request = buildCatalogRequest('https://hnmmlfelaezmijbbwzsg.supabase.co/', '[test-secret]');
  assert.equal(request.url, 'https://hnmmlfelaezmijbbwzsg.supabase.co/rest/v1/rpc/fb_product_catalog');
  assert.equal(request.options.headers.apikey, '[test-secret]');
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(request.options.body, '{}');
});

test('directory request keeps the secret server-side and targets the safe directory RPC', () => {
  const request = buildDirectoryRequest('https://hnmmlfelaezmijbbwzsg.supabase.co/', '[test-secret]');
  assert.equal(request.url, 'https://hnmmlfelaezmijbbwzsg.supabase.co/rest/v1/rpc/fb_customer_company_directory_page');
  assert.equal(request.options.headers.apikey, '[test-secret]');
  assert.equal(request.options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(request.options.body), { p_limit:500 });
});

test('directory request clamps the server-side page size', () => {
  const request = buildDirectoryRequest('https://hnmmlfelaezmijbbwzsg.supabase.co/', '[test-secret]', 5000);
  assert.deepEqual(JSON.parse(request.options.body), { p_limit:500 });
});

test('snapshot response redacts customer and order identifiers', () => {
  const data = sanitizeSnapshot({ recentOrders:[{ shopify_order_id:12345, order_name:'#12345', customer_display_name:'Jane Doe', channel:'shopify_d2c' }] });
  assert.equal(data.recentOrders[0].order_name, '#••••2345');
  assert.equal(data.recentOrders[0].customer_display_name, 'Customer');
  assert.equal('shopify_order_id' in data.recentOrders[0], false);
});
