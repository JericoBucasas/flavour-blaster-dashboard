-- Calculate AOV from the sales value attached to orders when they were placed.
-- Shopify draft orders can emit their completed value as ORDER_EDIT events, so
-- those events remain part of draft-order AOV. Later edits to ordinary orders
-- are excluded.

create or replace function public.fb_dashboard_snapshot_v4(p_start date, p_end date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select public.fb_dashboard_snapshot_v3(p_start, p_end) as payload
  ),
  shopify_aov_daily as (
    select
      (o.processed_at at time zone 'Europe/London')::date as day,
      o.channel,
      o.region_code,
      count(distinct o.shopify_order_id) filter (
        where e.shopify_order_id is not null
      )::integer as event_order_count,
      sum(case
        when e.action_type = 'ORDER'
          and e.line_type in ('PRODUCT', 'GIFT_CARD')
          and (
            e.agreement_reason = 'ORDER'
            or ('draft_order' = any(o.tags) and e.agreement_reason = 'ORDER_EDIT')
          )
        then e.total_amount - e.tax_amount
        else 0
      end)::numeric(16,2) as aov_sales
    from public.fb_orders o
    left join public.fb_sales_events e
      on e.shopify_order_id = o.shopify_order_id
      and e.action_type = 'ORDER'
      and e.line_type in ('PRODUCT', 'GIFT_CARD')
      and (
        e.agreement_reason = 'ORDER'
        or ('draft_order' = any(o.tags) and e.agreement_reason = 'ORDER_EDIT')
      )
    where not o.is_test
      and o.channel in ('shopify_d2c', 'shopify_b2b')
      and (o.processed_at at time zone 'Europe/London')::date between p_start and p_end
    group by 1, 2, 3
  ),
  daily_with_aov as (
    select coalesce(jsonb_agg(
      d || jsonb_build_object(
        'aov_sales', case
          when d->>'channel' in ('shopify_d2c', 'shopify_b2b')
            and coalesce(a.event_order_count, 0) >= coalesce((d->>'orders')::integer, 0)
            and coalesce(a.event_order_count, 0) > 0
          then a.aov_sales
          else coalesce((d->>'gross_sales')::numeric, 0) - coalesce((d->>'discounts')::numeric, 0)
        end,
        'aov_orders', coalesce((d->>'orders')::integer, 0),
        'aov_source', case
          when d->>'channel' in ('shopify_d2c', 'shopify_b2b')
            and coalesce(a.event_order_count, 0) >= coalesce((d->>'orders')::integer, 0)
            and coalesce(a.event_order_count, 0) > 0
          then 'initial_order_sales'
          else 'gross_less_discounts'
        end
      ) order by d->>'day', d->>'channel', d->>'region_code'
    ), '[]'::jsonb) as rows
    from base
    cross join lateral jsonb_array_elements(base.payload->'daily') d
    left join shopify_aov_daily a
      on a.day = (d->>'day')::date
      and a.channel = d->>'channel'
      and a.region_code = d->>'region_code'
  )
  select base.payload || jsonb_build_object(
    'daily', (select rows from daily_with_aov)
  )
  from base;
$$;

revoke all on function public.fb_dashboard_snapshot_v4(date, date) from public, anon, authenticated;
grant execute on function public.fb_dashboard_snapshot_v4(date, date) to service_role;

comment on function public.fb_dashboard_snapshot_v4(date, date) is
  'Server-only GBP dashboard payload with Shopify-compatible initial-order AOV values.';
