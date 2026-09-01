-- Aggregate-only GA4 reporting for flavourblaster.com.
-- Shopify remains authoritative for commerce metrics; these objects hold
-- website traffic and GA4 ecommerce observations only.

create table if not exists public.fb_ga4_daily (
  property_id bigint not null,
  day date not null,
  currency_code text not null default 'GBP',
  sessions bigint not null default 0 check (sessions >= 0),
  engaged_sessions bigint not null default 0 check (engaged_sessions >= 0),
  event_count bigint not null default 0 check (event_count >= 0),
  add_to_carts bigint not null default 0 check (add_to_carts >= 0),
  checkouts bigint not null default 0 check (checkouts >= 0),
  ecommerce_purchases bigint not null default 0 check (ecommerce_purchases >= 0),
  purchase_revenue numeric(18, 2) not null default 0,
  is_provisional boolean not null default false,
  source_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (property_id, day),
  constraint fb_ga4_daily_currency_code_check check (currency_code ~ '^[A-Z]{3}$')
);

create table if not exists public.fb_ga4_dimensions (
  property_id bigint not null,
  day date not null,
  dimension_type text not null,
  dimension_key text not null,
  dimension_label text not null,
  region_code text,
  sessions bigint not null default 0 check (sessions >= 0),
  engaged_sessions bigint not null default 0 check (engaged_sessions >= 0),
  event_count bigint not null default 0 check (event_count >= 0),
  add_to_carts bigint not null default 0 check (add_to_carts >= 0),
  checkouts bigint not null default 0 check (checkouts >= 0),
  ecommerce_purchases bigint not null default 0 check (ecommerce_purchases >= 0),
  purchase_revenue numeric(18, 2) not null default 0,
  is_provisional boolean not null default false,
  source_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (property_id, day, dimension_type, dimension_key),
  constraint fb_ga4_dimensions_type_check check (
    dimension_type in ('channel_group', 'source_medium', 'country', 'device', 'landing_page')
  ),
  constraint fb_ga4_dimensions_region_check check (
    region_code is null or region_code in ('us', 'gb', 'eur', 'aus', 'other')
  )
);

create index if not exists fb_ga4_daily_day_idx
  on public.fb_ga4_daily (day desc);

create index if not exists fb_ga4_dimensions_type_day_idx
  on public.fb_ga4_dimensions (dimension_type, day desc);

create index if not exists fb_ga4_dimensions_country_region_day_idx
  on public.fb_ga4_dimensions (region_code, day desc)
  where dimension_type = 'country';

alter table public.fb_ga4_daily enable row level security;
alter table public.fb_ga4_dimensions enable row level security;

drop policy if exists fb_ga4_daily_deny_browser_roles on public.fb_ga4_daily;
create policy fb_ga4_daily_deny_browser_roles
  on public.fb_ga4_daily as restrictive for all to anon, authenticated
  using (false) with check (false);

drop policy if exists fb_ga4_dimensions_deny_browser_roles on public.fb_ga4_dimensions;
create policy fb_ga4_dimensions_deny_browser_roles
  on public.fb_ga4_dimensions as restrictive for all to anon, authenticated
  using (false) with check (false);

revoke all on table public.fb_ga4_daily from public, anon, authenticated;
revoke all on table public.fb_ga4_dimensions from public, anon, authenticated;
grant select, insert, update, delete on table public.fb_ga4_daily to service_role;
grant select, insert, update, delete on table public.fb_ga4_dimensions to service_role;

