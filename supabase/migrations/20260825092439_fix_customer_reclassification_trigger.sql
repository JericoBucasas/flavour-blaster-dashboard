-- Prevent the shared customer/company-contact trigger from reading fields that
-- do not exist on the table that fired it. PostgreSQL record-field access is
-- not protected by a boolean table-name guard in the same IF expression.

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
  if tg_table_name = 'fb_customers' then
    if tg_op = 'UPDATE'
      and old.shopify_customer_id is not distinct from new.shopify_customer_id
      and old.tags is not distinct from new.tags
      and old.is_deleted is not distinct from new.is_deleted
    then
      return new;
    end if;
  elsif tg_table_name = 'fb_company_contacts' then
    if tg_op = 'UPDATE'
      and old.shopify_customer_id is not distinct from new.shopify_customer_id
      and old.shopify_company_id is not distinct from new.shopify_company_id
      and old.is_deleted is not distinct from new.is_deleted
    then
      return new;
    end if;
  else
    raise exception 'Unsupported trigger table: %', tg_table_name;
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

revoke all on function public.fb_reclassify_shopify_customer_orders()
  from public, anon, authenticated;
grant execute on function public.fb_reclassify_shopify_customer_orders()
  to service_role;

comment on function public.fb_reclassify_shopify_customer_orders() is
  'Reclassifies jetchill-mixology orders after customer or company-contact changes without cross-table record-field errors.';
