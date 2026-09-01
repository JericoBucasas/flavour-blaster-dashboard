'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROPERTY_ID = '298253309';
const SUPABASE_URL = 'https://hnmmlfelaezmijbbwzsg.supabase.co';
const GA_CREDENTIAL = {
  googleAnalyticsOAuth2: {
    id: 'FB_GA4_OAUTH_REQUIRED',
    name: 'Flavour Blaster GA4 contact@ [REQUIRED]',
  },
};
const SUPABASE_CREDENTIAL = {
  httpCustomAuth: {
    id: 'FB_SUPABASE_CUSTOM_REQUIRED',
    name: 'Flavour Blaster Supabase Service Role [REQUIRED]',
  },
};
const METRICS = [
  'sessions',
  'engagedSessions',
  'eventCount',
  'addToCarts',
  'checkouts',
  'ecommercePurchases',
  'purchaseRevenue',
];
const DIMENSIONS = [
  { type:'channel_group', field:'sessionDefaultChannelGroup', label:'sessionDefaultChannelGroup' },
  { type:'source_medium', field:'sessionSourceMedium', label:'sessionSourceMedium' },
  { type:'country', field:'countryId', label:'country', dimensions:['date', 'countryId', 'country'] },
  { type:'device', field:'deviceCategory', label:'deviceCategory' },
  { type:'landing_page', field:'landingPage', label:'landingPage' },
];

function position(x, y) { return [x, y]; }

function manualTrigger(x, y) {
  return { parameters:{}, id:'manual-trigger', name:'Manual Test Trigger', type:'n8n-nodes-base.manualTrigger', typeVersion:1, position:position(x, y) };
}

function scheduleTrigger(x, y) {
  return {
    parameters:{ rule:{ interval:[{ field:'cronExpression', expression:'0 20 */6 * * *' }] } },
    id:'ga4-schedule', name:'Schedule - Every 6 Hours at :20 (London)',
    type:'n8n-nodes-base.scheduleTrigger', typeVersion:1.2, position:position(x, y),
  };
}

function closedGate(x, y) {
  return {
    parameters:{ jsCode:"const DEVELOPMENT_GATE = false;\nif (!DEVELOPMENT_GATE) throw new Error('GA4_DEVELOPMENT_GATE_CLOSED');\nreturn $input.all();" },
    id:'closed-development-gate', name:'Closed Development Gate',
    type:'n8n-nodes-base.code', typeVersion:2, position:position(x, y),
  };
}

function gaReport(def, x, y) {
  // Every non-daily grain carries a country code so the dashboard's existing
  // region filter can be applied without joining independently aggregated
  // reports. The region is folded into dimension_key by the normalizer, then
  // identical labels are combined again after filtering in the browser.
  const dimensions = def.dimensions || ['date', 'countryId', def.field];
  return {
    parameters:{
      resource:'report', operation:'get', propertyType:'ga4',
      propertyId:{ mode:'id', value:PROPERTY_ID }, dateRange:'custom',
      startDate:"={{ $('Current GA4 Window').first().json.start + 'T00:00:00.000Z' }}",
      endDate:"={{ $('Current GA4 Window').first().json.end + 'T23:59:59.999Z' }}",
      metricsGA4:{ metricValues:METRICS.map((listName) => ({ listName })) },
      dimensionsGA4:{ dimensionValues:dimensions.map((listName) => ({ listName })) },
      returnAll:true, simple:true,
      additionalFields:{ currencyCode:'GBP', keepEmptyRows:true },
    },
    id:`ga4-report-${def.type}`, name:`GA4 Report | ${def.type}`,
    type:'n8n-nodes-base.googleAnalytics', typeVersion:2, position:position(x, y),
    retryOnFail:true, maxTries:3, waitBetweenTries:3000, credentials:GA_CREDENTIAL,
  };
}

