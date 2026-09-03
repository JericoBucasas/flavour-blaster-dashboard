-- Read-only Google Ads reporting aggregates for customer 932-938-7049.
-- The source script can query Ads and POST aggregates, but cannot mutate Ads.

create table if not exists public.fb_google_ads_campaign_daily (
  customer_id text not null,
  day date not null,
  campaign_id text not null,
  campaign_name text not null,
  campaign_status text not null,
  channel_type text not null,
  channel_subtype text not null,
  currency_code text not null,
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  conversions numeric(20, 6) not null default 0 check (conversions >= 0),
  conversion_value numeric(20, 6) not null default 0 check (conversion_value >= 0),
  is_provisional boolean not null default false,
  source_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (customer_id, day, campaign_id),
  constraint fb_google_ads_campaign_daily_customer_check check (customer_id ~ '^[0-9]{10}$'),
  constraint fb_google_ads_campaign_daily_campaign_check check (campaign_id ~ '^[0-9]+$'),
  constraint fb_google_ads_campaign_daily_currency_check check (currency_code ~ '^[A-Z]{3}$')
);

create table if not exists public.fb_google_ads_campaign_country_daily (
  customer_id text not null,
  day date not null,
  campaign_id text not null,
  country_criterion_id text not null,
  country_code text,
  region_code text not null,
  targeting_location boolean not null,
  currency_code text not null,
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  conversions numeric(20, 6) not null default 0 check (conversions >= 0),
  conversion_value numeric(20, 6) not null default 0 check (conversion_value >= 0),
  is_provisional boolean not null default false,
  source_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (customer_id, day, campaign_id, country_criterion_id, targeting_location),
  constraint fb_google_ads_country_daily_parent_fk
    foreign key (customer_id, day, campaign_id)
    references public.fb_google_ads_campaign_daily (customer_id, day, campaign_id)
    on delete cascade,
  constraint fb_google_ads_country_daily_country_check check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint fb_google_ads_country_daily_region_check check (region_code in ('us', 'gb', 'eur', 'aus', 'other')),
  constraint fb_google_ads_country_daily_currency_check check (currency_code ~ '^[A-Z]{3}$')
);

create table if not exists public.fb_google_ads_backfill_windows (
  customer_id text not null,
  window_start date not null,
  window_end date not null,
  request_id uuid not null,
  campaign_rows integer not null check (campaign_rows >= 0),
  country_rows integer not null check (country_rows >= 0),
  completed_at timestamptz not null default now(),
  primary key (customer_id, window_start),
  constraint fb_google_ads_backfill_window_check check (
    window_start <= window_end and window_end - window_start <= 34
  )
);

create index if not exists fb_google_ads_campaign_daily_day_idx
  on public.fb_google_ads_campaign_daily (day desc);
create index if not exists fb_google_ads_campaign_country_region_day_idx
  on public.fb_google_ads_campaign_country_daily (region_code, day desc);

alter table public.fb_google_ads_campaign_daily enable row level security;
alter table public.fb_google_ads_campaign_country_daily enable row level security;
alter table public.fb_google_ads_backfill_windows enable row level security;

drop policy if exists fb_google_ads_campaign_daily_deny_browser_roles on public.fb_google_ads_campaign_daily;
create policy fb_google_ads_campaign_daily_deny_browser_roles
  on public.fb_google_ads_campaign_daily as restrictive for all to anon, authenticated
  using (false) with check (false);

drop policy if exists fb_google_ads_country_daily_deny_browser_roles on public.fb_google_ads_campaign_country_daily;
create policy fb_google_ads_country_daily_deny_browser_roles
  on public.fb_google_ads_campaign_country_daily as restrictive for all to anon, authenticated
  using (false) with check (false);

drop policy if exists fb_google_ads_backfill_deny_browser_roles on public.fb_google_ads_backfill_windows;
create policy fb_google_ads_backfill_deny_browser_roles
  on public.fb_google_ads_backfill_windows as restrictive for all to anon, authenticated
  using (false) with check (false);

revoke all on table public.fb_google_ads_campaign_daily from public, anon, authenticated;
revoke all on table public.fb_google_ads_campaign_country_daily from public, anon, authenticated;
revoke all on table public.fb_google_ads_backfill_windows from public, anon, authenticated;
grant select, insert, update, delete on table public.fb_google_ads_campaign_daily to service_role;
grant select, insert, update, delete on table public.fb_google_ads_campaign_country_daily to service_role;
grant select, insert, update, delete on table public.fb_google_ads_backfill_windows to service_role;

