-- Shopify reports order-edit UPDATE sales as adjustments to gross sales and
-- discounts. Apply those immutable events without changing initial-order AOV.

create or replace function public.fb_dashboard_snapshot_v6(p_start date, p_end date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select public.fb_dashboard_snapshot_v5(p_start, p_end) as payload
  ),
  update_daily as (
    select
      (e.happened_at at time zone 'Europe/London')::date as day,
      o.channel,
      o.region_code,
      sum(e.total_amount - e.tax_amount + e.discount_before_taxes)::numeric(16,2) as gross_adjustment,
      sum(e.discount_before_taxes)::numeric(16,2) as discount_adjustment
    from public.fb_sales_events e
    join public.fb_orders o on o.shopify_order_id = e.shopify_order_id
    where not o.is_test
      and o.channel in ('shopify_d2c', 'shopify_b2b')
      and e.action_type = 'UPDATE'
      and e.line_type in ('PRODUCT', 'GIFT_CARD')
      and (e.happened_at at time zone 'Europe/London')::date between p_start and p_end
    group by 1, 2, 3
  ),
  corrected as (
    select coalesce(jsonb_agg(
      case when d->>'channel' in ('shopify_d2c', 'shopify_b2b') then
        d || jsonb_build_object(
          'gross_sales', coalesce((d->>'gross_sales')::numeric, 0) + coalesce(u.gross_adjustment, 0),
          'discounts', coalesce((d->>'discounts')::numeric, 0) + coalesce(u.discount_adjustment, 0),
          'net_sales', coalesce((d->>'net_sales')::numeric, 0)
            + coalesce(u.gross_adjustment, 0) - coalesce(u.discount_adjustment, 0),
          'gross_profit', coalesce((d->>'gross_profit')::numeric, 0)
            + coalesce(u.gross_adjustment, 0) - coalesce(u.discount_adjustment, 0),
          'financial_source', 'sales_events'
        )
      else d end
      order by d->>'day', d->>'channel', d->>'region_code'
    ), '[]'::jsonb) as rows
    from base
    cross join lateral jsonb_array_elements(base.payload->'daily') d
    left join update_daily u
      on u.day = (d->>'day')::date
      and u.channel = d->>'channel'
      and u.region_code = d->>'region_code'
  )
  select base.payload || jsonb_build_object('daily', (select rows from corrected))
  from base;
$$;

revoke all on function public.fb_dashboard_snapshot_v6(date, date) from public, anon, authenticated;
grant execute on function public.fb_dashboard_snapshot_v6(date, date) to service_role;

comment on function public.fb_dashboard_snapshot_v6(date, date) is
  'Server-only Shopify-authoritative dashboard payload including order-edit UPDATE sales adjustments.';
