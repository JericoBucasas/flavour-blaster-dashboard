'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const workflowDir = path.join(__dirname, '..', 'workflows', 'n8n');
const files = fs.readdirSync(workflowDir).filter((name) => name.endsWith('.json'));

test('all committed n8n workflows are disabled behind a closed gate', () => {
  assert.equal(files.length, 6);
  for (const file of files) {
    const workflow = JSON.parse(fs.readFileSync(path.join(workflowDir, file), 'utf8'));
    assert.equal(workflow.active, false, file);
    assert.match(workflow.name, /DISABLED\]$/, file);
    const gate = workflow.nodes.find((node) => node.name === 'Closed Development Gate');
    assert.ok(gate, file);
    assert.match(gate.parameters.jsCode, /DEVELOPMENT_GATE = false/, file);
  }
});

test('GA4 workflows use the verified property, regional grains, bounded windows, and success-only checkpoints', () => {
  const incremental = JSON.parse(fs.readFileSync(path.join(workflowDir, 'fb-dashboard-ga4-traffic-incremental.disabled.json'), 'utf8'));
  const backfill = JSON.parse(fs.readFileSync(path.join(workflowDir, 'fb-dashboard-ga4-historical-backfill.disabled.json'), 'utf8'));
  assert.equal(incremental.settings.timezone, 'Europe/London');
  assert.match(JSON.stringify(incremental.nodes.find((node) => node.name.startsWith('Schedule - ')).parameters), /0 20 \*\/6 \* \* \*/);
  assert.equal(incremental.meta.propertyId, '298253309');
  assert.equal(incremental.meta.overlapDays, 3);
  assert.equal(backfill.meta.historicalFloor, '2025-01-01');
  assert.equal(backfill.nodes.some((node) => node.type === 'n8n-nodes-base.scheduleTrigger'), false);
  for (const workflow of [incremental, backfill]) {
    const reports = workflow.nodes.filter((node) => node.name.startsWith('GA4 Report |'));
    assert.equal(reports.length, 6);
    for (const report of reports) {
      assert.equal(report.parameters.propertyId.value, '298253309');
      assert.equal(report.credentials.googleAnalyticsOAuth2.id, 'FB_GA4_OAUTH_REQUIRED');
      assert.deepEqual(report.parameters.metricsGA4.metricValues.map((item) => item.listName), ['sessions','engagedSessions','eventCount','addToCarts','checkouts','ecommercePurchases','purchaseRevenue']);
      if (!report.name.endsWith('daily')) assert.ok(report.parameters.dimensionsGA4.dimensionValues.some((item) => item.listName === 'countryId'));
    }
    const normalizers = workflow.nodes.filter((node) => node.name.startsWith('Normalize GA4 |') && !node.name.endsWith('daily'));
    for (const normalizer of normalizers) {
      assert.match(normalizer.parameters.jsCode, /region_code:regionCode/);
      assert.match(normalizer.parameters.jsCode, /regionCode \+ ':' \+ rawKey/);
      assert.match(normalizer.parameters.jsCode, /const grouped = new Map\(\)/);
      assert.match(normalizer.parameters.jsCode, /previous\[field\] \+= current\[field\]/);
    }
    const writes = workflow.nodes.filter((node) => node.name.startsWith('Supabase Upsert GA4') && !node.name.includes('Success Checkpoint'));
    assert.equal(writes.length, 6);
    assert.ok(writes.every((node) => node.credentials.httpCustomAuth.id === 'FB_SUPABASE_CUSTOM_REQUIRED'));
  }
  const checkpoint = incremental.nodes.find((node) => node.name === 'Supabase Upsert GA4 Success Checkpoint [CREDENTIAL REQUIRED]');
  const checkpointParents = Object.entries(incremental.connections).filter(([, outputs]) => JSON.stringify(outputs).includes(checkpoint.name)).map(([name]) => name);
  assert.deepEqual(checkpointParents, ['Supabase Upsert GA4 landing_page [CREDENTIAL REQUIRED]']);
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
  assert.match(query, /customer \{ id legacyResourceId displayName/);
  assert.match(normalize, /customer_id:customerId/);
  assert.match(normalize, /customer_display_name:o\.customer\?\.displayName \|\| null/);
  assert.match(normalize, /currentTotalPriceSet\?\.shopMoney\?\.currencyCode/);
  assert.match(normalize, /email: null/);
});

test('Shopify sales events are incremental, idempotent, and contain no customer fields', () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(workflowDir, 'fb-dashboard-orders-incremental.disabled.json'), 'utf8'));
  const read = workflow.nodes.find((node) => node.name === 'Sales Events | Read Checkpoint [CREDENTIAL REQUIRED]');
  const build = workflow.nodes.find((node) => node.name === 'Sales Events | Build Incremental Window');
  const shopify = workflow.nodes.find((node) => node.name === 'Sales Events | Shopify GraphQL Page');
  const normalize = workflow.nodes.find((node) => node.name === 'Sales Events | Normalize Shopify Sales');
  const upsert = workflow.nodes.find((node) => node.name === 'Supabase Upsert Sales Events [CREDENTIAL REQUIRED]');
  const checkpoint = workflow.nodes.find((node) => node.name === 'Sales Events | Upsert Success Checkpoint [CREDENTIAL REQUIRED]');
  assert.match(read.parameters.url, /shopify_sales_events/);
  assert.match(build.parameters.jsCode, /saved\.getTime\(\) - 7 \* 86400000/);
  assert.doesNotMatch(build.parameters.jsCode, /saved\.getTime\(\) - 10 \* 60000/);
  assert.match(build.parameters.jsCode, /rolling_7_day_sales_events_sync/);
  assert.equal(workflow.meta.incrementalOverlapMinutes, 7 * 24 * 60);
  assert.equal(workflow.meta.salesEventsRollingDays, 7);
  assert.match(shopify.parameters.body, /agreements\(first: 50\)/);
  assert.match(shopify.parameters.body, /sales\(first: 50\)/);
  assert.doesNotMatch(shopify.parameters.body, /customer|email|phone|billingAddress|shippingAddress/);
  assert.match(normalize.parameters.jsCode, /shopify_sale_id/);
  assert.match(normalize.parameters.jsCode, /eventStart = Date\.parse/);
  assert.match(normalize.parameters.jsCode, /happenedMs < eventStart \|\| happenedMs >= eventEnd/);
  assert.match(upsert.parameters.url, /fb_sales_events\?on_conflict=shopify_sale_id/);
  assert.equal(upsert.credentials.httpCustomAuth.id, 'FB_SUPABASE_CUSTOM_REQUIRED');
  assert.match(checkpoint.parameters.body, /idempotency_key:'shopify_sale_id'/);
});