function normalizerCode(def) {
  const common = `const window = $('Current GA4 Window').first().json;\nconst runAt = window.runStartedAt || new Date().toISOString();\nconst isoDay = value => { const s = String(value || ''); if (!/^\\d{8}$/.test(s)) throw new Error('GA4_DATE_INVALID:' + s); return s.slice(0,4) + '-' + s.slice(4,6) + '-' + s.slice(6,8); };\nconst num = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };\nconst metric = row => ({ sessions:Math.max(0, Math.round(num(row.sessions))), engaged_sessions:Math.max(0, Math.round(num(row.engagedSessions))), event_count:Math.max(0, Math.round(num(row.eventCount))), add_to_carts:Math.max(0, Math.round(num(row.addToCarts))), checkouts:Math.max(0, Math.round(num(row.checkouts))), ecommerce_purchases:Math.max(0, Math.round(num(row.ecommercePurchases))), purchase_revenue:num(row.purchaseRevenue), is_provisional:isoDay(row.date) === window.today, source_updated_at:runAt });`;
  if (def.type === 'daily') {
    return `${common}\nconst rows = $input.all().map(item => { const row = item.json; return { property_id:${PROPERTY_ID}, day:isoDay(row.date), currency_code:'GBP', ...metric(row) }; });\nreturn [{ json:{ ...window, dimensionType:'daily', rows } }];`;
  }
  const region = `\nconst eu = new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']);\nconst region = code => code === 'US' ? 'us' : code === 'GB' ? 'gb' : code === 'AU' ? 'aus' : eu.has(code) ? 'eur' : 'other';`;
  return `${common}${region}\nconst grouped = new Map();\nfor (const item of $input.all()) { const row = item.json; const regionCode = region(String(row.countryId || '').toUpperCase()); const rawKey = String(row.${def.field} || '(not set)').slice(0,1010); const label = String(row.${def.label} || rawKey || '(not set)').slice(0,1024); const current = { day:isoDay(row.date), dimension_key:regionCode + ':' + rawKey, dimension_label:label, region_code:regionCode, ...metric(row) }; const groupKey = current.day + '\\u0000' + current.dimension_key; const previous = grouped.get(groupKey); if (!previous) { grouped.set(groupKey, current); continue; } for (const field of ['sessions','engaged_sessions','event_count','add_to_carts','checkouts','ecommerce_purchases','purchase_revenue']) previous[field] += current[field]; previous.is_provisional = previous.is_provisional || current.is_provisional; }\nconst rows = Array.from(grouped.values());\nreturn [{ json:{ ...window, dimensionType:'${def.type}', rows } }];`;
}

function normalizeNode(def, x, y) {
  return {
    parameters:{ jsCode:normalizerCode(def) }, id:`normalize-${def.type}`,
    name:`Normalize GA4 | ${def.type}`, type:'n8n-nodes-base.code', typeVersion:2,
    position:position(x, y),
  };
}

function supabaseWrite(def, x, y) {
  const daily = def.type === 'daily';
  return {
    parameters:{
      method:'POST',
      url:`${SUPABASE_URL}/rest/v1/rpc/${daily ? 'fb_ga4_upsert_daily' : 'fb_ga4_replace_dimensions'}`,
      authentication:'genericCredentialType', genericAuthType:'httpCustomAuth',
      sendHeaders:true,
      headerParameters:{ parameters:[
        { name:'Prefer', value:'return=representation' },
        { name:'User-Agent', value:'FlavourBlasterDashboard-n8n/1.0' },
      ] },
      sendBody:true, contentType:'raw', rawContentType:'application/json',
      body:daily
        ? '={{ JSON.stringify({ p_rows:$json.rows }) }}'
        : `={{ JSON.stringify({ p_property_id:${PROPERTY_ID}, p_start:$json.start, p_end:$json.end, p_dimension_type:'${def.type}', p_rows:$json.rows }) }}`,
      options:{ timeout:120000 },
    },
    id:`supabase-upsert-${def.type}`, name:`Supabase Upsert GA4 ${def.type} [CREDENTIAL REQUIRED]`,
    type:'n8n-nodes-base.httpRequest', typeVersion:4.2, position:position(x, y),
    alwaysOutputData:true, retryOnFail:true, maxTries:3, waitBetweenTries:3000,
    credentials:SUPABASE_CREDENTIAL,
  };
}

function checkpoint(sourceKey, cursorExpression, metadataExpression, x, y) {
  return {
    parameters:{
      method:'POST', url:`${SUPABASE_URL}/rest/v1/fb_sync_state?on_conflict=source_key`,
      authentication:'genericCredentialType', genericAuthType:'httpCustomAuth', sendHeaders:true,
      headerParameters:{ parameters:[
        { name:'Prefer', value:'resolution=merge-duplicates,return=minimal' },
        { name:'User-Agent', value:'FlavourBlasterDashboard-n8n/1.0' },
      ] },
      sendBody:true, contentType:'raw', rawContentType:'application/json',
      body:`={{ JSON.stringify({ source_key:'${sourceKey}', cursor_updated_at:${cursorExpression}, last_success_at:new Date().toISOString(), metadata:${metadataExpression} }) }}`,
      options:{ timeout:30000 },
    },
    id:`${sourceKey}-checkpoint`, name:'Supabase Upsert GA4 Success Checkpoint [CREDENTIAL REQUIRED]',
    type:'n8n-nodes-base.httpRequest', typeVersion:4.2, position:position(x, y),
    alwaysOutputData:true, retryOnFail:true, maxTries:3, waitBetweenTries:3000,
    credentials:SUPABASE_CREDENTIAL,
  };
}