create or replace function public.fb_ga4_upsert_daily(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  insert into public.fb_ga4_daily (
    property_id, day, currency_code, sessions, engaged_sessions, event_count,
    add_to_carts, checkouts, ecommerce_purchases, purchase_revenue,
    is_provisional, source_updated_at, updated_at
  )
  select
    r.property_id, r.day, coalesce(nullif(r.currency_code, ''), 'GBP'),
    greatest(coalesce(r.sessions, 0), 0),
    greatest(coalesce(r.engaged_sessions, 0), 0),
    greatest(coalesce(r.event_count, 0), 0),
    greatest(coalesce(r.add_to_carts, 0), 0),
    greatest(coalesce(r.checkouts, 0), 0),
    greatest(coalesce(r.ecommerce_purchases, 0), 0),
    coalesce(r.purchase_revenue, 0),
    coalesce(r.is_provisional, false),
    coalesce(r.source_updated_at, now()),
    now()
  from jsonb_to_recordset(p_rows) as r(
    property_id bigint,
    day date,
    currency_code text,
    sessions bigint,
    engaged_sessions bigint,
    event_count bigint,
    add_to_carts bigint,
    checkouts bigint,
    ecommerce_purchases bigint,
    purchase_revenue numeric,
    is_provisional boolean,
    source_updated_at timestamptz
  )
  where r.property_id is not null and r.day is not null
  on conflict (property_id, day) do update set
    currency_code = excluded.currency_code,
    sessions = excluded.sessions,
    engaged_sessions = excluded.engaged_sessions,
    event_count = excluded.event_count,
    add_to_carts = excluded.add_to_carts,
    checkouts = excluded.checkouts,
    ecommerce_purchases = excluded.ecommerce_purchases,
    purchase_revenue = excluded.purchase_revenue,
    is_provisional = excluded.is_provisional,
    source_updated_at = excluded.source_updated_at,
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.fb_ga4_replace_dimensions(
  p_property_id bigint,
  p_start date,
  p_end date,
  p_dimension_type text,
  p_rows jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_property_id is null or p_start is null or p_end is null or p_start > p_end then
    raise exception 'Invalid GA4 replacement window';
  end if;
  if p_end - p_start > 62 then
    raise exception 'GA4 replacement window exceeds 62 days';
  end if;
  if p_dimension_type not in ('channel_group', 'source_medium', 'country', 'device', 'landing_page') then
    raise exception 'Unsupported GA4 dimension type: %', p_dimension_type;
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  delete from public.fb_ga4_dimensions
  where property_id = p_property_id
    and day between p_start and p_end
    and dimension_type = p_dimension_type;

  insert into public.fb_ga4_dimensions (
    property_id, day, dimension_type, dimension_key, dimension_label,
    region_code, sessions, engaged_sessions, event_count, add_to_carts,
    checkouts, ecommerce_purchases, purchase_revenue, is_provisional,
    source_updated_at, updated_at
  )
  select
    p_property_id,
    r.day,
    p_dimension_type,
    left(coalesce(nullif(r.dimension_key, ''), '(not set)'), 1024),
    left(coalesce(nullif(r.dimension_label, ''), '(not set)'), 1024),
    case when p_dimension_type = 'country' then coalesce(r.region_code, 'other') else null end,
    greatest(coalesce(r.sessions, 0), 0),
    greatest(coalesce(r.engaged_sessions, 0), 0),
    greatest(coalesce(r.event_count, 0), 0),
    greatest(coalesce(r.add_to_carts, 0), 0),
    greatest(coalesce(r.checkouts, 0), 0),
    greatest(coalesce(r.ecommerce_purchases, 0), 0),
    coalesce(r.purchase_revenue, 0),
    coalesce(r.is_provisional, false),
    coalesce(r.source_updated_at, now()),
    now()
  from jsonb_to_recordset(p_rows) as r(
    day date,
    dimension_key text,
    dimension_label text,
    region_code text,
    sessions bigint,
    engaged_sessions bigint,
    event_count bigint,
    add_to_carts bigint,
    checkouts bigint,
    ecommerce_purchases bigint,
    purchase_revenue numeric,
    is_provisional boolean,
    source_updated_at timestamptz
  )
  where r.day between p_start and p_end
  on conflict (property_id, day, dimension_type, dimension_key) do update set
    dimension_label = excluded.dimension_label,
    region_code = excluded.region_code,
    sessions = excluded.sessions,
    engaged_sessions = excluded.engaged_sessions,
    event_count = excluded.event_count,
    add_to_carts = excluded.add_to_carts,
    checkouts = excluded.checkouts,
    ecommerce_purchases = excluded.ecommerce_purchases,
    purchase_revenue = excluded.purchase_revenue,
    is_provisional = excluded.is_provisional,
    source_updated_at = excluded.source_updated_at,
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.fb_ga4_dimension_snapshot(
  p_property_id bigint,
  p_start date,
  p_end date,
  p_dimension_type text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'day', d.day,
    'key', d.dimension_key,
    'label', d.dimension_label,
    'regionCode', d.region_code,
    'sessions', d.sessions,
    'engagedSessions', d.engaged_sessions,
    'eventCount', d.event_count,
    'addToCarts', d.add_to_carts,
    'checkouts', d.checkouts,
    'ecommercePurchases', d.ecommerce_purchases,
    'purchaseRevenue', d.purchase_revenue,
    'isProvisional', d.is_provisional
  ) order by d.day, d.sessions desc, d.dimension_label), '[]'::jsonb)
  from public.fb_ga4_dimensions d
  where d.property_id = p_property_id
    and d.day between p_start and p_end
    and d.dimension_type = p_dimension_type;
