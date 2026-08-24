-- Present the multi-store dashboard in GBP while preserving Shopify's native
-- GBP reporting values. The v2 payload already reconciles Shopify sales events;
-- only Amazon rows need conversion from its USD reporting base.

create or replace function public.fb_dashboard_snapshot_v3(p_start date, p_end date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select public.fb_dashboard_snapshot_v2(p_start, p_end) as payload
  ),
  daily_gbp as (
    select coalesce(jsonb_agg(
      d || jsonb_build_object(
        'gross_sales', round(coalesce((d->>'gross_sales')::numeric, 0) * factor, 2),
        'discounts', round(coalesce((d->>'discounts')::numeric, 0) * factor, 2),
        'refunds', round(coalesce((d->>'refunds')::numeric, 0) * factor, 2),
        'sales_reversals', round(coalesce((d->>'sales_reversals')::numeric, 0) * factor, 2),
        'net_sales', round(coalesce((d->>'net_sales')::numeric, 0) * factor, 2),
        'shipping', round(coalesce((d->>'shipping')::numeric, 0) * factor, 2),
        'return_fees', round(coalesce((d->>'return_fees')::numeric, 0) * factor, 2),
        'taxes', round(coalesce((d->>'taxes')::numeric, 0) * factor, 2),
        'total_sales', round(coalesce((d->>'total_sales')::numeric, 0) * factor, 2),
        'cogs', round(coalesce((d->>'cogs')::numeric, 0) * factor, 2),
        'gross_profit', round(coalesce((d->>'gross_profit')::numeric, 0) * factor, 2)
      ) order by d->>'day', d->>'channel', d->>'region_code'
    ), '[]'::jsonb) as rows
    from base
    cross join lateral jsonb_array_elements(base.payload->'daily') d
    cross join lateral (
      select case when d->>'channel' in ('shopify_d2c', 'shopify_b2b') then 1::numeric else 0.79::numeric end as factor
    ) rate
  ),
  recent_orders_gbp as (
    select coalesce(jsonb_agg(
      r || jsonb_build_object(
        'total_sales', round(case
          when r->>'currency_code' = 'GBP' then coalesce((r->>'original_total_sales')::numeric, 0)
          else coalesce((r->>'total_sales')::numeric, 0) * 0.79
        end, 2),
        'reporting_currency_code', 'GBP'
      ) order by r->>'processed_at' desc
    ), '[]'::jsonb) as rows
    from base
    cross join lateral jsonb_array_elements(base.payload->'recentOrders') r
  ),
  product_rows_gbp as (
    select
      coalesce(canonical.shopify_product_id, l.shopify_product_id) as shopify_product_id,
      coalesce(canonical.shopify_variant_id, l.shopify_variant_id) as shopify_variant_id,
      coalesce(canonical.product_title, max(l.title)) as title,
      coalesce(canonical.variant_title, max(l.variant_title)) as variant_title,
      max(l.sku) as sku,
      max(coalesce(canonical.price, 0))::numeric(16,2) as price,
      sum(l.quantity)::integer as units,
      sum(l.refunded_quantity)::integer as refunded_units,
      sum(l.gross_sales * case when o.currency_code = 'GBP' then 1 else o.fx_rate_to_usd * 0.79 end)::numeric(16,2) as gross_sales,
      sum(l.refunds * case when o.currency_code = 'GBP' then 1 else o.fx_rate_to_usd * 0.79 end)::numeric(16,2) as refunds,
      sum(l.net_sales * case when o.currency_code = 'GBP' then 1 else o.fx_rate_to_usd * 0.79 end)::numeric(16,2) as net_sales,
      sum(coalesce(l.cogs, canonical.unit_cost * greatest(l.quantity - l.refunded_quantity, 0), 0))::numeric(16,2) as cogs,
      (sum(l.net_sales * case when o.currency_code = 'GBP' then 1 else o.fx_rate_to_usd * 0.79 end)
        - sum(coalesce(l.cogs, canonical.unit_cost * greatest(l.quantity - l.refunded_quantity, 0), 0)))::numeric(16,2) as gross_profit,
      max(canonical.inventory_quantity) as inventory_quantity,
      max(canonical.image_url) as image_url
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
    'reportingCurrencyCode', 'GBP',
    'daily', (select rows from daily_gbp),
    'recentOrders', (select rows from recent_orders_gbp),
    'products', coalesce((select jsonb_agg(to_jsonb(p) order by p.net_sales desc, p.title) from product_rows_gbp p), '[]'::jsonb)
  )
  from base;
$$;

revoke all on function public.fb_dashboard_snapshot_v3(date, date) from public, anon, authenticated;
grant execute on function public.fb_dashboard_snapshot_v3(date, date) to service_role;

comment on function public.fb_dashboard_snapshot_v3(date, date) is
  'Server-only GBP dashboard payload; Shopify rows preserve native GBP totals and other stores are converted to GBP.';
