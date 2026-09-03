'use strict';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value, fallback) {
  const candidate = typeof value === 'string' && ISO_DATE.test(value) ? value : fallback;
  const timestamp = Date.parse(candidate + 'T00:00:00Z');
  if (!Number.isFinite(timestamp)) throw new Error('Invalid dashboard date');
  return candidate;
}

function buildSnapshotRequest(url, secretKey, start, end) {
  const base = String(url || '').replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)) {
    throw new Error('SUPABASE_URL is missing or invalid');
  }
  if (!secretKey) throw new Error('SUPABASE_SECRET_KEY is missing');
  return {
    url: base + '/rest/v1/rpc/fb_dashboard_snapshot_v8',
    options: {
      method: 'POST',
      headers: {
        apikey: secretKey,
        'User-Agent': 'FlavourBlasterDashboard-Vercel/1.0',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ p_start: start, p_end: end }),
    },
  };
}

function buildCatalogRequest(url, secretKey) {
  const base = String(url || '').replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)) {
    throw new Error('SUPABASE_URL is missing or invalid');
  }
  if (!secretKey) throw new Error('SUPABASE_SECRET_KEY is missing');
  return {
    url: base + '/rest/v1/rpc/fb_product_catalog',
    options: {
      method: 'POST',
      headers: {
        apikey: secretKey,
        'User-Agent': 'FlavourBlasterDashboard-Vercel/1.0',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: '{}',
    },
  };
}

function buildDirectoryRequest(url, secretKey, pageSize = 500) {
  const base = String(url || '').replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)) {
    throw new Error('SUPABASE_URL is missing or invalid');
  }
  if (!secretKey) throw new Error('SUPABASE_SECRET_KEY is missing');
  const boundedPageSize = Math.max(1, Math.min(500, Math.trunc(Number(pageSize) || 500)));
  return {
    url: base + '/rest/v1/rpc/fb_customer_company_directory_page',
    options: {
      method: 'POST',
      headers: {
        apikey: secretKey,
        'User-Agent': 'FlavourBlasterDashboard-Vercel/1.0',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ p_limit: boundedPageSize }),
    },
  };
}

function buildTrafficRequest(url, secretKey, start, end) {
  const base = String(url || '').replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)) {
    throw new Error('SUPABASE_URL is missing or invalid');
  }
  if (!secretKey) throw new Error('SUPABASE_SECRET_KEY is missing');
  return {
    url: base + '/rest/v1/rpc/fb_ga4_dashboard_snapshot',
    options: {
      method: 'POST',
      headers: {
        apikey: secretKey,
        'User-Agent': 'FlavourBlasterDashboard-Vercel/1.0',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ p_start: start, p_end: end }),
    },
  };
}

function buildAdsRequest(url, secretKey, start, end) {
  const base = String(url || '').replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)) {
    throw new Error('SUPABASE_URL is missing or invalid');
  }
  if (!secretKey) throw new Error('SUPABASE_SECRET_KEY is missing');
  return {
    url: base + '/rest/v1/rpc/fb_google_ads_dashboard_snapshot',
    options: {
      method: 'POST',
      headers: {
        apikey: secretKey,
        'User-Agent': 'FlavourBlasterDashboard-Vercel/1.0',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ p_start: start, p_end: end }),
    },
  };
}

function sanitizeSnapshot(input) {
  const payload = Array.isArray(input) ? input[0] : input;
  if (!payload || typeof payload !== 'object') throw new Error('Invalid Supabase snapshot response');
  const recentOrders = Array.isArray(payload.recentOrders) ? payload.recentOrders.map((order) => {
    const { shopify_order_id: _privateOrderId, ...safeOrder } = order;
    return {
      ...safeOrder,
      order_name: order.order_name ? String(order.order_name).trim() : 'Order',
      customer_display_name: order.customer_display_name
        ? String(order.customer_display_name).trim()
        : order.channel === 'amazon_us' || order.channel === 'amazon_uk'
          ? 'Amazon customer'
          : 'Guest',
    };
  }) : [];
  return { ...payload, recentOrders };
}

function unavailableTraffic(code = 'GA4_DATA_UNAVAILABLE') {
  return {
    status:'unavailable', code, coverageStart:null, coverageEnd:null,
    lastSuccessAt:null, provisionalThrough:null, daily:[], channelGroups:[],
    sourceMedium:[], countries:[], devices:[], landingPages:[],
  };
}

