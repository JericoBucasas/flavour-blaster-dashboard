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

test('finance cost coverage distinguishes confirmed zero cost from missing cost', () => {
  const live = runtime();
  const complete = live.normalize({ daily:[{
    day:'2026-08-20', channel:'shopify_d2c', region_code:'gb', orders:1,
    gross_sales:25, net_sales:25, units:2, cogs:0, costed_units:2, uncosted_units:0,
  }] }, channels, regions).days[0];
  assert.equal(live.financeStatus(complete).cogsComplete, true);
  assert.equal(live.financeStatus(complete).costedUnits, 2);

  const incomplete = live.normalize({ daily:[{
    day:'2026-08-20', channel:'shopify_d2c', region_code:'gb', orders:1,
    gross_sales:25, net_sales:25, units:2, cogs:0, costed_units:1, uncosted_units:1,
  }] }, channels, regions).days[0];
  assert.equal(live.financeStatus(incomplete).cogsComplete, false);
  assert.equal(live.financeStatus(incomplete).cogsReason, 'Incomplete cost coverage');
  assert.equal(live.financeStatus(incomplete).uncostedUnits, 1);

  const legacy = live.normalize({ daily:[{
    day:'2026-08-20', channel:'shopify_d2c', region_code:'gb', gross_sales:25, units:2, cogs:0,
  }] }, channels, regions).days[0];
  assert.equal(live.financeStatus(legacy).coverageKnown, false);
});

test('daily cost values retain exact channel and region grain', () => {
  const day = runtime().normalize({ daily:[
    { day:'2026-08-20', channel:'shopify_d2c', region_code:'gb', gross_sales:100, net_sales:100, units:2, cogs:70, costed_units:2, uncosted_units:0 },
    { day:'2026-08-20', channel:'shopify_d2c', region_code:'us', gross_sales:300, net_sales:300, units:3, cogs:30, costed_units:2, uncosted_units:1 },
  ] }, channels, regions).days[0];
  assert.equal(day.cr.d2c[2].cogs, 70);
  assert.equal(day.cr.d2c[0].cogs, 30);
  assert.equal(day.cr.d2c[2].uncostedU, 0);
  assert.equal(day.cr.d2c[0].uncostedU, 1);
  assert.equal(day.ch.d2c.cogs, 100);
});