$$;

create or replace function public.fb_ga4_dashboard_snapshot(p_start date, p_end date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_property_id constant bigint := 298253309;
  v_checkpoint public.fb_sync_state%rowtype;
  v_coverage_start date;
  v_coverage_end date;
  v_provisional_through date;
  v_status text;
begin
  if p_start is null or p_end is null or p_start > p_end then
    raise exception 'Invalid GA4 dashboard date range';
  end if;

  select * into v_checkpoint
  from public.fb_sync_state
  where source_key = 'ga4_traffic';

  select min(day), max(day), max(day) filter (where is_provisional)
  into v_coverage_start, v_coverage_end, v_provisional_through
  from public.fb_ga4_daily
  where property_id = v_property_id;

  v_status := case
    when v_coverage_start is null then 'unavailable'
    when v_checkpoint.last_success_at is null then 'stale'
    when v_checkpoint.last_success_at < now() - interval '12 hours' then 'stale'
    else 'live'
  end;

  return jsonb_build_object(
    'propertyId', v_property_id,
    'status', v_status,
    'coverageStart', v_coverage_start,
    'coverageEnd', v_coverage_end,
    'lastSuccessAt', v_checkpoint.last_success_at,
    'provisionalThrough', v_provisional_through,
    'generatedAt', now(),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'currencyCode', d.currency_code,
        'sessions', d.sessions,
        'engagedSessions', d.engaged_sessions,
        'eventCount', d.event_count,
        'addToCarts', d.add_to_carts,
        'checkouts', d.checkouts,
        'ecommercePurchases', d.ecommerce_purchases,
        'purchaseRevenue', d.purchase_revenue,
        'isProvisional', d.is_provisional
      ) order by d.day)
      from public.fb_ga4_daily d
      where d.property_id = v_property_id and d.day between p_start and p_end
    ), '[]'::jsonb),
    'channelGroups', public.fb_ga4_dimension_snapshot(v_property_id, p_start, p_end, 'channel_group'),
    'sourceMedium', public.fb_ga4_dimension_snapshot(v_property_id, p_start, p_end, 'source_medium'),
    'countries', public.fb_ga4_dimension_snapshot(v_property_id, p_start, p_end, 'country'),
    'devices', public.fb_ga4_dimension_snapshot(v_property_id, p_start, p_end, 'device'),
    'landingPages', public.fb_ga4_dimension_snapshot(v_property_id, p_start, p_end, 'landing_page')
  );
end;
$$;

revoke all on function public.fb_ga4_upsert_daily(jsonb) from public, anon, authenticated;
revoke all on function public.fb_ga4_replace_dimensions(bigint, date, date, text, jsonb) from public, anon, authenticated;
revoke all on function public.fb_ga4_dimension_snapshot(bigint, date, date, text) from public, anon, authenticated;
revoke all on function public.fb_ga4_dashboard_snapshot(date, date) from public, anon, authenticated;

grant execute on function public.fb_ga4_upsert_daily(jsonb) to service_role;
grant execute on function public.fb_ga4_replace_dimensions(bigint, date, date, text, jsonb) to service_role;
grant execute on function public.fb_ga4_dimension_snapshot(bigint, date, date, text) to service_role;
grant execute on function public.fb_ga4_dashboard_snapshot(date, date) to service_role;

comment on table public.fb_ga4_daily is
  'Daily aggregate GA4 website reporting for flavourblaster.com; contains no visitor identifiers or raw events.';
comment on table public.fb_ga4_dimensions is
  'Daily GA4 aggregate reporting by one approved dimension grain; contains no visitor identifiers or raw events.';
comment on function public.fb_ga4_dashboard_snapshot(date, date) is
  'Returns bounded GA4 traffic aggregates for the protected Flavour Blaster dashboard API.';