create or replace function public.fb_google_ads_replace_window(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_customer_id constant text := '9329387049';
  v_floor constant date := date '2025-01-01';
  v_schema_version integer;
  v_source text;
  v_currency text;
  v_timezone text;
  v_mode text;
  v_start date;
  v_end date;
  v_generated_at timestamptz;
  v_request_id uuid;
  v_campaign_rows jsonb;
  v_country_rows jsonb;
  v_campaign_count integer;
  v_country_count integer;
  v_next_window jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Google Ads payload must be a JSON object';
  end if;

  v_schema_version := (p_payload->>'schemaVersion')::integer;
  v_source := p_payload->>'source';
  v_currency := p_payload->>'currencyCode';
  v_timezone := p_payload->>'timeZone';
  v_mode := p_payload->>'mode';
  v_start := (p_payload->'window'->>'start')::date;
  v_end := (p_payload->'window'->>'end')::date;
  v_generated_at := (p_payload->>'generatedAt')::timestamptz;
  v_request_id := (p_payload->>'requestId')::uuid;
  v_campaign_rows := p_payload->'campaignDaily';
  v_country_rows := p_payload->'campaignCountryDaily';

  if v_schema_version is distinct from 1 then raise exception 'Unsupported Google Ads schema version'; end if;
  if v_source is distinct from 'google_ads' then raise exception 'Invalid Google Ads source'; end if;
  if p_payload->>'customerId' is distinct from v_customer_id then raise exception 'Unexpected Google Ads customer'; end if;
  if v_currency is distinct from 'GBP' then raise exception 'Unexpected Google Ads currency'; end if;
  if v_timezone is distinct from 'Europe/London' then raise exception 'Unexpected Google Ads timezone'; end if;
  if v_mode not in ('incremental', 'correction', 'backfill') then raise exception 'Invalid Google Ads sync mode'; end if;
  if v_start is null or v_end is null or v_start > v_end or v_start < v_floor then raise exception 'Invalid Google Ads window'; end if;
  if v_end - v_start > 34 then raise exception 'Google Ads window exceeds 35 days'; end if;
  if v_generated_at is null or v_request_id is null then raise exception 'Google Ads request metadata missing'; end if;
  if jsonb_typeof(v_campaign_rows) is distinct from 'array' or jsonb_typeof(v_country_rows) is distinct from 'array' then
    raise exception 'Google Ads row collections must be arrays';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_campaign_rows) as r(
      day date, "campaignId" text, "campaignName" text, "campaignStatus" text,
      "channelType" text, "channelSubtype" text, "costMicros" text,
      impressions bigint, clicks bigint, conversions numeric, "conversionValue" numeric
    )
    where r.day not between v_start and v_end
      or r."campaignId" is null or r."campaignId" !~ '^[0-9]+$'
      or r."campaignName" is null or length(r."campaignName") > 1024
      or r."campaignStatus" is null or r."channelType" is null or r."channelSubtype" is null
      or r."costMicros" is null or r."costMicros" !~ '^[0-9]+$'
      or r.impressions is null or r.impressions < 0
      or r.clicks is null or r.clicks < 0
      or r.conversions is null or r.conversions < 0
      or r."conversionValue" is null or r."conversionValue" < 0
  ) then raise exception 'Invalid Google Ads campaign row'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_country_rows) as r(
      day date, "campaignId" text, "countryCriterionId" text, "countryCode" text,
      "regionCode" text, "targetingLocation" boolean, "costMicros" text,
      impressions bigint, clicks bigint, conversions numeric, "conversionValue" numeric
    )
    where r.day not between v_start and v_end
      or r."campaignId" is null or r."campaignId" !~ '^[0-9]+$'
      or r."countryCriterionId" is null or r."countryCriterionId" !~ '^[0-9]+$'
      or (r."countryCode" is not null and r."countryCode" <> '' and r."countryCode" !~ '^[A-Z]{2}$')
      or r."regionCode" not in ('us', 'gb', 'eur', 'aus', 'other')
      or r."targetingLocation" is null
      or r."costMicros" is null or r."costMicros" !~ '^[0-9]+$'
      or r.impressions is null or r.impressions < 0
      or r.clicks is null or r.clicks < 0
      or r.conversions is null or r.conversions < 0
      or r."conversionValue" is null or r."conversionValue" < 0
  ) then raise exception 'Invalid Google Ads country row'; end if;

  delete from public.fb_google_ads_campaign_country_daily
  where customer_id = v_customer_id and day between v_start and v_end;
  delete from public.fb_google_ads_campaign_daily
  where customer_id = v_customer_id and day between v_start and v_end;

  insert into public.fb_google_ads_campaign_daily (
    customer_id, day, campaign_id, campaign_name, campaign_status, channel_type,
    channel_subtype, currency_code, cost_micros, impressions, clicks, conversions,
    conversion_value, is_provisional, source_updated_at, updated_at
  )
  select v_customer_id, r.day, r."campaignId", r."campaignName", r."campaignStatus",
    r."channelType", r."channelSubtype", v_currency, r."costMicros"::bigint,
    r.impressions, r.clicks, r.conversions, r."conversionValue",
    r.day >= ((now() at time zone 'Europe/London')::date - 3), v_generated_at, now()
  from jsonb_to_recordset(v_campaign_rows) as r(
    day date, "campaignId" text, "campaignName" text, "campaignStatus" text,
    "channelType" text, "channelSubtype" text, "costMicros" text,
    impressions bigint, clicks bigint, conversions numeric, "conversionValue" numeric
  );
  get diagnostics v_campaign_count = row_count;

  insert into public.fb_google_ads_campaign_country_daily (
    customer_id, day, campaign_id, country_criterion_id, country_code, region_code,
    targeting_location, currency_code, cost_micros, impressions, clicks, conversions,
    conversion_value, is_provisional, source_updated_at, updated_at
  )
  select v_customer_id, r.day, r."campaignId", r."countryCriterionId",
    nullif(r."countryCode", ''), r."regionCode", r."targetingLocation", v_currency,
    r."costMicros"::bigint, r.impressions, r.clicks, r.conversions, r."conversionValue",
    r.day >= ((now() at time zone 'Europe/London')::date - 3), v_generated_at, now()
  from jsonb_to_recordset(v_country_rows) as r(
    day date, "campaignId" text, "countryCriterionId" text, "countryCode" text,
    "regionCode" text, "targetingLocation" boolean, "costMicros" text,
    impressions bigint, clicks bigint, conversions numeric, "conversionValue" numeric
  );
  get diagnostics v_country_count = row_count;

  if v_mode = 'backfill' then
    insert into public.fb_google_ads_backfill_windows (
      customer_id, window_start, window_end, request_id, campaign_rows, country_rows, completed_at
    ) values (
      v_customer_id, v_start, v_end, v_request_id, v_campaign_count, v_country_count, now()
    )
    on conflict (customer_id, window_start) do update set
      window_end = excluded.window_end,
      request_id = excluded.request_id,
      campaign_rows = excluded.campaign_rows,
      country_rows = excluded.country_rows,
      completed_at = now();
  end if;

  insert into public.fb_sync_state (
    source_key, cursor_updated_at, last_success_at, last_run_id, metadata, updated_at
  ) values (
    'google_ads',
    (v_end::timestamp + interval '1 day' - interval '1 millisecond') at time zone 'Europe/London',
    now(), v_request_id,
    jsonb_build_object(
      'customer_id', v_customer_id, 'currency_code', v_currency,
      'timezone', v_timezone, 'mode', v_mode, 'window_start', v_start,
      'window_end', v_end, 'campaign_rows', v_campaign_count,
      'country_rows', v_country_count, 'historical_floor', v_floor,
      'overlap_days', 3, 'schedule_hours', 1,
      'coverage_start', v_start, 'coverage_end', v_end
    ), now()
  )
  on conflict (source_key) do update set
    cursor_updated_at = greatest(public.fb_sync_state.cursor_updated_at, excluded.cursor_updated_at),
    last_success_at = excluded.last_success_at,
    last_run_id = excluded.last_run_id,
    metadata = public.fb_sync_state.metadata || excluded.metadata || jsonb_build_object(
      'coverage_start', least(
        coalesce((public.fb_sync_state.metadata->>'coverage_start')::date, v_start),
        v_start
      ),
      'coverage_end', greatest(
        coalesce((public.fb_sync_state.metadata->>'coverage_end')::date, v_end),
        v_end
      )
    ),
    updated_at = now();

  select jsonb_build_object(
    'start', month_start::date,
    'end', least((month_start + interval '1 month - 1 day')::date,
      (now() at time zone 'Europe/London')::date - 1)
  ) into v_next_window
  from generate_series(
    date_trunc('month', v_floor::timestamp),
    date_trunc('month', ((now() at time zone 'Europe/London')::date - 1)::timestamp),
    interval '1 month'
  ) as month_start
  where not exists (
    select 1 from public.fb_google_ads_backfill_windows b
    where b.customer_id = v_customer_id
      and b.window_start = month_start::date
      and b.window_end >= least(
        (month_start + interval '1 month - 1 day')::date,
        (now() at time zone 'Europe/London')::date - 1
      )
  )
  order by month_start
  limit 1;

  return jsonb_build_object(
    'status', 'accepted',
    'requestId', v_request_id,
    'campaignRows', v_campaign_count,
    'countryRows', v_country_count,
    'nextBackfillWindow', v_next_window
  );
