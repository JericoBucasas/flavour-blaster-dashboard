'use strict';

const { parseDate, buildSnapshotRequest, buildCatalogRequest, sanitizeSnapshot } = require('../lib/dashboard-request');

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

  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  let request;
  let catalogRequest;
  try {
    request = buildSnapshotRequest(process.env.SUPABASE_URL, secretKey, start, end);
    catalogRequest = buildCatalogRequest(process.env.SUPABASE_URL, secretKey);
  } catch (_error) {
    return res.status(503).json({ status: 'unavailable', code: 'DATASTORE_NOT_CONFIGURED' });
  }

  try {
    const [upstream, catalogUpstream] = await Promise.all([
      fetch(request.url, request.options),
      fetch(catalogRequest.url, catalogRequest.options),
    ]);
    const [body, catalogBody] = await Promise.all([
      upstream.json().catch(() => null),
      catalogUpstream.json().catch(() => null),
    ]);
    if (!upstream.ok || !catalogUpstream.ok) {
      return res.status(502).json({ status: 'error', code: 'DATASTORE_QUERY_FAILED' });
    }
    const data = sanitizeSnapshot(body);
    const productCatalog = Array.isArray(catalogBody) ? catalogBody[0] : catalogBody;
    if (!productCatalog || typeof productCatalog !== 'object' || !Array.isArray(productCatalog.products)) {
      return res.status(502).json({ status: 'error', code: 'PRODUCT_CATALOG_INVALID' });
    }
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ status: 'live', data:{ ...data, productCatalog } });
  } catch (_error) {
    return res.status(502).json({ status: 'error', code: 'DATASTORE_UNREACHABLE' });
  }
};
