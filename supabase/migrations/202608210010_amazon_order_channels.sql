-- Amazon US/UK order ingestion support.
-- Orders remain server-only. Customer PII is intentionally excluded by the ingestion workflow.

alter table public.fb_orders drop constraint if exists fb_orders_channel_check;
alter table public.fb_orders
  add constraint fb_orders_channel_check
  check (channel in ('shopify_d2c', 'shopify_b2b', 'amazon_us', 'amazon_uk'));

alter table public.fb_orders
  add column if not exists source_store text not null default 'jetchill-mixology',
  add column if not exists fx_rate_to_usd numeric(18,8) not null default 1 check (fx_rate_to_usd > 0),
  add column if not exists reporting_currency_code text not null default 'USD'
    check (reporting_currency_code = 'USD');

alter table public.fb_order_lines
  add column if not exists source_store text not null default 'jetchill-mixology',
  add column if not exists fx_rate_to_usd numeric(18,8) not null default 1 check (fx_rate_to_usd > 0);

drop index if exists public.fb_orders_order_name_uidx;
create unique index if not exists fb_orders_source_order_name_uidx
  on public.fb_orders (source_store, order_name);
create index if not exists fb_orders_source_updated_idx
  on public.fb_orders (source_store, shopify_updated_at desc, shopify_order_id desc);
create index if not exists fb_order_lines_source_sku_idx
  on public.fb_order_lines (source_store, lower(sku))
  where sku is not null and sku <> '';