end;
$$;

create or replace function public.fb_google_ads_dashboard_snapshot(p_start date, p_end date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_customer_id constant text := '9329387049';
  v_floor constant date := date '2025-01-01';
  v_checkpoint public.fb_sync_state%rowtype;
  v_coverage_start date;
  v_coverage_end date;
  v_provisional_through date;
  v_status text;
  v_geo_complete boolean;
  v_range_complete boolean;
  v_backfill_complete boolean;
begin
  if p_start is null or p_end is null or p_start > p_end then
    raise exception 'Invalid Google Ads dashboard date range';
  end if;

  select * into v_checkpoint from public.fb_sync_state where source_key = 'google_ads';
  select min(day), max(day), max(day) filter (where is_provisional)
  into v_coverage_start, v_coverage_end, v_provisional_through
  from public.fb_google_ads_campaign_daily where customer_id = v_customer_id;

  v_coverage_start := coalesce((v_checkpoint.metadata->>'coverage_start')::date, v_coverage_start);
  v_coverage_end := greatest(
    v_coverage_end,
    (v_checkpoint.cursor_updated_at at time zone 'Europe/London')::date,
    (v_checkpoint.metadata->>'coverage_end')::date
  );

  v_status := case
    when v_checkpoint.source_key is null then 'unavailable'
    when v_checkpoint.last_success_at is null or v_checkpoint.last_success_at < now() - interval '2 hours' then 'stale'
    else 'live'
  end;

  select not exists (
    select 1
    from generate_series(
      date_trunc('month', v_floor::timestamp),
      date_trunc('month', ((now() at time zone 'Europe/London')::date - 1)::timestamp),
      interval '1 month'
    ) month_start
    where not exists (
      select 1 from public.fb_google_ads_backfill_windows b
      where b.customer_id = v_customer_id
        and b.window_start = month_start::date
        and b.window_end >= least(
          (month_start + interval '1 month - 1 day')::date,
          (now() at time zone 'Europe/London')::date - 1
        )
    )
  ) into v_backfill_complete;

  select not exists (
    with totals as (
      select day, campaign_id, sum(cost_micros) cost_micros,
        sum(conversions) conversions, sum(conversion_value) conversion_value
      from public.fb_google_ads_campaign_daily
      where customer_id = v_customer_id and day between p_start and p_end
      group by day, campaign_id
    ), countries as (
      select day, campaign_id, sum(cost_micros) cost_micros,
        sum(conversions) conversions, sum(conversion_value) conversion_value
      from public.fb_google_ads_campaign_country_daily
      where customer_id = v_customer_id and day between p_start and p_end
      group by day, campaign_id
    )
    select 1
    from totals t full join countries c using (day, campaign_id)
    where coalesce(t.cost_micros, 0) <> coalesce(c.cost_micros, 0)
      or abs(coalesce(t.conversions, 0) - coalesce(c.conversions, 0)) > 0.01
      or abs(coalesce(t.conversion_value, 0) - coalesce(c.conversion_value, 0)) > 0.01
  ) into v_geo_complete;

  v_range_complete := v_coverage_start is not null and p_start >= v_floor and p_end <= v_coverage_end
    and (
      p_start >= (now() at time zone 'Europe/London')::date - 3
      or not exists (
        select 1
        from generate_series(
          date_trunc('month', p_start::timestamp),
          date_trunc('month', least(p_end, (now() at time zone 'Europe/London')::date - 1)::timestamp),
          interval '1 month'
        ) month_start
        where not exists (
          select 1 from public.fb_google_ads_backfill_windows b
          where b.customer_id = v_customer_id
            and b.window_start = month_start::date
            and b.window_end >= least(
              (month_start + interval '1 month - 1 day')::date,
              (now() at time zone 'Europe/London')::date - 1
            )
        )
      )
    );

  return jsonb_build_object(
    'customerId', v_customer_id,
    'currencyCode', 'GBP',
    'timeZone', 'Europe/London',
    'status', v_status,
    'coverageStart', v_coverage_start,
    'coverageEnd', v_coverage_end,
    'lastSuccessAt', v_checkpoint.last_success_at,
    'provisionalThrough', v_provisional_through,
    'generatedAt', now(),
    'rangeComplete', v_range_complete,
    'backfillComplete', v_backfill_complete,
    'geoComplete', v_geo_complete,
    'geographyReason', case when v_geo_complete then null else 'Country totals do not reconcile with authoritative campaign totals' end,
    'dailyTotals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day, 'cost', d.cost_micros / 1000000.0,
        'impressions', d.impressions, 'clicks', d.clicks,
        'conversions', d.conversions, 'conversionValue', d.conversion_value,
        'isProvisional', d.is_provisional
      ) order by d.day)
      from (
        select day, sum(cost_micros) cost_micros, sum(impressions) impressions,
          sum(clicks) clicks, sum(conversions) conversions,
          sum(conversion_value) conversion_value, bool_or(is_provisional) is_provisional
        from public.fb_google_ads_campaign_daily
        where customer_id = v_customer_id and day between p_start and p_end
        group by day
      ) d
    ), '[]'::jsonb),
    'dailyRegions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day, 'regionCode', d.region_code, 'cost', d.cost_micros / 1000000.0,
        'impressions', d.impressions, 'clicks', d.clicks,
        'conversions', d.conversions, 'conversionValue', d.conversion_value,
        'isProvisional', d.is_provisional
      ) order by d.day, d.region_code)
      from (
        select day, region_code, sum(cost_micros) cost_micros, sum(impressions) impressions,
          sum(clicks) clicks, sum(conversions) conversions,
          sum(conversion_value) conversion_value, bool_or(is_provisional) is_provisional
        from public.fb_google_ads_campaign_country_daily
        where customer_id = v_customer_id and day between p_start and p_end
        group by day, region_code
      ) d
    ), '[]'::jsonb),
    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', c.day, 'campaignId', c.campaign_id, 'campaignName', c.campaign_name,
        'campaignStatus', c.campaign_status, 'channelType', c.channel_type,
        'channelSubtype', c.channel_subtype, 'cost', c.cost_micros / 1000000.0,
        'impressions', c.impressions, 'clicks', c.clicks,
        'conversions', c.conversions, 'conversionValue', c.conversion_value
      ) order by c.day, c.cost_micros desc, c.campaign_name)
      from public.fb_google_ads_campaign_daily c
      where c.customer_id = v_customer_id and c.day between p_start and p_end
    ), '[]'::jsonb),
    'campaignRegions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', c.day, 'campaignId', c.campaign_id, 'regionCode', c.region_code,
        'cost', c.cost_micros / 1000000.0, 'impressions', c.impressions,
        'clicks', c.clicks, 'conversions', c.conversions,
        'conversionValue', c.conversion_value
      ) order by c.day, c.campaign_id, c.region_code)
      from (
        select day, campaign_id, region_code, sum(cost_micros) cost_micros,
          sum(impressions) impressions, sum(clicks) clicks, sum(conversions) conversions,
          sum(conversion_value) conversion_value
        from public.fb_google_ads_campaign_country_daily
        where customer_id = v_customer_id and day between p_start and p_end
        group by day, campaign_id, region_code
      ) c
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.fb_google_ads_replace_window(jsonb) from public, anon, authenticated;
revoke all on function public.fb_google_ads_dashboard_snapshot(date, date) from public, anon, authenticated;
grant execute on function public.fb_google_ads_replace_window(jsonb) to service_role;
grant execute on function public.fb_google_ads_dashboard_snapshot(date, date) to service_role;

comment on table public.fb_google_ads_campaign_daily is
  'Aggregate Google Ads campaign reporting for Flavour Blaster; contains no search terms or audience identifiers.';
comment on table public.fb_google_ads_campaign_country_daily is
  'Aggregate Google Ads actual-user-country reporting used only for dashboard region filters.';
comment on function public.fb_google_ads_replace_window(jsonb) is
  'Validates and transactionally replaces one bounded Google Ads reporting window.';
comment on function public.fb_google_ads_dashboard_snapshot(date, date) is
  'Returns bounded service-role-only Google Ads aggregates for the protected dashboard API.';