test('finance changes honor business impact and zero comparison values', () => {
  const live = runtime();
  assert.equal(live.financeChange(80, 100, true).favorable, true);
  assert.equal(live.financeChange(120, 100, true).favorable, false);
  assert.equal(live.financeChange(20, 0, false).zeroBaseline, true);
  assert.equal(live.financeChange(0, 0, false).direction, 0);
  assert.deepEqual(Array.from(live.cumulative([{ gp:10 }, { gp:-3 }, { gp:7 }], 'gp')), [10, 7, 14]);
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

test('Google Ads totals use authoritative account rows and reconciled region rows', () => {
  const live = runtime();
  const payload = {
    status:'live', rangeComplete:true, geoComplete:true,
    dailyTotals:[
      { day:'2026-08-19', cost:10, impressions:1000, clicks:50, conversions:2, conversionValue:40 },
      { day:'2026-08-20', cost:20, impressions:2000, clicks:80, conversions:3, conversionValue:90, isProvisional:true },
    ],
    dailyRegions:[
      { day:'2026-08-19', regionCode:'gb', cost:6, impressions:600, clicks:30, conversions:1, conversionValue:25 },
      { day:'2026-08-19', regionCode:'us', cost:4, impressions:400, clicks:20, conversions:1, conversionValue:15 },
      { day:'2026-08-20', regionCode:'gb', cost:12, impressions:1200, clicks:45, conversions:2, conversionValue:60, isProvisional:true },
      { day:'2026-08-20', regionCode:'us', cost:8, impressions:800, clicks:35, conversions:1, conversionValue:30, isProvisional:true },
    ],
    campaigns:[
      { day:'2026-08-19', campaignId:'1', campaignName:'Search', campaignStatus:'ENABLED', channelType:'SEARCH', channelSubtype:'SEARCH_STANDARD', cost:10, impressions:1000, clicks:50, conversions:2, conversionValue:40 },
      { day:'2026-08-20', campaignId:'1', campaignName:'Search', campaignStatus:'ENABLED', channelType:'SEARCH', channelSubtype:'SEARCH_STANDARD', cost:20, impressions:2000, clicks:80, conversions:3, conversionValue:90 },
    ],
    campaignRegions:[
      { day:'2026-08-19', campaignId:'1', regionCode:'gb', cost:6, impressions:600, clicks:30, conversions:1, conversionValue:25 },
      { day:'2026-08-19', campaignId:'1', regionCode:'us', cost:4, impressions:400, clicks:20, conversions:1, conversionValue:15 },
      { day:'2026-08-20', campaignId:'1', regionCode:'gb', cost:12, impressions:1200, clicks:45, conversions:2, conversionValue:60 },
      { day:'2026-08-20', campaignId:'1', regionCode:'us', cost:8, impressions:800, clicks:35, conversions:1, conversionValue:30 },
    ],
  };
  const all = live.adsRange(payload, Date.parse('2026-08-19T00:00:00Z'), Date.parse('2026-08-20T00:00:00Z'), ['us','gb','eur','aus','other']);
  assert.equal(all.available, true);
  assert.equal(all.cost, 30);
  assert.equal(all.conversionValue, 130);
  assert.equal(all.roas, 130 / 30);
  assert.equal(all.provisional, true);
  assert.equal(all.campaigns[0].campaignName, 'Search');

  const gb = live.adsRange(payload, Date.parse('2026-08-19T00:00:00Z'), Date.parse('2026-08-20T00:00:00Z'), ['gb']);
  assert.equal(gb.available, true);
  assert.equal(gb.cost, 18);
  assert.equal(gb.campaigns[0].cost, 18);
  assert.equal(gb.campaigns[0].conversionValue, 85);
});

test('Google Ads region mismatch and incomplete coverage stay unavailable', () => {
  const live = runtime();
  const base = { status:'live', rangeComplete:true, geoComplete:false, geographyReason:'Mismatch', dailyTotals:[], dailyRegions:[], campaigns:[], campaignRegions:[] };
  const regional = live.adsRange(base, 0, Date.now(), ['gb']);
  assert.equal(regional.available, false);
  assert.equal(regional.reason, 'Mismatch');
  const incomplete = live.adsRange({ ...base, rangeComplete:false, geoComplete:true }, 0, Date.now(), ['us','gb','eur','aus','other']);
  assert.equal(incomplete.available, false);
  assert.match(incomplete.reason, /coverage is incomplete/);
});

test('Google Ads zero denominators stay null without hiding a covered zero-activity range', () => {
  const live = runtime();
  const zero = live.adsRange({
    status:'live', rangeComplete:true, geoComplete:true,
    dailyTotals:[{ day:'2026-08-20', cost:0, impressions:0, clicks:0, conversions:0, conversionValue:0 }],
    dailyRegions:[], campaigns:[{ day:'2026-08-20', campaignId:'1', campaignName:'No activity', cost:0, impressions:0, clicks:0, conversions:0, conversionValue:0 }], campaignRegions:[],
  }, Date.parse('2026-08-20T00:00:00Z'), Date.parse('2026-08-20T00:00:00Z'), ['us','gb','eur','aus','other']);
  assert.equal(zero.available, true);
  assert.equal(zero.roas, null);
  assert.equal(zero.cpa, null);
  assert.equal(zero.ctr, null);
  assert.equal(zero.cpc, null);
  assert.equal(zero.campaigns.length, 0);
});

test('Google Ads is a partial Finance input and never completes contribution', () => {
  const live = runtime();
  const status = live.financeStatus({ covRows:1, covKnown:1, costedU:2, uncostedU:0 }, { available:true, cost:42.5 });
  assert.equal(status.cogsComplete, true);
  assert.equal(status.googleAdsComplete, true);
  assert.equal(status.googleAdsPartial, true);
  assert.equal(status.googleAdsSpend, 42.5);
  assert.equal(status.adSpendComplete, false);
  assert.equal(status.contributionComplete, false);
});

test('long-range merge combines Google Ads chunks without losing strict status', () => {
  const merged = runtime().mergePayloads([
    { ads:{ customerId:'9329387049', currencyCode:'GBP', timeZone:'Europe/London', status:'live', rangeComplete:true, backfillComplete:true, geoComplete:true, dailyTotals:[{ day:'2025-12-31', cost:10, impressions:100, clicks:10, conversions:1, conversionValue:30 }], dailyRegions:[], campaigns:[{ day:'2025-12-31', campaignId:'1', campaignName:'Search', cost:10, impressions:100, clicks:10, conversions:1, conversionValue:30 }], campaignRegions:[] } },
    { ads:{ customerId:'9329387049', currencyCode:'GBP', timeZone:'Europe/London', status:'stale', rangeComplete:true, backfillComplete:false, geoComplete:true, dailyTotals:[{ day:'2026-01-01', cost:20, impressions:200, clicks:20, conversions:2, conversionValue:50 }], dailyRegions:[], campaigns:[{ day:'2026-01-01', campaignId:'1', campaignName:'Search', cost:20, impressions:200, clicks:20, conversions:2, conversionValue:50 }], campaignRegions:[] } },
  ], '2025-12-31', '2026-01-01');
  assert.equal(merged.ads.status, 'stale');
  assert.equal(merged.ads.backfillComplete, false);
  assert.equal(merged.ads.dailyTotals.length, 2);
  assert.equal(merged.ads.campaigns.length, 2);
  const range = runtime().adsRange(merged.ads, Date.parse('2025-12-31T00:00:00Z'), Date.parse('2026-01-01T00:00:00Z'), ['us','gb','eur','aus','other']);
  assert.equal(range.campaigns[0].cost, 30);
  assert.equal(range.campaigns[0].conversionValue, 80);
});
