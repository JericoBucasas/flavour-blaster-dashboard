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
    url: base + '/rest/v1/rpc/fb_dashboard_snapshot_v7',
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

function sanitizeSnapshot(input) {
  const payload = Array.isArray(input) ? input[0] : input;
  if (!payload || typeof payload !== 'object') throw new Error('Invalid Supabase snapshot response');
  const recentOrders = Array.isArray(payload.recentOrders) ? payload.recentOrders.map((order) => {
    const { shopify_order_id: _privateOrderId, ...safeOrder } = order;
    return {
      ...safeOrder,
      order_name: order.order_name ? '#••••' + String(order.order_name).replace(/\D/g, '').slice(-4) : 'Order',
      customer_display_name: order.channel === 'shopify_b2b' ? 'Wholesale account' : 'Customer',
    };
  }) : [];
  return { ...payload, recentOrders };
}

module.exports = { parseDate, buildSnapshotRequest, buildCatalogRequest, buildDirectoryRequest, sanitizeSnapshot };
