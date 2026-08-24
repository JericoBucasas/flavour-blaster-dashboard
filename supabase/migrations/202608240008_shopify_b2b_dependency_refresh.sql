-- Keep historical Shopify order classifications synchronized when the customer
-- or company directory changes after the order itself was imported.

create or replace function public.fb_reclassify_shopify_customer_orders()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old_customer_id bigint;
  v_new_customer_id bigint;
begin
  if tg_op = 'UPDATE' and tg_table_name = 'fb_customers'
    and old.shopify_customer_id is not distinct from new.shopify_customer_id
    and old.tags is not distinct from new.tags
    and old.is_deleted is not distinct from new.is_deleted
  then
    return new;
  end if;

  if tg_op = 'UPDATE' and tg_table_name = 'fb_company_contacts'
    and old.shopify_customer_id is not distinct from new.shopify_customer_id
    and old.shopify_company_id is not distinct from new.shopify_company_id
    and old.is_deleted is not distinct from new.is_deleted
  then
    return new;
  end if;

  if tg_op <> 'INSERT' then
    v_old_customer_id := old.shopify_customer_id;
  end if;
  if tg_op <> 'DELETE' then
    v_new_customer_id := new.shopify_customer_id;
  end if;

  update public.fb_orders orders
  set channel = orders.channel
  where orders.source_store = 'jetchill-mixology'
    and orders.customer_id in (v_old_customer_id, v_new_customer_id);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists fb_customers_reclassify_shopify_orders on public.fb_customers;
create trigger fb_customers_reclassify_shopify_orders
after insert or delete or update of shopify_customer_id, tags, is_deleted
on public.fb_customers
for each row
execute function public.fb_reclassify_shopify_customer_orders();

drop trigger if exists fb_company_contacts_reclassify_shopify_orders on public.fb_company_contacts;
create trigger fb_company_contacts_reclassify_shopify_orders
after insert or delete or update of shopify_customer_id, shopify_company_id, is_deleted
on public.fb_company_contacts
for each row
execute function public.fb_reclassify_shopify_customer_orders();

create or replace function public.fb_reclassify_shopify_company_orders()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.shopify_company_id is not distinct from new.shopify_company_id
    and old.is_deleted is not distinct from new.is_deleted
  then
    return new;
  end if;

  update public.fb_orders orders
  set channel = orders.channel
  where orders.source_store = 'jetchill-mixology'
    and exists (
      select 1
      from public.fb_company_contacts contact
      where contact.shopify_company_id in (
        old.shopify_company_id,
        new.shopify_company_id
      )
        and contact.shopify_customer_id = orders.customer_id
    );

  return new;
end;
$$;

drop trigger if exists fb_companies_reclassify_shopify_orders on public.fb_companies;
create trigger fb_companies_reclassify_shopify_orders
after update of shopify_company_id, is_deleted
on public.fb_companies
for each row
execute function public.fb_reclassify_shopify_company_orders();

revoke all on function public.fb_reclassify_shopify_customer_orders()
  from public, anon, authenticated;
revoke all on function public.fb_reclassify_shopify_company_orders()
  from public, anon, authenticated;
grant execute on function public.fb_reclassify_shopify_customer_orders()
  to service_role;
grant execute on function public.fb_reclassify_shopify_company_orders()
  to service_role;

comment on function public.fb_reclassify_shopify_customer_orders() is
  'Reclassifies every jetchill-mixology order for a customer after tag or company-contact changes.';
comment on function public.fb_reclassify_shopify_company_orders() is
  'Reclassifies affected jetchill-mixology orders after a Shopify company changes.';
