-- Centralize Shopify D2C/B2B classification so every dashboard date range uses
-- the same rule. Shopify's order-level purchasing entity is authoritative when
-- available; customer/company membership and tags are durable fallbacks.

alter table public.fb_orders
  add column if not exists purchasing_entity_type text,
  add column if not exists purchasing_company_id bigint,
  add column if not exists purchasing_company_location_id bigint,
  add column if not exists customer_tags_at_sync text[] not null default '{}'::text[],
  add column if not exists b2b_classification_reasons text[] not null default '{}'::text[];

create index if not exists fb_orders_purchasing_company_idx
  on public.fb_orders (purchasing_company_id)
  where purchasing_company_id is not null;

create or replace function public.fb_shopify_b2b_reasons(
  p_order_tags text[],
  p_customer_tags text[],
  p_customer_id bigint,
  p_purchasing_entity_type text
)
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select array_remove(array[
    case
      when lower(coalesce(p_purchasing_entity_type, '')) = 'purchasingcompany'
      then 'purchasing_company'
    end,
    case
      when exists (
        select 1
        from unnest(coalesce(p_order_tags, array[]::text[])) as tag(value)
        where tag.value ~* '(^|[^a-z0-9])(wholesale|distributor|b2b)([^a-z0-9]|$)'
      )
      then 'order_tag'
    end,
    case
      when exists (
        select 1
        from unnest(coalesce(p_customer_tags, array[]::text[])) as tag(value)
        where tag.value ~* '(^|[^a-z0-9])(wholesale|distributor|b2b)([^a-z0-9]|$)'
      ) or exists (
        select 1
        from public.fb_customers customer
        cross join lateral unnest(coalesce(customer.tags, array[]::text[])) as tag(value)
        where customer.shopify_customer_id = p_customer_id
          and not customer.is_deleted
          and tag.value ~* '(^|[^a-z0-9])(wholesale|distributor|b2b)([^a-z0-9]|$)'
      )
      then 'customer_tag'
    end,
    case
      when exists (
        select 1
        from public.fb_company_contacts contact
        join public.fb_companies company
          on company.shopify_company_id = contact.shopify_company_id
        where contact.shopify_customer_id = p_customer_id
          and not contact.is_deleted
          and not company.is_deleted
      )
      then 'company_contact'
    end
  ]::text[], null);
$$;

create or replace function public.fb_set_shopify_order_channel()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reasons text[];
begin
  if new.source_store = 'jetchill-mixology' then
    v_reasons := public.fb_shopify_b2b_reasons(
      new.tags,
      new.customer_tags_at_sync,
      new.customer_id,
      new.purchasing_entity_type
    );
    new.b2b_classification_reasons := v_reasons;
    new.channel := case
      when cardinality(v_reasons) > 0 then 'shopify_b2b'
      else 'shopify_d2c'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists fb_orders_classify_shopify_channel on public.fb_orders;
create trigger fb_orders_classify_shopify_channel
before insert or update of tags, customer_tags_at_sync, customer_id, purchasing_entity_type, source_store, channel
on public.fb_orders
for each row
execute function public.fb_set_shopify_order_channel();

-- Reclassify the existing Shopify history from the currently synchronized
-- customer tags and company-contact directory. A later Shopify order backfill
-- can add purchasing_entity_type and will be classified by the same trigger.
with classified as (
  select
    orders.shopify_order_id,
    public.fb_shopify_b2b_reasons(
      orders.tags,
      orders.customer_tags_at_sync,
      orders.customer_id,
      orders.purchasing_entity_type
    ) as reasons
  from public.fb_orders orders
  where orders.source_store = 'jetchill-mixology'
)
update public.fb_orders orders
set
  channel = case
    when cardinality(classified.reasons) > 0 then 'shopify_b2b'
    else 'shopify_d2c'
  end,
  b2b_classification_reasons = classified.reasons,
  updated_at = now()
from classified
where orders.shopify_order_id = classified.shopify_order_id
  and (
    orders.channel is distinct from case
      when cardinality(classified.reasons) > 0 then 'shopify_b2b'
      else 'shopify_d2c'
    end
    or orders.b2b_classification_reasons is distinct from classified.reasons
  );

revoke all on function public.fb_shopify_b2b_reasons(text[], text[], bigint, text)
  from public, anon, authenticated;
revoke all on function public.fb_set_shopify_order_channel()
  from public, anon, authenticated;
grant execute on function public.fb_shopify_b2b_reasons(text[], text[], bigint, text)
  to service_role;
grant execute on function public.fb_set_shopify_order_channel()
  to service_role;

comment on function public.fb_shopify_b2b_reasons(text[], text[], bigint, text) is
  'Returns auditable reasons for classifying a jetchill-mixology Shopify order as B2B.';
comment on column public.fb_orders.b2b_classification_reasons is
  'Signals used to classify the Shopify order as B2B: purchasing_company, order_tag, customer_tag, company_contact.';