test('Amazon order branches are orders-only, incremental, and independently checkpointed', () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(workflowDir, 'fb-dashboard-orders-incremental.disabled.json'), 'utf8'));
  assert.equal(workflow.settings.timezone, 'Europe/London');
  const schedule = workflow.nodes.find((node) => node.name === 'Schedule - Every 6 Hours (London)');
  assert.ok(JSON.stringify(schedule.parameters).includes('0 0 */6 * * *'));

  for (const market of [
    { label:'Amazon US', store:'flavour-blaster-amazon-us', source:'shopify_orders_amazon_us', channel:'amazon_us', credential:'FB_AMAZON_US_SHOPIFY_OAUTH_REQUIRED' },
    { label:'Amazon UK', store:'flavour-blaster-amazon-uk', source:'shopify_orders_amazon_uk', channel:'amazon_uk', credential:'FB_AMAZON_UK_SHOPIFY_OAUTH_REQUIRED' },
  ]) {
    const read = workflow.nodes.find((node) => node.name === `${market.label} | Read Checkpoint [CREDENTIAL REQUIRED]`);
    const build = workflow.nodes.find((node) => node.name === `${market.label} | Build Incremental Window`);
    const shopify = workflow.nodes.find((node) => node.name === `${market.label} | Shopify Orders Page`);
    const normalize = workflow.nodes.find((node) => node.name === `${market.label} | Normalize Orders and Lines`);
    const checkpoint = workflow.nodes.find((node) => node.name === `${market.label} | Upsert Success Checkpoint [CREDENTIAL REQUIRED]`);
    assert.match(read.parameters.url, new RegExp(market.source));
    assert.match(build.parameters.jsCode, /2025-01-01T00:00:00\.000Z/);
    assert.match(build.parameters.jsCode, /10 \* 60000/);
    assert.match(shopify.parameters.url, new RegExp(market.store));
    assert.equal(shopify.credentials.shopifyOAuth2Api.id, market.credential);
    assert.match(shopify.parameters.body, /updated_at:>=/);
    assert.match(shopify.parameters.body, /created_at:>=2025-01-01/);
    assert.doesNotMatch(shopify.parameters.body, /customer\s*\{|email|phone|billingAddress|shippingAddress/);
    assert.match(build.parameters.jsCode, new RegExp(`channel:'${market.channel}'`));
    assert.match(normalize.parameters.jsCode, /channel:\$json\.channel/);
    assert.match(normalize.parameters.jsCode, /customer_id:null, customer_display_name:null/);
    assert.match(checkpoint.parameters.body, /overlap_minutes:10/);
    assert.match(checkpoint.parameters.body, /schedule_hours:6/);
  }
});

