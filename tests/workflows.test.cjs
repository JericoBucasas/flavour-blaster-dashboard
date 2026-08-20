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

test('Shopify writes are impossible without the unresolved Supabase server credential', () => {
  for (const file of files.filter((name) => !name.includes('health'))) {
    const workflow = JSON.parse(fs.readFileSync(path.join(workflowDir, file), 'utf8'));
    const writes = workflow.nodes.filter((node) => node.name.startsWith('Supabase Upsert'));
    assert.ok(writes.length > 0, file);
    for (const node of writes) {
      assert.equal(node.credentials.httpCustomAuth.id, 'FB_SUPABASE_CUSTOM_REQUIRED', node.name);
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

test('data workflows enforce bounded cursor pagination, retries, throttling and success-only checkpoints', () => {
  for (const file of files.filter((name) => !name.includes('health'))) {
    const workflow = JSON.parse(fs.readFileSync(path.join(workflowDir, file), 'utf8'));
    const shopify = workflow.nodes.find((node) => node.name.startsWith('Shopify GraphQL'));
    const advance = workflow.nodes.find((node) => node.name === 'Advance Cursor After Successful Writes');
    const pause = workflow.nodes.find((node) => node.name === 'Rate Limit Pause - 1 Second');
    const checkpoint = workflow.nodes.find((node) => node.name.startsWith('Supabase Upsert Success Checkpoint'));
    assert.ok(shopify, file);
    assert.equal(shopify.retryOnFail, true, file);
    assert.equal(shopify.maxTries, 3, file);
    assert.ok(advance, file);
    assert.match(advance.parameters.jsCode, /PAGE_LIMIT_REACHED/);
    assert.match(advance.parameters.jsCode, /endCursor/);
    assert.ok(pause, file);
    assert.equal(pause.parameters.amount, 1, file);
    assert.ok(checkpoint, file);
    assert.match(checkpoint.parameters.body, /last_success_at/);
    assert.equal(checkpoint.credentials.httpCustomAuth.id, 'FB_SUPABASE_CUSTOM_REQUIRED', file);

    const checkpointParents = Object.entries(workflow.connections)
      .filter(([, outputs]) => JSON.stringify(outputs).includes(checkpoint.name))
      .map(([name]) => name);
    assert.deepEqual(
      checkpointParents,
      [file.includes('orders') ? 'More Orders Pages?' : 'Finalize Soft Deletions [CREDENTIAL REQUIRED]'],
      file,
    );

    if (file.includes('products')) {
      const finalizer = workflow.nodes.find((node) => node.name === 'Finalize Soft Deletions [CREDENTIAL REQUIRED]');
      assert.ok(finalizer, file);
      assert.match(finalizer.parameters.url, /fb_finalize_product_catalog_sync/);
      const finalizerParents = Object.entries(workflow.connections)
        .filter(([, outputs]) => JSON.stringify(outputs).includes(finalizer.name))
        .map(([name]) => name);
      assert.deepEqual(finalizerParents, ['More Product Pages?'], file);
    }
  }
});

test('health workflow queries only columns present in the approved sync-state schema', () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(workflowDir, 'fb-dashboard-sync-health.disabled.json'), 'utf8'));
  const read = workflow.nodes.find((node) => node.name.startsWith('Read Supabase Sync State'));
  assert.match(read.parameters.url, /source_key/);
  assert.match(read.parameters.url, /last_success_at/);
  assert.doesNotMatch(read.parameters.url, /workflow_key|last_attempt_at|last_error/);
});
