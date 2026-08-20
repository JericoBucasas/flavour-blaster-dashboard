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
    ],
    hourly:[{ day:'2026-08-20', hour:14, orders:3 }],
  };
  const result = runtime().normalize(payload, channels, regions);
  assert.equal(result.hasLiveData, true);
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].o, 3);
  assert.equal(result.days[0].ns, 185);
  assert.equal(result.days[0].ch.d2c.o, 2);
  assert.equal(result.days[0].ch.b2b.o, 1);
  assert.equal(result.days[0].reg.other.s, 80);
  assert.equal(result.days[0].hw[14], 1);
});
