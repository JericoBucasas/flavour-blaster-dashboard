'use strict';

const { parseDate, buildSnapshotRequest, buildCatalogRequest, buildDirectoryRequest, sanitizeSnapshot } = require('../lib/dashboard-request');

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
  let directoryRequest;
  try {
    request = buildSnapshotRequest(process.env.SUPABASE_URL, secretKey, start, end);
    catalogRequest = buildCatalogRequest(process.env.SUPABASE_URL, secretKey);
    directoryRequest = buildDirectoryRequest(process.env.SUPABASE_URL, secretKey);
  } catch (_error) {
    return res.status(503).json({ status: 'unavailable', code: 'DATASTORE_NOT_CONFIGURED' });
  }

  try {
    const [upstream, catalogUpstream, directoryUpstream] = await Promise.all([
      fetch(request.url, request.options),
      fetch(catalogRequest.url, catalogRequest.options),
      fetch(directoryRequest.url, directoryRequest.options),
    ]);
    const [body, catalogBody, directoryBody] = await Promise.all([
      upstream.json().catch(() => null),
      catalogUpstream.json().catch(() => null),
      directoryUpstream.json().catch(() => null),
    ]);
    if (!upstream.ok || !catalogUpstream.ok || !directoryUpstream.ok) {
      return res.status(502).json({ status: 'error', code: 'DATASTORE_QUERY_FAILED' });
    }
    const data = sanitizeSnapshot(body);
    const productCatalog = Array.isArray(catalogBody) ? catalogBody[0] : catalogBody;
    if (!productCatalog || typeof productCatalog !== 'object' || !Array.isArray(productCatalog.products)) {
      return res.status(502).json({ status: 'error', code: 'PRODUCT_CATALOG_INVALID' });
    }
    const customerDirectory = Array.isArray(directoryBody) ? directoryBody[0] : directoryBody;
    if (!customerDirectory || typeof customerDirectory !== 'object' || !Array.isArray(customerDirectory.customers)
      || !Array.isArray(customerDirectory.companies) || !Array.isArray(customerDirectory.locations)) {
      return res.status(502).json({ status: 'error', code: 'CUSTOMER_DIRECTORY_INVALID' });
    }
    // Keep the complete directory in Supabase, but do not push tens of thousands of
    // records into one browser render. The summary retains the complete counts while
    // the dashboard receives a representative, usable first page for each directory.
    const directoryPageSize = 500;
    const boundedCustomerDirectory = {
      ...customerDirectory,
      customers: customerDirectory.customers.slice(0, directoryPageSize),
      companies: customerDirectory.companies.slice(0, directoryPageSize),
      locations: customerDirectory.locations.slice(0, directoryPageSize),
      pageInfo: {
        pageSize: directoryPageSize,
        customersReturned: Math.min(customerDirectory.customers.length, directoryPageSize),
        companiesReturned: Math.min(customerDirectory.companies.length, directoryPageSize),
        locationsReturned: Math.min(customerDirectory.locations.length, directoryPageSize),
        customersTotal: Number(customerDirectory.summary && customerDirectory.summary.customers) || customerDirectory.customers.length,
        companiesTotal: Number(customerDirectory.summary && customerDirectory.summary.companies) || customerDirectory.companies.length,
        locationsTotal: Number(customerDirectory.summary && customerDirectory.summary.locations) || customerDirectory.locations.length,
      },
    };
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ status: 'live', data:{ ...data, productCatalog, customerDirectory: boundedCustomerDirectory } });
  } catch (_error) {
    return res.status(502).json({ status: 'error', code: 'DATASTORE_UNREACHABLE' });
  }
};
