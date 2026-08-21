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

  const section = String(req.query && req.query.section || 'all').toLowerCase();
  const validSections = new Set(['all', 'overview', 'channels', 'regions', 'orders', 'products', 'customers', 'ads', 'settings']);
  if (!validSections.has(section)) return res.status(400).json({ status: 'error', code: 'INVALID_SECTION' });
  const needsCatalog = section === 'all' || section === 'products';
  const needsDirectory = section === 'all' || section === 'customers';

  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  let request;
  let catalogRequest = null;
  let directoryRequest = null;
  try {
    request = buildSnapshotRequest(process.env.SUPABASE_URL, secretKey, start, end);
    if (needsCatalog) catalogRequest = buildCatalogRequest(process.env.SUPABASE_URL, secretKey);
    if (needsDirectory) directoryRequest = buildDirectoryRequest(process.env.SUPABASE_URL, secretKey);
  } catch (_error) {
    return res.status(503).json({ status: 'unavailable', code: 'DATASTORE_NOT_CONFIGURED' });
  }

  try {
    const requests = [fetch(request.url, request.options)];
    if (catalogRequest) requests.push(fetch(catalogRequest.url, catalogRequest.options));
    if (directoryRequest) requests.push(fetch(directoryRequest.url, directoryRequest.options));
    const responses = await Promise.all(requests);
    const bodies = await Promise.all(responses.map((upstream) => upstream.json().catch(() => null)));
    if (responses.some((upstream) => !upstream.ok)) {
      return res.status(502).json({ status: 'error', code: 'DATASTORE_QUERY_FAILED' });
    }
    const body = bodies[0];
    let bodyIndex = 1;
    const catalogBody = needsCatalog ? bodies[bodyIndex++] : null;
    const directoryBody = needsDirectory ? bodies[bodyIndex++] : null;
    const data = sanitizeSnapshot(body);
    let productCatalog;
    if (needsCatalog) {
      productCatalog = Array.isArray(catalogBody) ? catalogBody[0] : catalogBody;
      if (!productCatalog || typeof productCatalog !== 'object' || !Array.isArray(productCatalog.products)) {
        return res.status(502).json({ status: 'error', code: 'PRODUCT_CATALOG_INVALID' });
      }
    }
    let boundedCustomerDirectory;
    if (needsDirectory) {
      const customerDirectory = Array.isArray(directoryBody) ? directoryBody[0] : directoryBody;
      if (!customerDirectory || typeof customerDirectory !== 'object' || !Array.isArray(customerDirectory.customers)
        || !Array.isArray(customerDirectory.companies) || !Array.isArray(customerDirectory.locations)) {
        return res.status(502).json({ status: 'error', code: 'CUSTOMER_DIRECTORY_INVALID' });
      }
      // Keep the complete directory in Supabase, but do not push tens of thousands of
      // records into one browser render. The summary retains the complete counts while
      // the dashboard receives a representative, usable first page for each directory.
      const directoryPageSize = 500;
      boundedCustomerDirectory = {
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
    }
    const responseData = { ...data };
    if (productCatalog) responseData.productCatalog = productCatalog;
    if (boundedCustomerDirectory) responseData.customerDirectory = boundedCustomerDirectory;
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ status: 'live', data:responseData });
  } catch (_error) {
    return res.status(502).json({ status: 'error', code: 'DATASTORE_UNREACHABLE' });
  }
};