function sanitizeTraffic(input) {
  const payload = Array.isArray(input) ? input[0] : input;
  if (!payload || typeof payload !== 'object') throw new Error('Invalid GA4 snapshot response');
  const arrayKeys = ['daily', 'channelGroups', 'sourceMedium', 'countries', 'devices', 'landingPages'];
  for (const key of arrayKeys) {
    if (!Array.isArray(payload[key])) throw new Error('Invalid GA4 snapshot response');
  }
  const status = ['live', 'stale', 'unavailable'].includes(payload.status) ? payload.status : 'unavailable';
  const bounded = (rows) => rows.map((row) => {
    if (!row || typeof row !== 'object') return null;
    const safe = { ...row };
    if ('key' in safe) safe.key = String(safe.key || '(not set)').slice(0, 1024);
    if ('label' in safe) safe.label = String(safe.label || safe.key || '(not set)').slice(0, 1024);
    return safe;
  }).filter(Boolean);
  return {
    propertyId:Number(payload.propertyId) || 298253309,
    status,
    coverageStart:payload.coverageStart || null,
    coverageEnd:payload.coverageEnd || null,
    lastSuccessAt:payload.lastSuccessAt || null,
    provisionalThrough:payload.provisionalThrough || null,
    generatedAt:payload.generatedAt || null,
    daily:bounded(payload.daily),
    channelGroups:bounded(payload.channelGroups),
    sourceMedium:bounded(payload.sourceMedium),
    countries:bounded(payload.countries),
    devices:bounded(payload.devices),
    landingPages:bounded(payload.landingPages),
  };
}

function unavailableAds(code = 'GOOGLE_ADS_DATA_UNAVAILABLE') {
  return {
    customerId:'9329387049', currencyCode:'GBP', timeZone:'Europe/London',
    status:'unavailable', code, coverageStart:null, coverageEnd:null,
    lastSuccessAt:null, provisionalThrough:null, generatedAt:null,
    rangeComplete:false, backfillComplete:false, geoComplete:false,
    geographyReason:'Google Ads geography is unavailable', dailyTotals:[],
    dailyRegions:[], campaigns:[], campaignRegions:[],
  };
}

function sanitizeAds(input) {
  const payload = Array.isArray(input) ? input[0] : input;
  if (!payload || typeof payload !== 'object') throw new Error('Invalid Google Ads snapshot response');
  if (String(payload.customerId || '') !== '9329387049'
    || payload.currencyCode !== 'GBP' || payload.timeZone !== 'Europe/London') {
    throw new Error('Invalid Google Ads account metadata');
  }
  const arrayKeys = ['dailyTotals', 'dailyRegions', 'campaigns', 'campaignRegions'];
  for (const key of arrayKeys) {
    if (!Array.isArray(payload[key])) throw new Error('Invalid Google Ads snapshot response');
  }
  const status = ['live', 'stale', 'unavailable'].includes(payload.status) ? payload.status : 'unavailable';
  const number = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Invalid Google Ads metric');
    return parsed;
  };
  const day = (value) => {
    const text = String(value || '');
    const parsed = Date.parse(text + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(parsed)
      || new Date(parsed).toISOString().slice(0, 10) !== text) {
      throw new Error('Invalid Google Ads date');
    }
    return text;
  };
  const region = (value) => {
    const text = String(value || '');
    if (!['us', 'gb', 'eur', 'aus', 'other'].includes(text)) throw new Error('Invalid Google Ads region');
    return text;
  };
  const campaignId = (value) => {
    const text = String(value || '');
    if (!/^[0-9]+$/.test(text)) throw new Error('Invalid Google Ads campaign');
    return text;
  };
  const metrics = (row) => ({
    cost:number(row.cost), impressions:number(row.impressions), clicks:number(row.clicks),
    conversions:number(row.conversions), conversionValue:number(row.conversionValue),
  });
  const dailyTotals = payload.dailyTotals.map((row) => ({
    day:day(row.day), ...metrics(row), isProvisional:!!row.isProvisional,
  }));
  const dailyRegions = payload.dailyRegions.map((row) => ({
    day:day(row.day), regionCode:region(row.regionCode),
    ...metrics(row), isProvisional:!!row.isProvisional,
  }));
  const campaigns = payload.campaigns.map((row) => ({
    day:day(row.day), campaignId:campaignId(row.campaignId), campaignName:String(row.campaignName || '').slice(0, 1024),
    campaignStatus:String(row.campaignStatus || 'UNKNOWN').slice(0, 64),
    channelType:String(row.channelType || 'UNSPECIFIED').slice(0, 64),
    channelSubtype:String(row.channelSubtype || 'UNSPECIFIED').slice(0, 64),
    ...metrics(row),
  }));
  const campaignRegions = payload.campaignRegions.map((row) => ({
    day:day(row.day), campaignId:campaignId(row.campaignId), regionCode:region(row.regionCode),
    ...metrics(row),
  }));
  return {
    customerId:'9329387049', currencyCode:'GBP', timeZone:'Europe/London', status,
    coverageStart:payload.coverageStart || null, coverageEnd:payload.coverageEnd || null,
    lastSuccessAt:payload.lastSuccessAt || null,
    provisionalThrough:payload.provisionalThrough || null,
    generatedAt:payload.generatedAt || null, rangeComplete:!!payload.rangeComplete,
    backfillComplete:!!payload.backfillComplete, geoComplete:!!payload.geoComplete,
    geographyReason:payload.geographyReason ? String(payload.geographyReason).slice(0, 240) : null,
    dailyTotals, dailyRegions, campaigns, campaignRegions,
  };
}

module.exports = {
  parseDate,
  buildSnapshotRequest,
  buildCatalogRequest,
  buildDirectoryRequest,
  buildTrafficRequest,
  buildAdsRequest,
  sanitizeSnapshot,
  sanitizeTraffic,
  unavailableTraffic,
  sanitizeAds,
  unavailableAds,
};
