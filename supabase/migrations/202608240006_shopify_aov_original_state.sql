-- Shopify AOV uses the order's original product value and excludes later
-- edits. Shopify can emit finalization agreements shortly after processedAt;
-- the store's ShopifyQL report treats agreements in the first 90 seconds as
-- part of that original state.

create or replace function public.fb_dashboard_snapshot_v7(p_start date, p_end date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select public.fb_dashboard_snapshot_v6(p_start, p_end) as payload
  ),
  shopify_aov_daily as (
    select
      (o.processed_at at time zone 'Europe/London')::date as day,
      o.channel,
      o.region_code,
      sum(e.total_amount - e.tax_amount)::numeric(16,2) as aov_sales
    from public.fb_orders o
    join public.fb_sales_events e
      on e.shopify_order_id = o.shopify_order_id
      and e.line_type in ('PRODUCT', 'GIFT_CARD')
      and (
        (e.agreement_reason = 'ORDER' and e.action_type = 'ORDER')
        or (
          e.agreement_reason = 'ORDER_EDIT'
          and e.happened_at >= o.processed_at
          and e.happened_at <= o.processed_at + interval '90 seconds'
        )
      )
    where not o.is_test
      and o.channel in ('shopify_d2c', 'shopify_b2b')
      and (o.processed_at at time zone 'Europe/London')::date between p_start and p_end
    group by 1, 2, 3
  ),
  corrected as (
    select coalesce(jsonb_agg(
      case when d->>'channel' in ('shopify_d2c', 'shopify_b2b') then
        d || jsonb_build_object(
          'aov_sales', coalesce(a.aov_sales, 0),
          'aov_orders', coalesce((d->>'orders')::integer, 0),
          'aov_source', 'shopify_original_order_state'
        )
      else d end
      order by d->>'day', d->>'channel', d->>'region_code'
    ), '[]'::jsonb) as rows
    from base
    cross join lateral jsonb_array_elements(base.payload->'daily') d
    left join shopify_aov_daily a
      on a.day = (d->>'day')::date
      and a.channel = d->>'channel'
      and a.region_code = d->>'region_code'
  )
  select base.payload || jsonb_build_object('daily', (select rows from corrected))
  from base;
$$;

revoke all on function public.fb_dashboard_snapshot_v7(date, date) from public, anon, authenticated;
grant execute on function public.fb_dashboard_snapshot_v7(date, date) to service_role;

comment on function public.fb_dashboard_snapshot_v7(date, date) is
  'Server-only Shopify-authoritative dashboard payload with original-order-state AOV.';
