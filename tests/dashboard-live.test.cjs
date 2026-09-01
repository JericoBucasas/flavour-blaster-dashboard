'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

function runtime() {
  const context = { window:{}, Map, Number, Date, Array, String, Object, encodeURIComponent };
  vm.runInNewContext(fs.readFileSync('dashboard-live.js', 'utf8'), context);
  return context.window.FlavourBlasterLive;
}

const channels = [{ k:'d2c' }, { k:'b2b' }, { k:'amzus' }, { k:'amzuk' }];
const regions = [{ k:'us' }, { k:'eur' }, { k:'gb' }, { k:'aus' }, { k:'other' }];

test('empty snapshot stays truthful and does not invent live data', () => {
  const result = runtime().normalize({ daily:[] }, channels, regions);
  assert.equal(result.hasLiveData, false);
  assert.equal(result.days.length, 0);
});

test('Shopify rows map to dashboard channels, regions, and net sales', () => {
  const payload = {
    daily:[
      { day:'2026-08-20', channel:'shopify_d2c', region_code:'gb', orders:2, gross_sales:120, units:3, discounts:10, refunds:5, cogs:40, fulfilled_on_time:1 },
      { day:'2026-08-20', channel:'shopify_b2b', region_code:'other', orders:1, gross_sales:80, units:4, discounts:0, refunds:0, cogs:20, fulfilled_on_time:1 },
      { day:'2026-08-20', channel:'amazon_us', region_code:'us', orders:3, gross_sales:60, units:5, discounts:0, refunds:0, cogs:10, fulfilled_on_time:3 },
      { day:'2026-08-20', channel:'amazon_uk', region_code:'gb', orders:2, gross_sales:40, units:2, discounts:0, refunds:0, cogs:8, fulfilled_on_time:2 },
    ],
    hourly:[{ day:'2026-08-20', hour:14, orders:3 }],
  };
  const result = runtime().normalize(payload, channels, regions);
  assert.equal(result.hasLiveData, true);
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].o, 8);
  assert.equal(result.days[0].ns, 285);
  assert.equal(result.days[0].ch.d2c.o, 2);
  assert.equal(result.days[0].ch.b2b.o, 1);
  assert.equal(result.days[0].ch.amzus.o, 3);
  assert.equal(result.days[0].ch.amzuk.o, 2);
  assert.equal(result.days[0].reg.other.s, 80);
  assert.equal(result.days[0].hw[14], 1);
});

test('hourly orders retain channel and region dimensions for dashboard filters', () => {
  const result = runtime().normalize({
    daily:[
      { day:'2026-08-20', channel:'shopify_d2c', region_code:'gb', orders:2, gross_sales:20 },
      { day:'2026-08-20', channel:'amazon_us', region_code:'us', orders:3, gross_sales:30 },
    ],
    hourly:[
      { day:'2026-08-20', hour:9, orders:2, channel:'shopify_d2c', region_code:'gb' },
      { day:'2026-08-20', hour:14, orders:3, channel:'amazon_us', region_code:'us' },
    ],
  }, channels, regions);
  assert.equal(result.days[0].hcr.d2c[2][9], 2);
  assert.equal(result.days[0].hcr.amzus[0][14], 3);
  assert.equal(result.days[0].hw[9], 0.4);
  assert.equal(result.days[0].hw[14], 0.6);
});

test('explicit Shopify net sales preserve sales reversals not present in refunds', () => {
  const result = runtime().normalize({
    daily:[{
      day:'2026-08-20', channel:'shopify_d2c', region_code:'gb', orders:25,
      gross_sales:9274.69, discounts:705.43, refunds:0, net_sales:8483.50,
      shipping:404.50, taxes:311.46, return_fees:0, total_sales:9199.46,
      units:202, cogs:0, fulfilled_on_time:22,
    }],
    hourly:[],
  }, channels, regions);
  assert.equal(result.days[0].ns, 8483.50);
  assert.equal(result.days[0].sh, 404.50);
  assert.equal(result.days[0].tax, 311.46);
  assert.equal(result.days[0].ts, 9199.46);
  assert.ok(Math.abs(result.days[0].rfS - 85.76) < 1e-9);
  assert.equal(result.days[0].reg.gb.dsc, 705.43);
  assert.equal(result.days[0].cr.d2c[2].dsc, 705.43);
});

test('explicit AOV sales remain separate from post-order gross sales adjustments', () => {
  const result = runtime().normalize({
    daily:[{
      day:'2026-08-20', channel:'shopify_d2c', region_code:'gb', orders:2,
      gross_sales:220, discounts:20, aov_sales:150, aov_orders:2,
      net_sales:200, units:3,
    }],
    hourly:[],
  }, channels, regions);
  assert.equal(result.days[0].aovS, 150);
  assert.equal(result.days[0].aovO, 2);
  assert.equal(result.days[0].ch.d2c.aovS, 150);
  assert.equal(result.days[0].reg.gb.aovS, 150);
  assert.equal(result.days[0].cr.d2c[2].aovS, 150);
});

test('live loader scopes the request to the active dashboard section', async () => {
  let requestedUrl = '';
  const context = {
    window:{}, Map, Number, Date, Array, String, Object, encodeURIComponent,
    fetch:async (url) => {
      requestedUrl = url;
      return { ok:true, json:async () => ({ status:'live', data:{ daily:[] } }) };
    },
  };
  vm.runInNewContext(fs.readFileSync('dashboard-live.js', 'utf8'), context);
  await context.window.FlavourBlasterLive.load('/api/dashboard', '2026-08-19', '2026-08-20', 'orders');
  assert.equal(requestedUrl, '/api/dashboard?start=2026-08-19&end=2026-08-20&section=orders');
});

test('long-range merge deduplicates GA4 daily and regional dimension rows', () => {
  const merged = runtime().mergePayloads([
    { traffic:{ status:'live', propertyId:298253309, coverageStart:'2025-01-01', coverageEnd:'2025-12-31', lastSuccessAt:'2026-08-20T12:25:00Z', daily:[{ day:'2025-12-31', sessions:10 }], channelGroups:[{ day:'2025-12-31', key:'gb:Organic Search', regionCode:'gb', sessions:8 }], sourceMedium:[], countries:[], devices:[], landingPages:[] } },
    { traffic:{ status:'stale', propertyId:298253309, coverageStart:'2025-12-31', coverageEnd:'2026-08-20', lastSuccessAt:'2026-08-20T18:25:00Z', daily:[{ day:'2025-12-31', sessions:12 }, { day:'2026-01-01', sessions:7 }], channelGroups:[{ day:'2025-12-31', key:'gb:Organic Search', regionCode:'gb', sessions:9 }], sourceMedium:[], countries:[], devices:[], landingPages:[] } },
  ], '2025-01-01', '2026-08-20');
  assert.equal(merged.traffic.status, 'stale');
  assert.equal(merged.traffic.coverageStart, '2025-01-01');
  assert.equal(merged.traffic.coverageEnd, '2026-08-20');
  assert.equal(merged.traffic.daily.length, 2);
  assert.equal(merged.traffic.daily.find((row) => row.day === '2025-12-31').sessions, 12);
  assert.equal(merged.traffic.channelGroups.length, 1);
  assert.equal(merged.traffic.channelGroups[0].sessions, 9);
});
