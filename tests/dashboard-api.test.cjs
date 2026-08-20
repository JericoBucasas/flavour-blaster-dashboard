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