test('order and product workflows enforce bounded cursor pagination, retries, throttling and success-only checkpoints', () => {
  for (const file of files.filter((name) => name.includes('orders') || name.includes('products'))) {
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

test('customer company workflow is a bounded six-hour London full sync with success-only finalization', () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(workflowDir, 'fb-dashboard-customer-company-directory.disabled.json'), 'utf8'));
  assert.equal(workflow.settings.timezone, 'Europe/London');
  assert.equal(workflow.meta.targetFolderId, 'BafBm52YFWfYw7sU');
  assert.equal(workflow.meta.shopDomain, 'jetchill-mixology.myshopify.com');
  const schedule = workflow.nodes.find((node) => node.name === 'Schedule - Every 6 Hours (London)');
  assert.ok(JSON.stringify(schedule.parameters).includes('0 0 */6 * * *'));
  const shopifyReads = workflow.nodes.filter((node) => node.name.startsWith('Shopify GraphQL'));
  assert.equal(shopifyReads.length, 2);
  for (const node of shopifyReads) {
    assert.equal(node.credentials.shopifyOAuth2Api.id, 'TOFvh8rHI1pD468B');
    assert.equal(node.retryOnFail, true);
    assert.equal(node.maxTries, 3);
  }
  const customerAdvance = workflow.nodes.find((node) => node.name === 'Advance Customer Cursor After Successful Writes');
  const companyAdvance = workflow.nodes.find((node) => node.name === 'Advance Company Cursor After Successful Writes');
  assert.match(customerAdvance.parameters.jsCode, /CUSTOMERS_PAGE_LIMIT_REACHED/);
  assert.match(companyAdvance.parameters.jsCode, /COMPANIES_PAGE_LIMIT_REACHED/);
  const finalizer = workflow.nodes.find((node) => node.name === 'Finalize Customer Company Soft Deletions [CREDENTIAL REQUIRED]');
  assert.match(finalizer.parameters.url, /fb_finalize_customer_company_sync/);
  const checkpoint = workflow.nodes.find((node) => node.name === 'Supabase Upsert Success Checkpoint [CREDENTIAL REQUIRED]');
  const checkpointParents = Object.entries(workflow.connections)
    .filter(([, outputs]) => JSON.stringify(outputs).includes(checkpoint.name))
    .map(([name]) => name);
  assert.deepEqual(checkpointParents, [finalizer.name]);
});

test('health workflow queries only columns present in the approved sync-state schema', () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(workflowDir, 'fb-dashboard-sync-health.disabled.json'), 'utf8'));
  const read = workflow.nodes.find((node) => node.name.startsWith('Read Supabase Sync State'));
  assert.match(read.parameters.url, /source_key/);
  assert.match(read.parameters.url, /last_success_at/);
  assert.doesNotMatch(read.parameters.url, /workflow_key|last_attempt_at|last_error/);
  const evaluate = workflow.nodes.find((node) => node.name === 'Evaluate Source Freshness');
  assert.match(evaluate.parameters.jsCode, /ga4_traffic/);
  assert.match(evaluate.parameters.jsCode, /const hour = 60 \* 60 \* 1000/);
  assert.match(evaluate.parameters.jsCode, /ga4_traffic', maxAgeMs: 12 \* hour/);
});
