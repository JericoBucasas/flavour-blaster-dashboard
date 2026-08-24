-- Return a bounded, dashboard-safe directory page while preserving complete totals.
-- The original zero-argument function remains available for internal audits.

create or replace function public.fb_customer_company_directory_page(p_limit integer default 500)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select greatest(1, least(coalesce(p_limit, 500), 500)) as row_limit
  ),
  customer_page as (
    select c.*
    from public.fb_customers c
    where not c.is_deleted
    order by c.last_order_at desc nulls last, c.display_name
    limit (select row_limit from params)
  ),
  company_page as (
    select c.*
    from public.fb_companies c
    where not c.is_deleted
    order by c.total_spent desc, c.name
    limit (select row_limit from params)
  ),
  location_page as (
    select l.*, c.name as company_name
    from public.fb_company_locations l
    join public.fb_companies c on c.shopify_company_id = l.shopify_company_id
    where not l.is_deleted and not c.is_deleted
    order by l.total_spent desc, l.name
    limit (select row_limit from params)
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'lastSyncedAt', greatest(
      coalesce((select max(c.synced_at) from public.fb_customers c where not c.is_deleted), '-infinity'::timestamptz),
      coalesce((select max(c.synced_at) from public.fb_companies c where not c.is_deleted), '-infinity'::timestamptz)
    ),
    'privacy', jsonb_build_object('protectedFieldsStoredServerSide', true, 'browserPayload', 'dashboard_safe'),
    'summary', jsonb_build_object(
      'customers', (select count(*) from public.fb_customers c where not c.is_deleted),
      'companies', (select count(*) from public.fb_companies c where not c.is_deleted),
      'locations', (select count(*) from public.fb_company_locations l where not l.is_deleted),
      'contacts', (select count(*) from public.fb_company_contacts c where not c.is_deleted),
      'customerLifetimeSpend', (select coalesce(sum(c.amount_spent), 0) from public.fb_customers c where not c.is_deleted),
      'companyLifetimeSpend', (select coalesce(sum(c.total_spent), 0) from public.fb_companies c where not c.is_deleted)
    ),
    'pageInfo', jsonb_build_object(
      'pageSize', (select row_limit from params),
      'customersReturned', (select count(*) from customer_page),
      'companiesReturned', (select count(*) from company_page),
      'locationsReturned', (select count(*) from location_page),
      'customersTotal', (select count(*) from public.fb_customers c where not c.is_deleted),
      'companiesTotal', (select count(*) from public.fb_companies c where not c.is_deleted),
      'locationsTotal', (select count(*) from public.fb_company_locations l where not l.is_deleted)
    ),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', md5('customer:' || c.shopify_customer_id::text), 'name', coalesce(c.display_name, 'Customer'),
        'region_code', c.region_code, 'country_code', c.default_country_code,
        'order_count', c.order_count, 'lifetime_spend', greatest(c.amount_spent, c.net_sales),
        'currency_code', c.amount_spent_currency,
        'average_order_value', case when c.order_count > 0 then greatest(c.amount_spent, c.net_sales) / c.order_count else 0 end,
        'first_order_at', coalesce(c.first_order_at, (select min(o.processed_at) from public.fb_orders o where o.customer_id = c.shopify_customer_id and not o.is_test)),
        'last_order_at', coalesce(c.last_order_at, (select max(o.processed_at) from public.fb_orders o where o.customer_id = c.shopify_customer_id and not o.is_test)),
        'refunds', (select coalesce(sum(o.refunds), 0) from public.fb_orders o where o.customer_id = c.shopify_customer_id and not o.is_test),
        'returned_quantity', (select coalesce(sum(l.refunded_quantity), 0) from public.fb_order_lines l join public.fb_orders o on o.shopify_order_id = l.shopify_order_id where o.customer_id = c.shopify_customer_id and not o.is_test),
        'tags', c.tags,
        'marketing_status', coalesce(c.email_marketing_consent->>'marketingState', c.email_marketing_consent->>'state', 'unknown'),
        'state', c.state,
        'company_names', coalesce((select jsonb_agg(distinct co.name order by co.name)
          from public.fb_company_contacts cc join public.fb_companies co on co.shopify_company_id = cc.shopify_company_id
          where cc.shopify_customer_id = c.shopify_customer_id and not cc.is_deleted and not co.is_deleted), '[]'::jsonb),
        'recent_orders', coalesce((select jsonb_agg(x.item order by x.processed_at desc) from (
          select o.processed_at, jsonb_build_object('order', '#••••' || right(regexp_replace(o.order_name, '\\D', '', 'g'), 4),
            'processed_at', o.processed_at, 'total_sales', o.total_sales, 'refunds', o.refunds,
            'currency_code', o.currency_code, 'financial_status', o.financial_status, 'fulfillment_status', o.fulfillment_status) item
          from public.fb_orders o where o.customer_id = c.shopify_customer_id and not o.is_test order by o.processed_at desc limit 10
        ) x), '[]'::jsonb)
      ) order by c.last_order_at desc nulls last, c.display_name)
      from customer_page c
    ), '[]'::jsonb),
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', md5('company:' || c.shopify_company_id::text), 'name', c.name, 'status', 'active',
        'contacts_count', c.contacts_count, 'locations_count', c.locations_count,
        'order_count', c.order_count, 'lifetime_spend', c.total_spent, 'currency_code', c.currency_code,
        'last_order_at', (select max(l.last_order_at) from public.fb_company_locations l where l.shopify_company_id = c.shopify_company_id and not l.is_deleted),
        'main_contact_name', c.main_contact_name, 'customer_since', c.customer_since,
        'metafield_count', jsonb_array_length(c.metafields),
        'contacts', coalesce((select jsonb_agg(jsonb_build_object('name', cc.display_name, 'title', cc.title,
          'is_main_contact', cc.is_main_contact, 'roles', cc.role_assignments) order by cc.is_main_contact desc, cc.display_name)
          from public.fb_company_contacts cc where cc.shopify_company_id = c.shopify_company_id and not cc.is_deleted), '[]'::jsonb),
        'locations', coalesce((select jsonb_agg(jsonb_build_object('key', md5('location:' || l.shopify_company_location_id::text),
          'name', l.name, 'country_code', coalesce(l.shipping_address->>'countryCode', l.billing_address->>'countryCode'),
          'region', coalesce(l.shipping_address->>'province', l.billing_address->>'province'),
          'city', coalesce(l.shipping_address->>'city', l.billing_address->>'city'), 'currency_code', l.currency_code,
          'order_count', l.order_count, 'lifetime_spend', l.total_spent, 'last_order_at', l.last_order_at,
          'tax_exempt', coalesce((l.tax_settings->>'taxExempt')::boolean, false),
          'payment_terms', coalesce(l.buyer_experience_configuration#>>'{paymentTermsTemplate,name}', 'Standard'),
          'catalogs', coalesce((select jsonb_agg(e->>'title') from jsonb_array_elements(l.catalogs) e), '[]'::jsonb)
        ) order by l.name) from public.fb_company_locations l where l.shopify_company_id = c.shopify_company_id and not l.is_deleted), '[]'::jsonb)
      ) order by c.total_spent desc, c.name)
      from company_page c
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', md5('location:' || l.shopify_company_location_id::text), 'name', l.name,
        'company_key', md5('company:' || l.shopify_company_id::text), 'company_name', l.company_name,
        'country_code', coalesce(l.shipping_address->>'countryCode', l.billing_address->>'countryCode'),
        'region', coalesce(l.shipping_address->>'province', l.billing_address->>'province'),
        'city', coalesce(l.shipping_address->>'city', l.billing_address->>'city'),
        'currency_code', l.currency_code, 'order_count', l.order_count, 'lifetime_spend', l.total_spent,
        'last_order_at', l.last_order_at, 'tax_exempt', coalesce((l.tax_settings->>'taxExempt')::boolean, false),
        'payment_terms', coalesce(l.buyer_experience_configuration#>>'{paymentTermsTemplate,name}', 'Standard'),
        'catalogs', coalesce((select jsonb_agg(e->>'title') from jsonb_array_elements(l.catalogs) e), '[]'::jsonb)
      ) order by l.total_spent desc, l.name)
      from location_page l
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.fb_customer_company_directory_page(integer) from public, anon, authenticated;
grant execute on function public.fb_customer_company_directory_page(integer) to service_role;

comment on function public.fb_customer_company_directory_page(integer) is
  'Returns a bounded dashboard-safe customer and company directory page with complete totals.';