create or replace function public.fb_dashboard_snapshot_v2(p_start date, p_end date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select public.fb_dashboard_snapshot(p_start, p_end) as payload
  ),
  line_costs as (
    select l.shopify_order_id,
      sum(coalesce(l.cogs, canonical.unit_cost * greatest(l.quantity - l.refunded_quantity, 0), 0))::numeric(16,2) as cogs
    from public.fb_order_lines l
    left join lateral (
      select v.unit_cost
      from public.fb_product_variants v
      where l.sku is not null and l.sku <> '' and lower(v.sku) = lower(l.sku)
        and not coalesce(v.is_deleted, false)
      order by v.shopify_updated_at desc, v.shopify_variant_id
      limit 1
    ) canonical on true
    group by l.shopify_order_id
  ),
  daily as (
    select (o.processed_at at time zone 'Europe/London')::date as day,
      o.channel, o.region_code, count(*)::integer as orders,
      sum(o.total_quantity)::integer as units,
      sum(o.gross_sales * o.fx_rate_to_usd)::numeric(16,2) as gross_sales,
      sum(o.discounts * o.fx_rate_to_usd)::numeric(16,2) as discounts,
      sum(o.refunds * o.fx_rate_to_usd)::numeric(16,2) as refunds,
      sum(o.net_sales * o.fx_rate_to_usd)::numeric(16,2) as net_sales,
      sum(coalesce(lc.cogs, 0))::numeric(16,2) as cogs,
      (sum(o.net_sales * o.fx_rate_to_usd) - sum(coalesce(lc.cogs, 0)))::numeric(16,2) as gross_profit,
      count(*) filter (where o.fulfilled_on_time is true)::integer as fulfilled_on_time
    from public.fb_orders o
    left join line_costs lc on lc.shopify_order_id = o.shopify_order_id
    where not o.is_test
      and (o.processed_at at time zone 'Europe/London')::date between p_start and p_end
    group by 1, 2, 3
  ),
  hourly as (
    select (o.processed_at at time zone 'Europe/London')::date as day,
      extract(hour from o.processed_at at time zone 'Europe/London')::integer as hour,
      o.channel, o.region_code, count(*)::integer as orders
    from public.fb_orders o
    where not o.is_test
      and (o.processed_at at time zone 'Europe/London')::date between p_start and p_end
    group by 1, 2, 3, 4
  ),
  recent_orders as (
    select o.shopify_order_id, o.order_name, o.processed_at, o.customer_display_name,
      o.channel, o.region_code, o.total_quantity,
      (o.total_sales * o.fx_rate_to_usd)::numeric(16,2) as total_sales,
      o.total_sales as original_total_sales, o.currency_code, o.reporting_currency_code,
      o.financial_status, o.fulfillment_status, o.tags
    from public.fb_orders o
    where not o.is_test
      and (o.processed_at at time zone 'Europe/London')::date between p_start and p_end
    order by o.processed_at desc
    limit 50
  ),
  product_rows as (
    select coalesce(canonical.shopify_product_id, l.shopify_product_id) as shopify_product_id,
      coalesce(canonical.shopify_variant_id, l.shopify_variant_id) as shopify_variant_id,
      coalesce(canonical.product_title, max(l.title)) as title,
      coalesce(canonical.variant_title, max(l.variant_title)) as variant_title,
      max(l.sku) as sku, max(coalesce(canonical.price, 0))::numeric(16,2) as price,
      sum(l.quantity)::integer as units, sum(l.refunded_quantity)::integer as refunded_units,
      sum(l.gross_sales * l.fx_rate_to_usd)::numeric(16,2) as gross_sales,
      sum(l.refunds * l.fx_rate_to_usd)::numeric(16,2) as refunds,
      sum(l.net_sales * l.fx_rate_to_usd)::numeric(16,2) as net_sales,
      sum(coalesce(l.cogs, canonical.unit_cost * greatest(l.quantity - l.refunded_quantity, 0), 0))::numeric(16,2) as cogs,
      (sum(l.net_sales * l.fx_rate_to_usd) - sum(coalesce(l.cogs, canonical.unit_cost * greatest(l.quantity - l.refunded_quantity, 0), 0)))::numeric(16,2) as gross_profit,
      max(canonical.inventory_quantity) as inventory_quantity, max(canonical.image_url) as image_url
    from public.fb_order_lines l
    join public.fb_orders o on o.shopify_order_id = l.shopify_order_id
    left join lateral (
      select v.shopify_product_id, v.shopify_variant_id, p.title as product_title,
        v.title as variant_title, v.price, v.unit_cost, v.inventory_quantity,
        coalesce(v.image_url, p.image_url) as image_url
      from public.fb_product_variants v
      join public.fb_products p on p.shopify_product_id = v.shopify_product_id
      where l.sku is not null and l.sku <> '' and lower(v.sku) = lower(l.sku)
        and not coalesce(v.is_deleted, false) and not coalesce(p.is_deleted, false)
      order by v.shopify_updated_at desc, v.shopify_variant_id
      limit 1
    ) canonical on true
    where not o.is_test
      and (o.processed_at at time zone 'Europe/London')::date between p_start and p_end
    group by coalesce(canonical.shopify_product_id, l.shopify_product_id),
      coalesce(canonical.shopify_variant_id, l.shopify_variant_id),
      canonical.product_title, canonical.variant_title
    order by net_sales desc
    limit 250
  )
  select base.payload || jsonb_build_object(
    'reportingCurrencyCode', 'USD',
    'daily', coalesce((select jsonb_agg(to_jsonb(d) order by d.day, d.channel, d.region_code) from daily d), '[]'::jsonb),
    'hourly', coalesce((select jsonb_agg(to_jsonb(h) order by h.day, h.hour, h.channel, h.region_code) from hourly h), '[]'::jsonb),
    'recentOrders', coalesce((select jsonb_agg(to_jsonb(r) order by r.processed_at desc) from recent_orders r), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(p) order by p.net_sales desc, p.title) from product_rows p), '[]'::jsonb)
  ) from base;
$$;

revoke all on function public.fb_dashboard_snapshot_v2(date, date) from public, anon, authenticated;
grant execute on function public.fb_dashboard_snapshot_v2(date, date) to service_role;

comment on function public.fb_dashboard_snapshot_v2(date, date) is
  'Server-only multi-store dashboard payload with USD reporting amounts and SKU-based catalog reconciliation.';
