-- Persist Shopify SalesAgreement/Sale events so dashboard finance metrics use
-- the date on which an order, edit, or refund happened, matching Shopify reports.

create table if not exists public.fb_sales_events (
  shopify_sale_id bigint primary key,
  shopify_agreement_id bigint not null,
  shopify_order_id bigint not null references public.fb_orders(shopify_order_id) on delete cascade,
  source_store text not null,
  happened_at timestamptz not null,
  agreement_reason text not null,
  sale_type text not null,
  action_type text not null,
  line_type text not null,
  quantity integer,
  total_amount numeric(16,2) not null default 0,
  discount_before_taxes numeric(16,2) not null default 0,
  discount_after_taxes numeric(16,2) not null default 0,
  tax_amount numeric(16,2) not null default 0,
  currency_code text not null,
  fx_rate_to_usd numeric(18,8) not null default 1 check (fx_rate_to_usd > 0),
  synced_at timestamptz not null default now()
);

create index if not exists fb_sales_events_happened_at_idx
  on public.fb_sales_events (happened_at desc, shopify_sale_id desc);
create index if not exists fb_sales_events_order_idx
  on public.fb_sales_events (shopify_order_id, happened_at desc);
create index if not exists fb_sales_events_store_happened_idx
  on public.fb_sales_events (source_store, happened_at desc);

