'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const handler = require('../api/dashboard');

function response() {
  return {
    statusCode:200,
    headers:{},
    body:null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function traffic(overrides = {}) {
  return { status:'live', propertyId:298253309, coverageStart:'2025-01-01', coverageEnd:'2026-08-20', lastSuccessAt:'2026-08-20T18:25:00Z', provisionalThrough:null, daily:[], channelGroups:[], sourceMedium:[], countries:[], devices:[], landingPages:[], ...overrides };
}

function ads(overrides = {}) {
  return { customerId:'9329387049', currencyCode:'GBP', timeZone:'Europe/London', status:'live', coverageStart:'2025-01-01', coverageEnd:'2026-08-20', lastSuccessAt:'2026-08-20T18:25:00Z', provisionalThrough:null, rangeComplete:true, backfillComplete:true, geoComplete:true, geographyReason:null, dailyTotals:[], dailyRegions:[], campaigns:[], campaignRegions:[], ...overrides };
}

test('dashboard API rejects unsupported methods', async () => {
  const res = response();
  await handler({ method:'POST', query:{} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
  assert.equal(res.body.code, 'METHOD_NOT_ALLOWED');
});

test('dashboard API returns a controlled error for invalid dates', async () => {
  const res = response();
  await handler({ method:'GET', query:{ start:'2026-99-99' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_DATE');
});

test('orders section only requests the sales snapshot', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  const previousFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://hnmmlfelaezmijbbwzsg.supabase.co';
  process.env.SUPABASE_SECRET_KEY = '[test-secret]';
  const requests = [];
  global.fetch = async (url) => {
    requests.push(url);
    return { ok:true, json:async () => ({ daily:[], recentOrders:[] }) };
  };
  try {
    const res = response();
    await handler({ method:'GET', query:{ start:'2026-08-19', end:'2026-08-20', section:'orders' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'live');
    assert.equal(requests.length, 1);
    assert.match(requests[0], /fb_dashboard_snapshot_v8$/);
    assert.equal(res.body.data.productCatalog, undefined);
    assert.equal(res.body.data.customerDirectory, undefined);
  } finally {
    global.fetch = previousFetch;
    if (previousUrl == null) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey == null) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});

test('finance section requests sales and optional Google Ads only', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  const previousFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://hnmmlfelaezmijbbwzsg.supabase.co';
  process.env.SUPABASE_SECRET_KEY = '[test-secret]';
  const requests = [];
  global.fetch = async (url) => {
    requests.push(url);
    if (url.endsWith('/fb_google_ads_dashboard_snapshot')) return { ok:true, json:async () => ads() };
    return { ok:true, json:async () => ({ daily:[], recentOrders:[] }) };
  };
  try {
    const res = response();
    await handler({ method:'GET', query:{ start:'2026-08-19', end:'2026-08-20', section:'finance' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, 2);
    assert.ok(requests.some(url => /fb_dashboard_snapshot_v8$/.test(url)));
    assert.ok(requests.some(url => /fb_google_ads_dashboard_snapshot$/.test(url)));
    assert.equal(res.body.data.ads.customerId, '9329387049');
    assert.equal(res.body.data.traffic, undefined);
    assert.equal(res.body.data.productCatalog, undefined);
    assert.equal(res.body.data.customerDirectory, undefined);
  } finally {
    global.fetch = previousFetch;
    if (previousUrl == null) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey == null) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});

test('dashboard API merges sales, product catalog, and customer company directory', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  const previousFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://hnmmlfelaezmijbbwzsg.supabase.co';
  process.env.SUPABASE_SECRET_KEY = '[test-secret]';
  const requests = [];
  global.fetch = async (url) => {
    requests.push(url);
    if (url.endsWith('/fb_dashboard_snapshot_v8')) return { ok:true, json:async () => ({ daily:[], recentOrders:[] }) };
    if (url.endsWith('/fb_product_catalog')) return { ok:true, json:async () => ({ summary:{ products:173 }, products:[{ title:'Product' }] }) };
    if (url.endsWith('/fb_ga4_dashboard_snapshot')) return { ok:true, json:async () => traffic() };
    if (url.endsWith('/fb_google_ads_dashboard_snapshot')) return { ok:true, json:async () => ads() };
    return { ok:true, json:async () => ({ summary:{ customers:243 }, customers:[{ name:'Customer' }], companies:[], locations:[] }) };
  };
  try {
    const res = response();
    await handler({ method:'GET', query:{ start:'2026-08-01', end:'2026-08-20', section:'all' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'live');
    assert.equal(res.body.data.productCatalog.summary.products, 173);
    assert.equal(res.body.data.productCatalog.products.length, 1);
    assert.equal(res.body.data.customerDirectory.summary.customers, 243);
    assert.equal(res.body.data.customerDirectory.customers.length, 1);
    assert.equal(res.body.data.traffic.propertyId, 298253309);
    assert.equal(res.body.data.ads.customerId, '9329387049');
    assert.equal(requests.length, 5);
  } finally {
    global.fetch = previousFetch;
    if (previousUrl == null) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey == null) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});

test('dashboard API rejects an invalid customer directory payload', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  const previousFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://hnmmlfelaezmijbbwzsg.supabase.co';
  process.env.SUPABASE_SECRET_KEY = '[test-secret]';
  global.fetch = async (url) => {
    if (url.endsWith('/fb_dashboard_snapshot_v8')) return { ok:true, json:async () => ({ daily:[], recentOrders:[] }) };
    if (url.endsWith('/fb_product_catalog')) return { ok:true, json:async () => ({ products:[] }) };
    return { ok:true, json:async () => ({ customers:[] }) };
  };
  try {
    const res = response();
    await handler({ method:'GET', query:{ section:'all' } }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'CUSTOMER_DIRECTORY_INVALID');
  } finally {
    global.fetch = previousFetch;
    if (previousUrl == null) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey == null) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});

test('dashboard API preserves the database-bounded directory page and complete totals', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  const previousFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://hnmmlfelaezmijbbwzsg.supabase.co';
  process.env.SUPABASE_SECRET_KEY = '[test-secret]';
  const customers = Array.from({ length: 500 }, (_, index) => ({ key: `customer-${index}` }));
  const companies = Array.from({ length: 399 }, (_, index) => ({ key: `company-${index}` }));
  const locations = Array.from({ length: 500 }, (_, index) => ({ key: `location-${index}` }));
  const fetchCalls = [
    { ok:true, json:async () => ({ recentOrders: [] }) },
    { ok:true, json:async () => ({ products: [] }) },
    { ok:true, json:async () => ({
      summary: { customers: 29405, companies: 399, locations: 934 },
      pageInfo: { pageSize:500, customersReturned:500, companiesReturned:399, locationsReturned:500,
        customersTotal:29405, companiesTotal:399, locationsTotal:934 },
      customers, companies, locations,
    }) },
    { ok:true, json:async () => traffic() },
    { ok:true, json:async () => ads() },
  ];
  global.fetch = async () => fetchCalls.shift();
  try {
    const res = response();
    await handler({ method:'GET', query:{ section:'all' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.customerDirectory.customers.length, 500);
    assert.equal(res.body.data.customerDirectory.companies.length, 399);
    assert.equal(res.body.data.customerDirectory.locations.length, 500);
    assert.equal(res.body.data.customerDirectory.summary.customers, 29405);
    assert.deepEqual(res.body.data.customerDirectory.pageInfo, {
      pageSize: 500,
      customersReturned: 500,
      companiesReturned: 399,
      locationsReturned: 500,
      customersTotal: 29405,
      companiesTotal: 399,
      locationsTotal: 934,
    });
    assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
  } finally {
    global.fetch = previousFetch;
    if (previousUrl == null) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey == null) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});

test('dashboard API keeps Shopify live when GA4 is temporarily unavailable', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  const previousFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://hnmmlfelaezmijbbwzsg.supabase.co';
  process.env.SUPABASE_SECRET_KEY = '[test-secret]';
  global.fetch = async (url) => url.endsWith('/fb_ga4_dashboard_snapshot')
    ? { ok:false, status:404, json:async () => ({ message:'function unavailable' }) }
    : { ok:true, status:200, json:async () => ({ daily:[], recentOrders:[] }) };
  try {
    const res = response();
    await handler({ method:'GET', query:{ start:'2026-08-19', end:'2026-08-20', section:'overview' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'live');
    assert.equal(res.body.data.traffic.status, 'unavailable');
    assert.equal(res.body.data.traffic.code, 'GA4_DATASTORE_QUERY_FAILED');
  } finally {
    global.fetch = previousFetch;
    if (previousUrl == null) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey == null) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});

test('dashboard API keeps Shopify live when Google Ads is temporarily unavailable', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  const previousFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://hnmmlfelaezmijbbwzsg.supabase.co';
  process.env.SUPABASE_SECRET_KEY = '[test-secret]';
  global.fetch = async (url) => {
    if (url.endsWith('/fb_google_ads_dashboard_snapshot')) throw new Error('temporary network failure');
    if (url.endsWith('/fb_ga4_dashboard_snapshot')) return { ok:true, status:200, json:async () => traffic() };
    return { ok:true, status:200, json:async () => ({ daily:[], recentOrders:[] }) };
  };
  try {
    const res = response();
    await handler({ method:'GET', query:{ start:'2026-08-19', end:'2026-08-20', section:'overview' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'live');
    assert.equal(res.body.data.ads.status, 'unavailable');
    assert.equal(res.body.data.ads.code, 'GOOGLE_ADS_DATASTORE_QUERY_FAILED');
  } finally {
    global.fetch = previousFetch;
    if (previousUrl == null) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey == null) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});
