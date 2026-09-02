-- Add exact day x channel x region unit-cost coverage for the Finance dashboard.
-- A confirmed zero unit cost remains costed; only a missing cost source is uncosted.

create or replace function public.fb_dashboard_snapshot_v8(p_start date, p_end date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select public.fb_dashboard_snapshot_v7(p_start, p_end) as payload
  ),
  cost_lines as (
    select
      (o.processed_at at time zone 'Europe/London')::date as day,
      o.channel,
      o.region_code,
      greatest(l.quantity - l.refunded_quantity, 0)::integer as net_units,
      case
        when l.cogs is not null then l.cogs
        when l.unit_cost is not null then l.unit_cost * greatest(l.quantity - l.refunded_quantity, 0)
        when canonical.unit_cost is not null then canonical.unit_cost * greatest(l.quantity - l.refunded_quantity, 0)
        else null
      end * case when o.channel in ('shopify_d2c', 'shopify_b2b') then 1::numeric else 0.79::numeric end as reporting_cogs,
      (l.cogs is not null or l.unit_cost is not null or canonical.unit_cost is not null) as has_confirmed_cost
    from public.fb_order_lines l
    join public.fb_orders o on o.shopify_order_id = l.shopify_order_id
    left join lateral (
      select v.unit_cost
      from public.fb_product_variants v
      where l.sku is not null
        and l.sku <> ''
        and lower(v.sku) = lower(l.sku)
        and not coalesce(v.is_deleted, false)
      order by v.shopify_updated_at desc, v.shopify_variant_id
      limit 1
    ) canonical on true
    where not o.is_test
      and (o.processed_at at time zone 'Europe/London')::date between p_start and p_end
  ),
  cost_coverage as (
    select
      day,
      channel,
      region_code,
      coalesce(sum(net_units) filter (where has_confirmed_cost), 0)::integer as costed_units,
      coalesce(sum(net_units) filter (where not has_confirmed_cost), 0)::integer as uncosted_units,
      round(coalesce(sum(reporting_cogs), 0), 2)::numeric(16,2) as cogs
    from cost_lines
    group by 1, 2, 3
  ),
  daily_with_coverage as (
    select coalesce(jsonb_agg(
      d || jsonb_build_object(
        'cogs', coalesce(c.cogs, 0),
        'gross_profit', round(coalesce((d->>'net_sales')::numeric, 0) - coalesce(c.cogs, 0), 2),
        'costed_units', coalesce(c.costed_units, 0),
        'uncosted_units', coalesce(c.uncosted_units,
          case when coalesce((d->>'units')::integer, 0) > 0 then (d->>'units')::integer else 0 end)
      ) order by d->>'day', d->>'channel', d->>'region_code'
    ), '[]'::jsonb) as rows
    from base
    cross join lateral jsonb_array_elements(base.payload->'daily') d
    left join cost_coverage c
      on c.day = (d->>'day')::date
      and c.channel = d->>'channel'
      and c.region_code = d->>'region_code'
  )
  select base.payload || jsonb_build_object('daily', (select rows from daily_with_coverage))
  from base;
$$;

revoke all on function public.fb_dashboard_snapshot_v8(date, date) from public, anon, authenticated;
grant execute on function public.fb_dashboard_snapshot_v8(date, date) to service_role;

comment on function public.fb_dashboard_snapshot_v8(date, date) is
  'Server-only GBP dashboard payload with exact unit-cost coverage at day, channel, and region grain.';