alter table public.fb_sales_events enable row level security;
revoke all on table public.fb_sales_events from public, anon, authenticated;
grant all on table public.fb_sales_events to service_role;

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
  order_daily as (
    select (o.processed_at at time zone 'Europe/London')::date as day,
      o.channel, o.region_code, count(*)::integer as orders,
      sum(o.total_quantity)::integer as units,
      sum(o.gross_sales * o.fx_rate_to_usd)::numeric(16,2) as gross_sales,
      sum(o.discounts * o.fx_rate_to_usd)::numeric(16,2) as discounts,
      sum(o.refunds * o.fx_rate_to_usd)::numeric(16,2) as sales_reversals,
      sum(o.net_sales * o.fx_rate_to_usd)::numeric(16,2) as net_sales,
      sum((o.total_sales - o.net_sales - o.taxes - o.return_fees) * o.fx_rate_to_usd)::numeric(16,2) as shipping,
      sum(o.return_fees * o.fx_rate_to_usd)::numeric(16,2) as return_fees,
      sum(o.taxes * o.fx_rate_to_usd)::numeric(16,2) as taxes,
      sum(o.total_sales * o.fx_rate_to_usd)::numeric(16,2) as total_sales,
      sum(coalesce(lc.cogs, 0))::numeric(16,2) as cogs,
      count(*) filter (where o.fulfilled_on_time is true)::integer as fulfilled_on_time
    from public.fb_orders o
    left join line_costs lc on lc.shopify_order_id = o.shopify_order_id
    where not o.is_test
      and (o.processed_at at time zone 'Europe/London')::date between p_start and p_end
    group by 1, 2, 3
  ),
  event_daily_raw as (
    select (e.happened_at at time zone 'Europe/London')::date as day,
      o.channel, o.region_code,
      count(distinct e.shopify_order_id) filter (
        where e.action_type = 'ORDER' and e.agreement_reason = 'ORDER'
      )::integer as event_order_count,
      sum(case when e.action_type = 'ORDER' and e.line_type in ('PRODUCT', 'GIFT_CARD')
        then (e.total_amount - e.tax_amount + e.discount_before_taxes) * e.fx_rate_to_usd else 0 end)::numeric(16,2) as gross_sales,
      sum(case when e.action_type = 'ORDER' and e.line_type in ('PRODUCT', 'GIFT_CARD')
        then e.discount_before_taxes * e.fx_rate_to_usd else 0 end)::numeric(16,2) as discounts,
      (-sum(case when e.action_type = 'RETURN' and e.line_type in ('PRODUCT', 'GIFT_CARD', 'ADJUSTMENT')
        then (e.total_amount - e.tax_amount) * e.fx_rate_to_usd else 0 end))::numeric(16,2) as sales_reversals,
      sum(case when e.line_type = 'SHIPPING'
        then (e.total_amount - e.tax_amount) * e.fx_rate_to_usd else 0 end)::numeric(16,2) as shipping,
      sum(case when e.line_type = 'FEE' and e.action_type = 'RETURN'
        then e.total_amount * e.fx_rate_to_usd else 0 end)::numeric(16,2) as return_fees,
      sum(e.tax_amount * e.fx_rate_to_usd)::numeric(16,2) as taxes,
      sum(e.total_amount * e.fx_rate_to_usd)::numeric(16,2) as total_sales
    from public.fb_sales_events e
    join public.fb_orders o on o.shopify_order_id = e.shopify_order_id
    where not o.is_test
      and (e.happened_at at time zone 'Europe/London')::date between p_start and p_end
    group by 1, 2, 3
  ),
  daily as (
    select coalesce(od.day, ed.day) as day,
      coalesce(od.channel, ed.channel) as channel,
      coalesce(od.region_code, ed.region_code) as region_code,
      coalesce(od.orders, 0)::integer as orders,
      coalesce(od.units, 0)::integer as units,
      (case when ed.event_order_count >= coalesce(od.orders, 0) and ed.event_order_count > 0 then ed.gross_sales else coalesce(od.gross_sales, 0) end)::numeric(16,2) as gross_sales,
      (case when ed.event_order_count >= coalesce(od.orders, 0) and ed.event_order_count > 0 then ed.discounts else coalesce(od.discounts, 0) end)::numeric(16,2) as discounts,
      (case when ed.event_order_count >= coalesce(od.orders, 0) and ed.event_order_count > 0 then ed.sales_reversals else coalesce(od.sales_reversals, 0) end)::numeric(16,2) as refunds,
      (case when ed.event_order_count >= coalesce(od.orders, 0) and ed.event_order_count > 0 then ed.sales_reversals else coalesce(od.sales_reversals, 0) end)::numeric(16,2) as sales_reversals,
      (case when ed.event_order_count >= coalesce(od.orders, 0) and ed.event_order_count > 0
        then ed.gross_sales - ed.discounts - ed.sales_reversals else coalesce(od.net_sales, 0) end)::numeric(16,2) as net_sales,
      (case when ed.event_order_count >= coalesce(od.orders, 0) and ed.event_order_count > 0 then ed.shipping else coalesce(od.shipping, 0) end)::numeric(16,2) as shipping,
      (case when ed.event_order_count >= coalesce(od.orders, 0) and ed.event_order_count > 0 then ed.return_fees else coalesce(od.return_fees, 0) end)::numeric(16,2) as return_fees,
      (case when ed.event_order_count >= coalesce(od.orders, 0) and ed.event_order_count > 0 then ed.taxes else coalesce(od.taxes, 0) end)::numeric(16,2) as taxes,
      (case when ed.event_order_count >= coalesce(od.orders, 0) and ed.event_order_count > 0 then ed.total_sales else coalesce(od.total_sales, 0) end)::numeric(16,2) as total_sales,
      coalesce(od.cogs, 0)::numeric(16,2) as cogs,
      ((case when ed.event_order_count >= coalesce(od.orders, 0) and ed.event_order_count > 0
        then ed.gross_sales - ed.discounts - ed.sales_reversals else coalesce(od.net_sales, 0) end) - coalesce(od.cogs, 0))::numeric(16,2) as gross_profit,
      coalesce(od.fulfilled_on_time, 0)::integer as fulfilled_on_time,
      case when ed.event_order_count >= coalesce(od.orders, 0) and ed.event_order_count > 0
        then 'sales_events' else 'order_snapshots' end as financial_source
    from order_daily od
    full outer join event_daily_raw ed using (day, channel, region_code)
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

comment on table public.fb_sales_events is
  'Server-only Shopify sales event ledger; one immutable row per Shopify Sale ID.';
comment on function public.fb_dashboard_snapshot_v2(date, date) is
  'Server-only dashboard payload using complete Shopify sales events when daily order coverage is present.';
