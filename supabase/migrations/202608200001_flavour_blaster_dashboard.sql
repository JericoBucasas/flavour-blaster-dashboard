-- Flavour Blaster Sales Dashboard
-- Project: hnmmlfelaezmijbbwzsg
-- Server-only ingestion and reporting schema. No anon/authenticated access.

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role, public;

create table public.fb_orders (
  shopify_order_id bigint primary key,
  order_name text not null,
  channel text not null check (channel in ('shopify_d2c', 'shopify_b2b')),
  processed_at timestamptz not null,
  shopify_created_at timestamptz not null,
  shopify_updated_at timestamptz not null,
  cancelled_at timestamptz,
  closed_at timestamptz,
  customer_id bigint,
  customer_display_name text,
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  presentment_currency_code text check (presentment_currency_code is null or presentment_currency_code ~ '^[A-Z]{3}$'),
  country_code text,
  region_code text not null default 'other' check (region_code in ('us', 'eur', 'gb', 'aus', 'other')),
  financial_status text,
  fulfillment_status text,
  gross_sales numeric(16,2) not null default 0,
  discounts numeric(16,2) not null default 0,
  refunds numeric(16,2) not null default 0,
  net_sales numeric(16,2) not null default 0,
  shipping numeric(16,2) not null default 0,
  taxes numeric(16,2) not null default 0,
  total_sales numeric(16,2) not null default 0,
  total_line_items integer not null default 0 check (total_line_items >= 0),
  total_quantity integer not null default 0 check (total_quantity >= 0),
  fulfilled_on_time boolean,
  tags text[] not null default '{}',
  is_test boolean not null default false,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index fb_orders_order_name_uidx on public.fb_orders (order_name);
create index fb_orders_processed_at_idx on public.fb_orders (processed_at desc);
create index fb_orders_shopify_updated_at_idx on public.fb_orders (shopify_updated_at desc, shopify_order_id desc);
create index fb_orders_channel_region_date_idx on public.fb_orders (channel, region_code, processed_at desc);
create index fb_orders_customer_id_idx on public.fb_orders (customer_id) where customer_id is not null;

create table public.fb_products (
  shopify_product_id bigint primary key,
  title text not null,
  handle text,
  status text,
  vendor text,
  product_type text,
  tags text[] not null default '{}',
  image_url text,
  published_at timestamptz,
  shopify_created_at timestamptz,
  shopify_updated_at timestamptz not null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fb_products_status_idx on public.fb_products (status);
create index fb_products_updated_at_idx on public.fb_products (shopify_updated_at desc, shopify_product_id desc);

create table public.fb_product_variants (
  shopify_variant_id bigint primary key,
  shopify_product_id bigint not null references public.fb_products(shopify_product_id) on delete cascade,
  title text,
  sku text,
  barcode text,
  price numeric(16,2) not null default 0,
  compare_at_price numeric(16,2),
  unit_cost numeric(16,2),
  inventory_quantity integer,
  inventory_policy text,
  inventory_management text,
  taxable boolean,
  image_url text,
  shopify_created_at timestamptz,
  shopify_updated_at timestamptz not null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fb_product_variants_product_idx on public.fb_product_variants (shopify_product_id);
create index fb_product_variants_sku_idx on public.fb_product_variants (sku) where sku is not null and sku <> '';
create index fb_product_variants_updated_at_idx on public.fb_product_variants (shopify_updated_at desc, shopify_variant_id desc);

create table public.fb_order_lines (
  shopify_line_item_id bigint primary key,
  shopify_order_id bigint not null references public.fb_orders(shopify_order_id) on delete cascade,
  shopify_product_id bigint,
  shopify_variant_id bigint,
  sku text,
  title text not null,
  variant_title text,
  quantity integer not null default 0 check (quantity >= 0),
  refunded_quantity integer not null default 0 check (refunded_quantity >= 0),
  gross_sales numeric(16,2) not null default 0,
  discounts numeric(16,2) not null default 0,
  refunds numeric(16,2) not null default 0,
  net_sales numeric(16,2) not null default 0,
  unit_cost numeric(16,2),
  cogs numeric(16,2),
  gross_profit numeric(16,2),
  fulfillment_status text,
  requires_shipping boolean,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fb_order_lines_order_idx on public.fb_order_lines (shopify_order_id);
create index fb_order_lines_product_idx on public.fb_order_lines (shopify_product_id) where shopify_product_id is not null;
create index fb_order_lines_variant_idx on public.fb_order_lines (shopify_variant_id) where shopify_variant_id is not null;
create index fb_order_lines_sku_idx on public.fb_order_lines (sku) where sku is not null and sku <> '';

create table public.fb_customers (
  shopify_customer_id bigint primary key,
  display_name text,
  default_country_code text,
  region_code text not null default 'other' check (region_code in ('us', 'eur', 'gb', 'aus', 'other')),
  first_order_at timestamptz,
  last_order_at timestamptz,
  order_count integer not null default 0 check (order_count >= 0),
  net_sales numeric(16,2) not null default 0,
  shopify_created_at timestamptz,
  shopify_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fb_customers_last_order_idx on public.fb_customers (last_order_at desc);
create index fb_customers_region_idx on public.fb_customers (region_code);

create table public.fb_sync_state (
  source_key text primary key,
  cursor_updated_at timestamptz,
  cursor_id bigint,
  last_success_at timestamptz,
  last_run_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.fb_sync_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_key text not null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  window_start timestamptz,
  window_end timestamptz,
  pages_read integer not null default 0 check (pages_read >= 0),
  records_read integer not null default 0 check (records_read >= 0),
  records_written integer not null default 0 check (records_written >= 0),
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index fb_sync_runs_workflow_started_idx on public.fb_sync_runs (workflow_key, started_at desc);

create table public.fb_manual_overrides (
  override_key text primary key,
  override_value jsonb not null,
  reason text not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.fb_orders enable row level security;
alter table public.fb_products enable row level security;
alter table public.fb_product_variants enable row level security;
alter table public.fb_order_lines enable row level security;
alter table public.fb_customers enable row level security;
alter table public.fb_sync_state enable row level security;
alter table public.fb_sync_runs enable row level security;
alter table public.fb_manual_overrides enable row level security;

revoke all on table public.fb_orders from public, anon, authenticated;
revoke all on table public.fb_products from public, anon, authenticated;
revoke all on table public.fb_product_variants from public, anon, authenticated;
revoke all on table public.fb_order_lines from public, anon, authenticated;
revoke all on table public.fb_customers from public, anon, authenticated;
revoke all on table public.fb_sync_state from public, anon, authenticated;
revoke all on table public.fb_sync_runs from public, anon, authenticated;
revoke all on table public.fb_manual_overrides from public, anon, authenticated;

grant select, insert, update, delete on table public.fb_orders to service_role;
grant select, insert, update, delete on table public.fb_products to service_role;
grant select, insert, update, delete on table public.fb_product_variants to service_role;
grant select, insert, update, delete on table public.fb_order_lines to service_role;
grant select, insert, update, delete on table public.fb_customers to service_role;
grant select, insert, update, delete on table public.fb_sync_state to service_role;
grant select, insert, update, delete on table public.fb_sync_runs to service_role;
grant select, insert, update, delete on table public.fb_manual_overrides to service_role;

create or replace function public.fb_dashboard_snapshot(p_start date, p_end date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'generatedAt', now(),
    'coverageStart', (select min(o.processed_at)::date from public.fb_orders o where not o.is_test),
    'coverageEnd', (select max(o.processed_at)::date from public.fb_orders o where not o.is_test),
    'sourceLastUpdatedAt', (select max(o.shopify_updated_at) from public.fb_orders o where not o.is_test),
    'sync', coalesce((
      select to_jsonb(s) from (
        select source_key, cursor_updated_at, cursor_id, last_success_at, updated_at
        from public.fb_sync_state
        order by last_success_at desc nulls last
        limit 1
      ) s
    ), '{}'::jsonb),
    'daily', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.day, d.channel, d.region_code)
      from (
        select
          (o.processed_at at time zone 'Europe/London')::date as day,
          o.channel,
          o.region_code,
          count(*)::integer as orders,
          sum(o.total_quantity)::integer as units,
          sum(o.gross_sales)::numeric(16,2) as gross_sales,
          sum(o.discounts)::numeric(16,2) as discounts,
          sum(o.refunds)::numeric(16,2) as refunds,
          sum(o.net_sales)::numeric(16,2) as net_sales,
          sum(coalesce(l.cogs, 0))::numeric(16,2) as cogs,
          sum(coalesce(l.gross_profit, 0))::numeric(16,2) as gross_profit,
          count(*) filter (where o.fulfilled_on_time is true)::integer as fulfilled_on_time
        from public.fb_orders o
        left join (
          select shopify_order_id, sum(coalesce(cogs, 0)) as cogs, sum(coalesce(gross_profit, 0)) as gross_profit
          from public.fb_order_lines
          group by shopify_order_id
        ) l on l.shopify_order_id = o.shopify_order_id
        where not o.is_test
          and (o.processed_at at time zone 'Europe/London')::date between p_start and p_end
        group by 1, 2, 3
      ) d
    ), '[]'::jsonb),
    'hourly', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.day, h.hour, h.channel, h.region_code)
      from (
        select
          (o.processed_at at time zone 'Europe/London')::date as day,
          extract(hour from o.processed_at at time zone 'Europe/London')::integer as hour,
          o.channel,
          o.region_code,
          count(*)::integer as orders
        from public.fb_orders o
        where not o.is_test
          and (o.processed_at at time zone 'Europe/London')::date between p_start and p_end
        group by 1, 2, 3, 4
      ) h
    ), '[]'::jsonb),
    'recentOrders', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.processed_at desc)
      from (
        select
          o.shopify_order_id,
          o.order_name,
          o.processed_at,
          o.customer_display_name,
          o.channel,
          o.region_code,
          o.total_quantity,
          o.total_sales,
          o.currency_code,
          o.financial_status,
          o.fulfillment_status,
          o.tags
        from public.fb_orders o
        where not o.is_test
          and (o.processed_at at time zone 'Europe/London')::date between p_start and p_end
        order by o.processed_at desc
        limit 50
      ) r
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.net_sales desc, p.title)
      from (
        select
          l.shopify_product_id,
          l.shopify_variant_id,
          max(l.title) as title,
          max(l.variant_title) as variant_title,
          max(l.sku) as sku,
          max(coalesce(v.price, 0))::numeric(16,2) as price,
          sum(l.quantity)::integer as units,
          sum(l.refunded_quantity)::integer as refunded_units,
          sum(l.gross_sales)::numeric(16,2) as gross_sales,
          sum(l.refunds)::numeric(16,2) as refunds,
          sum(l.net_sales)::numeric(16,2) as net_sales,
          sum(coalesce(l.cogs, 0))::numeric(16,2) as cogs,
          sum(coalesce(l.gross_profit, 0))::numeric(16,2) as gross_profit,
          max(v.inventory_quantity) as inventory_quantity,
          max(coalesce(v.image_url, pr.image_url)) as image_url
        from public.fb_order_lines l
        join public.fb_orders o on o.shopify_order_id = l.shopify_order_id
        left join public.fb_product_variants v on v.shopify_variant_id = l.shopify_variant_id
        left join public.fb_products pr on pr.shopify_product_id = l.shopify_product_id
        where not o.is_test
          and (o.processed_at at time zone 'Europe/London')::date between p_start and p_end
        group by l.shopify_product_id, l.shopify_variant_id
        order by net_sales desc
        limit 250
      ) p
    ), '[]'::jsonb),
    'customers', jsonb_build_object(
      'customers', (
        select count(distinct o.customer_id)::integer
        from public.fb_orders o
        where not o.is_test and o.customer_id is not null
          and (o.processed_at at time zone 'Europe/London')::date between p_start and p_end
      ),
      'newCustomers', (
        select count(*)::integer from public.fb_customers c
        where (c.first_order_at at time zone 'Europe/London')::date between p_start and p_end
      ),
      'repeatCustomers', (
        select count(*)::integer from public.fb_customers c
        where c.order_count > 1
          and (c.last_order_at at time zone 'Europe/London')::date between p_start and p_end
      ),
      'wholesaleAccounts', coalesce((
        select jsonb_agg(to_jsonb(w) order by w.net_sales desc)
        from (
          select
            coalesce(o.customer_display_name, 'Wholesale customer') as name,
            o.region_code,
            count(*)::integer as orders,
            sum(o.net_sales)::numeric(16,2) as net_sales,
            max(o.processed_at) as last_order_at
          from public.fb_orders o
          where not o.is_test and o.channel = 'shopify_b2b'
            and (o.processed_at at time zone 'Europe/London')::date between p_start and p_end
          group by 1, 2
          order by net_sales desc
          limit 50
        ) w
      ), '[]'::jsonb)
    )
  );
$$;

revoke all on function public.fb_dashboard_snapshot(date, date) from public, anon, authenticated;
grant execute on function public.fb_dashboard_snapshot(date, date) to service_role;

comment on function public.fb_dashboard_snapshot(date, date) is
  'Server-only aggregated payload for the Flavour Blaster Sales Dashboard.';
