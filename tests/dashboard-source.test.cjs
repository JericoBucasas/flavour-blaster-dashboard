'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

test('dashboard has one update lifecycle and loads continuous sections separately', () => {
  const source = fs.readFileSync('Sales Dashboard v2.dc.html', 'utf8');
  assert.equal((source.match(/\bcomponentDidUpdate\s*\(/g) || []).length, 1);
  assert.match(source, /componentDidUpdate\(prevState\)/);
  assert.doesNotMatch(source, /componentDidUpdate\([^)]*,/);
  assert.match(source, /\['overview','products','customers'\]/);
  assert.doesNotMatch(source, /\? 'all' : this\.state\.view/);
  assert.match(source, /alignToLatest/);
  assert.match(source, /rangeKey:coverageEndMs === this\.NOW - this\.D \? 'yesterday' : 'custom'/);
});

test('GBP reporting snapshot preserves Shopify values and converts Amazon rows', () => {
  const source = fs.readFileSync('supabase/migrations/202608240002_gbp_reporting_snapshot.sql', 'utf8');
  assert.match(source, /'reportingCurrencyCode', 'GBP'/);
  assert.match(source, /in \('shopify_d2c', 'shopify_b2b'\) then 1::numeric else 0\.79::numeric/);
  assert.match(source, /when r->>'currency_code' = 'GBP'/);
  assert.match(source, /revoke all on function public\.fb_dashboard_snapshot_v3/);
  assert.match(source, /grant execute on function public\.fb_dashboard_snapshot_v3\(date, date\) to service_role/);
});
