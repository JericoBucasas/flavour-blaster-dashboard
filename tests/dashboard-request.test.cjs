'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDate, buildSnapshotRequest, sanitizeSnapshot } = require('../lib/dashboard-request');

test('parseDate accepts ISO dates and falls back safely', () => {
  assert.equal(parseDate('2026-08-20', '2025-01-01'), '2026-08-20');
  assert.equal(parseDate('not-a-date', '2025-01-01'), '2025-01-01');
});

test('snapshot request keeps the secret in server headers only', () => {
  const request = buildSnapshotRequest('https://hnmmlfelaezmijbbwzsg.supabase.co/', '[test-secret]', '2025-01-01', '2026-08-20');
  assert.equal(request.url, 'https://hnmmlfelaezmijbbwzsg.supabase.co/rest/v1/rpc/fb_dashboard_snapshot');
  assert.equal(request.options.headers.apikey, '[test-secret]');
  assert.equal(request.options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(request.options.body), { p_start:'2025-01-01', p_end:'2026-08-20' });
});

test('snapshot response redacts customer and order identifiers', () => {
  const data = sanitizeSnapshot({ recentOrders:[{ shopify_order_id:12345, order_name:'#12345', customer_display_name:'Jane Doe', channel:'shopify_d2c' }] });
  assert.equal(data.recentOrders[0].order_name, '#••••2345');
  assert.equal(data.recentOrders[0].customer_display_name, 'Customer');
  assert.equal('shopify_order_id' in data.recentOrders[0], false);
});
