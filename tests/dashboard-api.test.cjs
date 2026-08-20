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

test('dashboard API merges the sales snapshot with the complete product catalog', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  const previousFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://hnmmlfelaezmijbbwzsg.supabase.co';
  process.env.SUPABASE_SECRET_KEY = '[test-secret]';
  const requests = [];
  global.fetch = async (url) => {
    requests.push(url);
    if (url.endsWith('/fb_dashboard_snapshot')) return { ok:true, json:async () => ({ daily:[], recentOrders:[] }) };
    return { ok:true, json:async () => ({ summary:{ products:173 }, products:[{ title:'Product' }] }) };
  };
  try {
    const res = response();
    await handler({ method:'GET', query:{ start:'2026-08-01', end:'2026-08-20' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'live');
    assert.equal(res.body.data.productCatalog.summary.products, 173);
    assert.equal(res.body.data.productCatalog.products.length, 1);
    assert.equal(requests.length, 2);
  } finally {
    global.fetch = previousFetch;
    if (previousUrl == null) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey == null) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});
