'use strict';

const {
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
} = require('../lib/dashboard-request');

module.exports = async function dashboard(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ status: 'error', code: 'METHOD_NOT_ALLOWED' });
  }

  const today = new Date().toISOString().slice(0, 10);
  let start;
  let end;
  try {
    start = parseDate(req.query && req.query.start, '2025-01-01');
    end = parseDate(req.query && req.query.end, today);
  } catch (_error) {
    return res.status(400).json({ status: 'error', code: 'INVALID_DATE' });
  }
  if (start > end) return res.status(400).json({ status: 'error', code: 'INVALID_RANGE' });

  const section = String(req.query && req.query.section || 'overview').toLowerCase();
  const validSections = new Set(['all', 'overview', 'finance', 'traffic', 'channels', 'regions', 'orders', 'products', 'customers', 'ads', 'settings']);
  if (!validSections.has(section)) return res.status(400).json({ status: 'error', code: 'INVALID_SECTION' });
  const needsCatalog = section === 'all' || section === 'products';
  const needsDirectory = section === 'all' || section === 'customers';
  const needsTraffic = section === 'all' || section === 'overview' || section === 'traffic';
  const needsAds = section === 'all' || section === 'overview' || section === 'finance' || section === 'ads';

  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  let request;
  let catalogRequest = null;
  let directoryRequest = null;
  let trafficRequest = null;
  let adsRequest = null;
  try {
    request = buildSnapshotRequest(process.env.SUPABASE_URL, secretKey, start, end);
    if (needsCatalog) catalogRequest = buildCatalogRequest(process.env.SUPABASE_URL, secretKey);
    if (needsDirectory) directoryRequest = buildDirectoryRequest(process.env.SUPABASE_URL, secretKey, 500);
    if (needsTraffic) trafficRequest = buildTrafficRequest(process.env.SUPABASE_URL, secretKey, start, end);
    if (needsAds) adsRequest = buildAdsRequest(process.env.SUPABASE_URL, secretKey, start, end);
  } catch (_error) {
    return res.status(503).json({ status: 'unavailable', code: 'DATASTORE_NOT_CONFIGURED' });
  }

  try {
    const upstreams = [{ name:'snapshot', request }];
    if (catalogRequest) upstreams.push({ name:'catalog', request:catalogRequest });
    if (directoryRequest) upstreams.push({ name:'directory', request:directoryRequest });
    if (trafficRequest) upstreams.push({ name:'traffic', request:trafficRequest });
    if (adsRequest) upstreams.push({ name:'ads', request:adsRequest });
    const results = await Promise.all(upstreams.map(async ({ name, request:upstream }) => {
      try {
        const response = await fetch(upstream.url, upstream.options);
        return { name, response, body:await response.json().catch(() => null), error:null };
      } catch (error) {
        return { name, response:null, body:null, error };
      }
    }));
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if ((result.response && result.response.ok) || result.name === 'traffic' || result.name === 'ads') continue;
      console.error('[api/dashboard] Supabase RPC failed', {
        source:result.name,
        status:result.response ? result.response.status : 'network_error',
      });
      return res.status(502).json({ status:'error', code:'DATASTORE_QUERY_FAILED' });
    }
    const responseByName = Object.fromEntries(results.map((result) => [result.name, result]));
    const data = sanitizeSnapshot(responseByName.snapshot.body);
    let productCatalog;
    if (needsCatalog) {
      const catalogBody = responseByName.catalog.body;
      productCatalog = Array.isArray(catalogBody) ? catalogBody[0] : catalogBody;
      if (!productCatalog || typeof productCatalog !== 'object' || !Array.isArray(productCatalog.products)) {
        return res.status(502).json({ status: 'error', code: 'PRODUCT_CATALOG_INVALID' });
      }
    }
    let boundedCustomerDirectory;
    if (needsDirectory) {
      const directoryBody = responseByName.directory.body;
      const customerDirectory = Array.isArray(directoryBody) ? directoryBody[0] : directoryBody;
      if (!customerDirectory || typeof customerDirectory !== 'object' || !Array.isArray(customerDirectory.customers)
        || !Array.isArray(customerDirectory.companies) || !Array.isArray(customerDirectory.locations)) {
        return res.status(502).json({ status: 'error', code: 'CUSTOMER_DIRECTORY_INVALID' });
      }
      boundedCustomerDirectory = customerDirectory;
    }
    const responseData = { ...data };
    if (productCatalog) responseData.productCatalog = productCatalog;
    if (boundedCustomerDirectory) responseData.customerDirectory = boundedCustomerDirectory;
    if (needsTraffic) {
      const trafficUpstream = responseByName.traffic;
      if (!trafficUpstream.response || !trafficUpstream.response.ok) {
        console.error('[api/dashboard] GA4 Supabase RPC unavailable', { status:trafficUpstream.response ? trafficUpstream.response.status : 'network_error' });
        responseData.traffic = unavailableTraffic('GA4_DATASTORE_QUERY_FAILED');
      } else {
        try {
          responseData.traffic = sanitizeTraffic(trafficUpstream.body);
        } catch (_error) {
          responseData.traffic = unavailableTraffic('GA4_PAYLOAD_INVALID');
        }
      }
    }
    if (needsAds) {
      const adsUpstream = responseByName.ads;
      if (!adsUpstream.response || !adsUpstream.response.ok) {
        console.error('[api/dashboard] Google Ads Supabase RPC unavailable', { status:adsUpstream.response ? adsUpstream.response.status : 'network_error' });
        responseData.ads = unavailableAds('GOOGLE_ADS_DATASTORE_QUERY_FAILED');
      } else {
        try {
          responseData.ads = sanitizeAds(adsUpstream.body);
        } catch (_error) {
          responseData.ads = unavailableAds('GOOGLE_ADS_PAYLOAD_INVALID');
        }
      }
    }
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.status(200).json({ status: 'live', data:responseData });
  } catch (error) {
    console.error('[api/dashboard] Datastore request failed', {
      message: error && error.message ? error.message : String(error),
    });
    return res.status(502).json({ status: 'error', code: 'DATASTORE_UNREACHABLE' });
  }
};
