'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const workflowDir = path.join(__dirname, '..', 'workflows', 'n8n');
const files = fs.readdirSync(workflowDir).filter((name) => name.endsWith('.json'));

test('all committed n8n workflows are disabled behind a closed gate', () => {
  assert.equal(files.length, 3);
  for (const file of files) {
    const workflow = JSON.parse(fs.readFileSync(path.join(workflowDir, file), 'utf8'));
    assert.equal(workflow.active, false, file);
    assert.match(workflow.name, /\[DISABLED\]$/, file);
    const gate = workflow.nodes.find((node) => node.name === 'Closed Development Gate');
    assert.ok(gate, file);
    assert.match(gate.parameters.jsCode, /DEVELOPMENT_GATE = false/, file);
  }
});

test('Shopify writes are impossible without the unresolved Supabase credential', () => {
  for (const file of files.filter((name) => !name.includes('health'))) {
    const workflow = JSON.parse(fs.readFileSync(path.join(workflowDir, file), 'utf8'));
    const writes = workflow.nodes.filter((node) => node.name.startsWith('Supabase Upsert'));
    assert.ok(writes.length > 0, file);
    for (const node of writes) {
      assert.equal(node.credentials.httpHeaderAuth.id, 'FB_SUPABASE_SECRET_REQUIRED', node.name);
    }
  }
});

test('orders query uses Shopify shop currency and does not request customer email', () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(workflowDir, 'fb-dashboard-orders-incremental.disabled.json'), 'utf8'));
  const query = workflow.nodes.find((node) => node.name === 'Shopify GraphQL - Orders Page').parameters.body;
  const normalize = workflow.nodes.find((node) => node.name === 'Normalize Orders, Lines and Customers').parameters.jsCode;
  assert.doesNotMatch(query, /displayName email/);
  assert.match(normalize, /currentTotalPriceSet\?\.shopMoney\?\.currencyCode/);
  assert.match(normalize, /email: null/);
});