function sticky(content) {
  return { parameters:{ content, height:320, width:520 }, id:'workflow-note', name:'Implementation Notes', type:'n8n-nodes-base.stickyNote', typeVersion:1, position:position(-760, -260) };
}

function addConnection(connections, from, to, output = 0) {
  if (!connections[from]) connections[from] = { main:[] };
  while (connections[from].main.length <= output) connections[from].main.push([]);
  connections[from].main[output].push({ node:to, type:'main', index:0 });
}

function appendReportChain(nodes, connections, previous, startX, startY) {
  const defs = [{ type:'daily', dimensions:['date'] }, ...DIMENSIONS];
  let x = startX;
  for (const def of defs) {
    const report = gaReport(def, x, startY);
    const normalize = normalizeNode(def, x + 240, startY);
    const write = supabaseWrite(def, x + 480, startY);
    nodes.push(report, normalize, write);
    addConnection(connections, previous, report.name);
    addConnection(connections, report.name, normalize.name);
    addConnection(connections, normalize.name, write.name);
    previous = write.name;
    x += 720;
  }
  return { previous, x };
}

function incrementalWorkflow() {
  const nodes = [
    sticky('## GA4 TRAFFIC INCREMENTAL\nDisabled source-controlled template. After the contact@ read-only GA4 credential is connected and the bounded verification passes, import a production copy named **FB Dashboard | GA4 Traffic Incremental [LIVE]**. The live copy runs every six hours at :20 London time, re-reads today plus three prior days, replaces each dimension grain transactionally, and advances the checkpoint only after every write succeeds.'),
    scheduleTrigger(-660, 80), manualTrigger(-660, 220), closedGate(-430, 140),
    {
      parameters:{ jsCode:"const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB',{ timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));\nconst today = `${parts.year}-${parts.month}-${parts.day}`;\nconst endMs = Date.parse(today + 'T00:00:00Z');\nconst start = new Date(endMs - 3 * 86400000).toISOString().slice(0,10);\nreturn [{ json:{ propertyId:298253309, start, end:today, today, runStartedAt:new Date().toISOString(), scheduleTimezone:'Europe/London', overlapDays:3 } }];" },
      id:'current-ga4-window', name:'Current GA4 Window', type:'n8n-nodes-base.code', typeVersion:2, position:position(-180, 140),
    },
  ];
  const connections = {};
  addConnection(connections, 'Schedule - Every 6 Hours at :20 (London)', 'Closed Development Gate');
  addConnection(connections, 'Manual Test Trigger', 'Closed Development Gate');
  addConnection(connections, 'Closed Development Gate', 'Current GA4 Window');
  const chain = appendReportChain(nodes, connections, 'Current GA4 Window', 80, 140);
  const cp = checkpoint(
    'ga4_traffic',
    "$('Current GA4 Window').first().json.end + 'T23:59:59.999Z'",
    "{ property_id:298253309, schedule_hours:6, schedule_timezone:'Europe/London', overlap_days:3, currency_code:'GBP', aggregate_only:true, provisional_through:$('Current GA4 Window').first().json.today }",
    chain.x, 140,
  );
  nodes.push(cp);
  addConnection(connections, chain.previous, cp.name);
  return {
    name:'FB Dashboard | GA4 Traffic Incremental [DISABLED]', nodes, connections,
    active:false, settings:{ executionOrder:'v1', timezone:'Europe/London', saveDataErrorExecution:'all', saveDataSuccessExecution:'none' },
    meta:{ templateCredsSetupCompleted:false, propertyId:PROPERTY_ID, measurementId:'G-M13HXTD6NW', scheduleHours:6, scheduleMinute:20, overlapDays:3, aggregateOnly:true },
    pinData:{}, versionId:'fb-ga4-incremental-disabled-v1', tags:[],
  };
}

