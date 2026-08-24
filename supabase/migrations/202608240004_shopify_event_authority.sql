-- Make Shopify SalesAgreement/Sale events the sole financial authority for
-- Shopify rows. Order snapshots remain useful for orders, units, products and
-- customer detail, but must never substitute a different finance formula.

create or replace function public.fb_dashboard_snapshot_v5(p_start date, p_end date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select public.fb_dashboard_snapshot_v4(p_start, p_end) as payload
  ),
  event_daily as (
    select
      (e.happened_at at time zone 'Europe/London')::date as day,
      o.channel,
      o.region_code,
      sum(case when e.action_type = 'ORDER' and e.line_type in ('PRODUCT', 'GIFT_CARD')
        then e.total_amount - e.tax_amount + e.discount_before_taxes else 0 end)::numeric(16,2) as gross_sales,
      sum(case when e.action_type = 'ORDER' and e.line_type in ('PRODUCT', 'GIFT_CARD')
        then e.discount_before_taxes else 0 end)::numeric(16,2) as discounts,
      (-sum(case when e.action_type = 'RETURN' and e.line_type in ('PRODUCT', 'GIFT_CARD', 'ADJUSTMENT')
        then e.total_amount - e.tax_amount else 0 end))::numeric(16,2) as sales_reversals,
      sum(case when e.line_type = 'SHIPPING'
        then e.total_amount - e.tax_amount else 0 end)::numeric(16,2) as shipping,
      sum(case when e.line_type = 'FEE' and e.action_type = 'RETURN'
        then e.total_amount else 0 end)::numeric(16,2) as return_fees,
      sum(e.tax_amount)::numeric(16,2) as taxes,
      sum(e.total_amount)::numeric(16,2) as total_sales
    from public.fb_sales_events e
    join public.fb_orders o on o.shopify_order_id = e.shopify_order_id
    where not o.is_test
      and o.channel in ('shopify_d2c', 'shopify_b2b')
      and (e.happened_at at time zone 'Europe/London')::date between p_start and p_end
    group by 1, 2, 3
  ),
  daily_authoritative as (
    select coalesce(jsonb_agg(
      case when d->>'channel' in ('shopify_d2c', 'shopify_b2b') then
        d || jsonb_build_object(
          'gross_sales', coalesce(e.gross_sales, 0),
          'discounts', coalesce(e.discounts, 0),
          'refunds', coalesce(e.sales_reversals, 0),
          'sales_reversals', coalesce(e.sales_reversals, 0),
          'net_sales', coalesce(e.gross_sales, 0) - coalesce(e.discounts, 0) - coalesce(e.sales_reversals, 0),
          'shipping', coalesce(e.shipping, 0),
          'return_fees', coalesce(e.return_fees, 0),
          'taxes', coalesce(e.taxes, 0),
          'total_sales', coalesce(e.total_sales, 0),
          'gross_profit', coalesce(e.gross_sales, 0) - coalesce(e.discounts, 0)
            - coalesce(e.sales_reversals, 0) - coalesce((d->>'cogs')::numeric, 0),
          'financial_source', 'sales_events'
        )
      else d end
      order by d->>'day', d->>'channel', d->>'region_code'
    ), '[]'::jsonb) as rows
    from base
    cross join lateral jsonb_array_elements(base.payload->'daily') d
    left join event_daily e
      on e.day = (d->>'day')::date
      and e.channel = d->>'channel'
      and e.region_code = d->>'region_code'
  ),
  bounds as (
    select
      min((e.happened_at at time zone 'Europe/London')::date) as available_from,
      max(e.happened_at) as latest_event_at
    from public.fb_sales_events e
    where e.source_store = 'jetchill-mixology'
  ),
  checkpoint as (
    select cursor_updated_at, last_success_at
    from public.fb_sync_state
    where source_key = 'shopify_sales_events'
  ),
  quality as (
    select
      count(*) filter (where initial_event.shopify_order_id is null)::integer as missing_initial_orders
    from public.fb_orders o
    left join lateral (
      select e.shopify_order_id
      from public.fb_sales_events e
      where e.shopify_order_id = o.shopify_order_id
        and e.action_type = 'ORDER'
        and e.line_type in ('PRODUCT', 'GIFT_CARD')
        and (
          e.agreement_reason = 'ORDER'
          or ('draft_order' = any(o.tags) and e.agreement_reason = 'ORDER_EDIT')
        )
      limit 1
    ) initial_event on true
    where not o.is_test
      and o.channel in ('shopify_d2c', 'shopify_b2b')
      and (o.processed_at at time zone 'Europe/London')::date between p_start and p_end
  )
  select base.payload || jsonb_build_object(
    'daily', (select rows from daily_authoritative),
    'shopifyReconciliation', jsonb_build_object(
      'source', 'shopify_sales_events',
      'requestedStart', p_start,
      'requestedEnd', p_end,
      'availableFrom', '2019-01-01'::date,
      'latestEventAt', bounds.latest_event_at,
      'cursorUpdatedAt', checkpoint.cursor_updated_at,
      'lastSuccessAt', checkpoint.last_success_at,
      'missingInitialOrders', quality.missing_initial_orders,
      'status', case
        when p_start < '2019-01-01'::date then 'outside_coverage'
        when coalesce(quality.missing_initial_orders, 0) > 0 then 'incomplete'
        when checkpoint.cursor_updated_at is null then 'syncing'
        when p_end >= (now() at time zone 'Europe/London')::date then 'current_day_as_of_sync'
        when checkpoint.cursor_updated_at < ((p_end + 1)::timestamp at time zone 'Europe/London') then 'syncing'
        else 'reconciled'
      end
    )
  )
  from base
  cross join bounds
  left join checkpoint on true
  cross join quality;
$$;

revoke all on function public.fb_dashboard_snapshot_v5(date, date) from public, anon, authenticated;
grant execute on function public.fb_dashboard_snapshot_v5(date, date) to service_role;

comment on function public.fb_dashboard_snapshot_v5(date, date) is
  'Server-only dashboard payload using Shopify sales events as the sole Shopify financial authority with explicit reconciliation metadata.';
