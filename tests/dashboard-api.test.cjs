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
    assert.match(requests[0], /fb_dashboard_snapshot_v2$/);
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
    if (url.endsWith('/fb_dashboard_snapshot_v2')) return { ok:true, json:async () => ({ daily:[], recentOrders:[] }) };
    if (url.endsWith('/fb_product_catalog')) return { ok:true, json:async () => ({ summary:{ products:173 }, products:[{ title:'Product' }] }) };
    return { ok:true, json:async () => ({ summary:{ customers:243 }, customers:[{ name:'Customer' }], companies:[], locations:[] }) };
  };
  try {
    const res = response();
    await handler({ method:'GET', query:{ start:'2026-08-01', end:'2026-08-20' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'live');
    assert.equal(res.body.data.productCatalog.summary.products, 173);
    assert.equal(res.body.data.productCatalog.products.length, 1);
    assert.equal(res.body.data.customerDirectory.summary.customers, 243);
    assert.equal(res.body.data.customerDirectory.customers.length, 1);
    assert.equal(requests.length, 3);
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
    if (url.endsWith('/fb_dashboard_snapshot_v2')) return { ok:true, json:async () => ({ daily:[], recentOrders:[] }) };
    if (url.endsWith('/fb_product_catalog')) return { ok:true, json:async () => ({ products:[] }) };
    return { ok:true, json:async () => ({ customers:[] }) };
  };
  try {
    const res = response();
    await handler({ method:'GET', query:{} }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'CUSTOMER_DIRECTORY_INVALID');
  } finally {
    global.fetch = previousFetch;
    if (previousUrl == null) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey == null) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});

test('dashboard API bounds directory rows while preserving complete totals', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  const previousFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://hnmmlfelaezmijbbwzsg.supabase.co';
  process.env.SUPABASE_SECRET_KEY = '[test-secret]';
  const customers = Array.from({ length: 501 }, (_, index) => ({ key: `customer-${index}` }));
  const companies = Array.from({ length: 501 }, (_, index) => ({ key: `company-${index}` }));
  const locations = Array.from({ length: 501 }, (_, index) => ({ key: `location-${index}` }));
  const fetchCalls = [
    { ok:true, json:async () => ({ recentOrders: [] }) },
    { ok:true, json:async () => ({ products: [] }) },
    { ok:true, json:async () => ({ summary: { customers: 29405, companies: 399, locations: 934 }, customers, companies, locations }) },
  ];
  global.fetch = async () => fetchCalls.shift();
  try {
    const res = response();
    await handler({ method:'GET', query:{} }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.customerDirectory.customers.length, 500);
    assert.equal(res.body.data.customerDirectory.companies.length, 500);
    assert.equal(res.body.data.customerDirectory.locations.length, 500);
    assert.equal(res.body.data.customerDirectory.summary.customers, 29405);
    assert.deepEqual(res.body.data.customerDirectory.pageInfo, {
      pageSize: 500,
      customersReturned: 500,
      companiesReturned: 500,
      locationsReturned: 500,
      customersTotal: 29405,
      companiesTotal: 399,
      locationsTotal: 934,
    });
  } finally {
    global.fetch = previousFetch;
    if (previousUrl == null) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey == null) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});