function backfillWorkflow() {
  const nodes = [
    sticky('## GA4 HISTORICAL BACKFILL\nManual and disabled. Iterates one calendar month at a time from 2025-01-01 through yesterday in Europe/London. Each month completes all six GA4 report grains and Supabase writes before the window advances. The workflow never activates on a schedule.'),
    manualTrigger(-660, 140), closedGate(-430, 140),
    {
      parameters:{ jsCode:"const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB',{ timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));\nconst today = `${parts.year}-${parts.month}-${parts.day}`;\nconst yesterday = new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0,10);\nconst start = '2025-01-01';\nconst monthEnd = new Date(Date.UTC(2025,1,0)).toISOString().slice(0,10);\nreturn [{ json:{ propertyId:298253309, start, end:monthEnd < yesterday ? monthEnd : yesterday, finalEnd:yesterday, today, runStartedAt:new Date().toISOString(), monthsCompleted:0 } }];" },
      id:'initialize-backfill', name:'Initialize Monthly Backfill', type:'n8n-nodes-base.code', typeVersion:2, position:position(-180, 140),
    },
    {
      parameters:{ jsCode:"return $input.all();" }, id:'current-ga4-window', name:'Current GA4 Window',
      type:'n8n-nodes-base.code', typeVersion:2, position:position(40, 140),
    },
  ];
  const connections = {};
  addConnection(connections, 'Manual Test Trigger', 'Closed Development Gate');
  addConnection(connections, 'Closed Development Gate', 'Initialize Monthly Backfill');
  addConnection(connections, 'Initialize Monthly Backfill', 'Current GA4 Window');
  const chain = appendReportChain(nodes, connections, 'Current GA4 Window', 300, 140);
  const advance = {
    parameters:{ jsCode:"const w = $('Current GA4 Window').first().json;\nconst nextMs = Date.parse(w.end + 'T00:00:00Z') + 86400000;\nconst nextStart = new Date(nextMs).toISOString().slice(0,10);\nconst d = new Date(nextMs);\nconst monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0,10);\nconst hasMore = nextStart <= w.finalEnd;\nreturn [{ json:{ ...w, start:nextStart, end:monthEnd < w.finalEnd ? monthEnd : w.finalEnd, monthsCompleted:Number(w.monthsCompleted || 0) + 1, continue:hasMore } }];" },
    id:'advance-backfill', name:'Advance Monthly Window After Successful Writes', type:'n8n-nodes-base.code', typeVersion:2, position:position(chain.x, 140),
  };
  const more = {
    parameters:{ conditions:{ options:{ caseSensitive:true, leftValue:'', typeValidation:'strict', version:2 }, conditions:[{ id:'ga4-backfill-more', leftValue:'={{ $json.continue }}', rightValue:true, operator:{ type:'boolean', operation:'true', singleValue:true } }], combinator:'and' }, options:{} },
    id:'more-backfill', name:'More Monthly Windows?', type:'n8n-nodes-base.if', typeVersion:2.2, position:position(chain.x + 240, 140),
  };
  const pause = { parameters:{ amount:2, unit:'seconds' }, id:'backfill-pause', name:'GA4 Backfill Rate Limit Pause', type:'n8n-nodes-base.wait', typeVersion:1.1, position:position(chain.x + 500, 40), webhookId:'ga4-backfill-rate-limit' };
  const cp = checkpoint(
    'ga4_traffic_backfill',
    "$('Advance Monthly Window After Successful Writes').first().json.finalEnd + 'T23:59:59.999Z'",
    "{ property_id:298253309, historical_floor:'2025-01-01', historical_end:$('Advance Monthly Window After Successful Writes').first().json.finalEnd, window:'calendar_month', currency_code:'GBP', aggregate_only:true, months_completed:$('Advance Monthly Window After Successful Writes').first().json.monthsCompleted }",
    chain.x + 500, 260,
  );
  nodes.push(advance, more, pause, cp);
  addConnection(connections, chain.previous, advance.name);
  addConnection(connections, advance.name, more.name);
  addConnection(connections, more.name, pause.name, 0);
  addConnection(connections, more.name, cp.name, 1);
  addConnection(connections, pause.name, 'Current GA4 Window');
  return {
    name:'FB Dashboard | GA4 Historical Backfill [MANUAL - DISABLED]', nodes, connections,
    active:false, settings:{ executionOrder:'v1', timezone:'Europe/London', saveDataErrorExecution:'all', saveDataSuccessExecution:'none' },
    meta:{ templateCredsSetupCompleted:false, propertyId:PROPERTY_ID, measurementId:'G-M13HXTD6NW', historicalFloor:'2025-01-01', window:'calendar_month', aggregateOnly:true },
    pinData:{}, versionId:'fb-ga4-backfill-disabled-v1', tags:[],
  };
}

for (const [file, workflow] of [
  ['fb-dashboard-ga4-traffic-incremental.disabled.json', incrementalWorkflow()],
  ['fb-dashboard-ga4-historical-backfill.disabled.json', backfillWorkflow()],
]) {
  fs.writeFileSync(path.join(__dirname, file), `${JSON.stringify(workflow, null, 2)}\n`);
}
