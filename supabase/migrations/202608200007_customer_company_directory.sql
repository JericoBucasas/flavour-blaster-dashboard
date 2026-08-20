-- Complete Shopify customer and B2B company directory.
-- Full protected records remain server-only. The dashboard RPC returns a deliberately safe subset.

alter table public.fb_customers
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists locale text,
  add column if not exists state text,
  add column if not exists note text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists verified_email boolean,
  add column if not exists tax_exempt boolean,
  add column if not exists tax_exemptions text[] not null default '{}',
  add column if not exists data_sale_opt_out boolean,
  add column if not exists email_marketing_consent jsonb not null default '{}'::jsonb,
  add column if not exists sms_marketing_consent jsonb not null default '{}'::jsonb,
  add column if not exists default_address jsonb not null default '{}'::jsonb,
  add column if not exists addresses jsonb not null default '[]'::jsonb,
  add column if not exists company_profiles jsonb not null default '[]'::jsonb,
  add column if not exists metafields jsonb not null default '[]'::jsonb,
  add column if not exists amount_spent numeric(16,2) not null default 0,
  add column if not exists amount_spent_currency text,
  add column if not exists refunds numeric(16,2) not null default 0,
  add column if not exists returned_quantity integer not null default 0 check (returned_quantity >= 0),
  add column if not exists raw_record jsonb not null default '{}'::jsonb,
  add column if not exists last_seen_at timestamptz,
  add column if not exists is_deleted boolean not null default false,
  add column if not exists deleted_at timestamptz;

create index if not exists fb_customers_live_last_order_idx
  on public.fb_customers (is_deleted, last_order_at desc);
create index if not exists fb_customers_live_region_idx
  on public.fb_customers (is_deleted, region_code);

create table if not exists public.fb_companies (
  shopify_company_id bigint primary key,
  name text not null,
  external_id text,
  note text,
  customer_since timestamptz,
  main_contact_id bigint,
  main_contact_name text,
  contacts_count integer not null default 0 check (contacts_count >= 0),
  locations_count integer not null default 0 check (locations_count >= 0),
  order_count integer not null default 0 check (order_count >= 0),
  total_spent numeric(16,2) not null default 0,
  currency_code text,
  metafields jsonb not null default '[]'::jsonb,
  raw_record jsonb not null default '{}'::jsonb,
  shopify_created_at timestamptz,
  shopify_updated_at timestamptz not null,
  last_seen_at timestamptz not null,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fb_companies_live_name_idx
  on public.fb_companies (is_deleted, name);
create index if not exists fb_companies_live_updated_idx
  on public.fb_companies (is_deleted, shopify_updated_at desc);

create table if not exists public.fb_company_locations (
  shopify_company_location_id bigint primary key,
  shopify_company_id bigint not null references public.fb_companies(shopify_company_id) on delete cascade,
  name text not null,
  external_id text,
  phone text,
  locale text,
  note text,
  currency_code text,
  billing_address jsonb not null default '{}'::jsonb,
  shipping_address jsonb not null default '{}'::jsonb,
  tax_settings jsonb not null default '{}'::jsonb,
  buyer_experience_configuration jsonb not null default '{}'::jsonb,
  catalogs jsonb not null default '[]'::jsonb,
  metafields jsonb not null default '[]'::jsonb,
  order_count integer not null default 0 check (order_count >= 0),
  total_spent numeric(16,2) not null default 0,
  last_order_at timestamptz,
  raw_record jsonb not null default '{}'::jsonb,
  shopify_created_at timestamptz,
  shopify_updated_at timestamptz not null,
  last_seen_at timestamptz not null,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fb_company_locations_company_idx
  on public.fb_company_locations (shopify_company_id, is_deleted);
create index if not exists fb_company_locations_live_name_idx
  on public.fb_company_locations (is_deleted, name);

create table if not exists public.fb_company_contacts (
  shopify_company_contact_id bigint primary key,
  shopify_company_id bigint not null references public.fb_companies(shopify_company_id) on delete cascade,
  shopify_customer_id bigint,
  display_name text,
  title text,
  locale text,
  is_main_contact boolean not null default false,
  role_assignments jsonb not null default '[]'::jsonb,
  raw_record jsonb not null default '{}'::jsonb,
  shopify_created_at timestamptz,
  shopify_updated_at timestamptz,
  last_seen_at timestamptz not null,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fb_company_contacts_company_idx
  on public.fb_company_contacts (shopify_company_id, is_deleted);
create index if not exists fb_company_contacts_customer_idx
  on public.fb_company_contacts (shopify_customer_id)
  where shopify_customer_id is not null;

create or replace function public.fb_finalize_customer_company_sync(p_sync_started_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_customers integer := 0;
  v_companies integer := 0;
  v_locations integer := 0;
  v_contacts integer := 0;
begin
  if p_sync_started_at is null or p_sync_started_at > now() + interval '5 minutes' then
    raise exception 'INVALID_CUSTOMER_COMPANY_SYNC_START';
  end if;

  update public.fb_company_contacts set is_deleted = true, deleted_at = coalesce(deleted_at, now()), updated_at = now()
   where not is_deleted and last_seen_at < p_sync_started_at;
  get diagnostics v_contacts = row_count;
  update public.fb_company_locations set is_deleted = true, deleted_at = coalesce(deleted_at, now()), updated_at = now()
   where not is_deleted and last_seen_at < p_sync_started_at;
  get diagnostics v_locations = row_count;
  update public.fb_companies set is_deleted = true, deleted_at = coalesce(deleted_at, now()), updated_at = now()
   where not is_deleted and last_seen_at < p_sync_started_at;
  get diagnostics v_companies = row_count;
  update public.fb_customers set is_deleted = true, deleted_at = coalesce(deleted_at, now()), updated_at = now()
   where not is_deleted and (last_seen_at is null or last_seen_at < p_sync_started_at);
  get diagnostics v_customers = row_count;

  return jsonb_build_object('deleted_customers', v_customers, 'deleted_companies', v_companies,
    'deleted_locations', v_locations, 'deleted_contacts', v_contacts);
end;
$$;

create or replace function public.fb_customer_company_directory()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'generatedAt', now(),
    'lastSyncedAt', greatest(
      coalesce((select max(c.synced_at) from public.fb_customers c where not c.is_deleted), '-infinity'::timestamptz),
      coalesce((select max(co.synced_at) from public.fb_companies co where not co.is_deleted), '-infinity'::timestamptz)
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
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', md5('customer:' || c.shopify_customer_id::text), 'name', coalesce(c.display_name, 'Customer'),
        'region_code', c.region_code, 'country_code', c.default_country_code,
        'order_count', c.order_count, 'lifetime_spend', greatest(c.amount_spent, c.net_sales),
        'currency_code', c.amount_spent_currency, 'average_order_value', case when c.order_count > 0 then greatest(c.amount_spent, c.net_sales) / c.order_count else 0 end,
        'first_order_at', coalesce(c.first_order_at, (select min(o.processed_at) from public.fb_orders o where o.customer_id = c.shopify_customer_id and not o.is_test)),
        'last_order_at', coalesce(c.last_order_at, (select max(o.processed_at) from public.fb_orders o where o.customer_id = c.shopify_customer_id and not o.is_test)),
        'refunds', (select coalesce(sum(o.refunds), 0) from public.fb_orders o where o.customer_id = c.shopify_customer_id and not o.is_test),
        'returned_quantity', (select coalesce(sum(l.refunded_quantity), 0) from public.fb_order_lines l join public.fb_orders o on o.shopify_order_id = l.shopify_order_id where o.customer_id = c.shopify_customer_id and not o.is_test),
        'tags', c.tags,
        'marketing_status', coalesce(c.email_marketing_consent->>'marketingState', c.email_marketing_consent->>'state', 'unknown'),
        'state', c.state, 'company_names', coalesce((select jsonb_agg(distinct co.name order by co.name)
          from public.fb_company_contacts cc join public.fb_companies co on co.shopify_company_id = cc.shopify_company_id
          where cc.shopify_customer_id = c.shopify_customer_id and not cc.is_deleted and not co.is_deleted), '[]'::jsonb),
        'recent_orders', coalesce((select jsonb_agg(x.item order by x.processed_at desc) from (
          select o.processed_at, jsonb_build_object('order', '#••••' || right(regexp_replace(o.order_name, '\\D', '', 'g'), 4),
            'processed_at', o.processed_at, 'total_sales', o.total_sales, 'refunds', o.refunds,
            'currency_code', o.currency_code, 'financial_status', o.financial_status, 'fulfillment_status', o.fulfillment_status) item
          from public.fb_orders o where o.customer_id = c.shopify_customer_id and not o.is_test order by o.processed_at desc limit 10
        ) x), '[]'::jsonb)
      ) order by c.last_order_at desc nulls last, c.display_name) from public.fb_customers c where not c.is_deleted
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
      ) order by c.total_spent desc, c.name) from public.fb_companies c where not c.is_deleted
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', md5('location:' || l.shopify_company_location_id::text), 'name', l.name,
        'company_key', md5('company:' || c.shopify_company_id::text), 'company_name', c.name,
        'country_code', coalesce(l.shipping_address->>'countryCode', l.billing_address->>'countryCode'),
        'region', coalesce(l.shipping_address->>'province', l.billing_address->>'province'),
        'city', coalesce(l.shipping_address->>'city', l.billing_address->>'city'),
        'currency_code', l.currency_code, 'order_count', l.order_count, 'lifetime_spend', l.total_spent,
        'last_order_at', l.last_order_at, 'tax_exempt', coalesce((l.tax_settings->>'taxExempt')::boolean, false),
        'payment_terms', coalesce(l.buyer_experience_configuration#>>'{paymentTermsTemplate,name}', 'Standard'),
        'catalogs', coalesce((select jsonb_agg(e->>'title') from jsonb_array_elements(l.catalogs) e), '[]'::jsonb)
      ) order by l.total_spent desc, l.name)
      from public.fb_company_locations l join public.fb_companies c on c.shopify_company_id = l.shopify_company_id
      where not l.is_deleted and not c.is_deleted
    ), '[]'::jsonb)
  );
$$;

alter table public.fb_companies enable row level security;
alter table public.fb_company_locations enable row level security;
alter table public.fb_company_contacts enable row level security;

revoke all on table public.fb_companies, public.fb_company_locations, public.fb_company_contacts from public, anon, authenticated;
grant select, insert, update, delete on table public.fb_companies, public.fb_company_locations, public.fb_company_contacts to service_role;

revoke all on function public.fb_finalize_customer_company_sync(timestamptz) from public, anon, authenticated;
revoke all on function public.fb_customer_company_directory() from public, anon, authenticated;
grant execute on function public.fb_finalize_customer_company_sync(timestamptz) to service_role;
grant execute on function public.fb_customer_company_directory() to service_role;

drop policy if exists fb_companies_deny_browser_roles on public.fb_companies;
create policy fb_companies_deny_browser_roles on public.fb_companies as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists fb_company_locations_deny_browser_roles on public.fb_company_locations;
create policy fb_company_locations_deny_browser_roles on public.fb_company_locations as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists fb_company_contacts_deny_browser_roles on public.fb_company_contacts;
create policy fb_company_contacts_deny_browser_roles on public.fb_company_contacts as restrictive for all to anon, authenticated using (false) with check (false);
