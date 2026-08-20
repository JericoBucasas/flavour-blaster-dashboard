create or replace function public.fb_finalize_customer_company_sync(p_sync_started_at timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_customers integer := 0;
  v_companies integer := 0;
  v_locations integer := 0;
  v_contacts integer := 0;
begin
  if p_sync_started_at is null or p_sync_started_at > now() + interval '5 minutes' then
    raise exception 'INVALID_CUSTOMER_COMPANY_SYNC_START';
  end if;

  update public.fb_company_contacts
     set is_deleted = true, deleted_at = coalesce(deleted_at, now()), updated_at = now()
   where not is_deleted and last_seen_at < p_sync_started_at;
  get diagnostics v_contacts = row_count;

  update public.fb_company_locations
     set is_deleted = true, deleted_at = coalesce(deleted_at, now()), updated_at = now()
   where not is_deleted and last_seen_at < p_sync_started_at;
  get diagnostics v_locations = row_count;

  update public.fb_companies
     set is_deleted = true, deleted_at = coalesce(deleted_at, now()), updated_at = now()
   where not is_deleted and last_seen_at < p_sync_started_at;
  get diagnostics v_companies = row_count;

  update public.fb_customers
     set is_deleted = true, deleted_at = coalesce(deleted_at, now()), updated_at = now()
   where not is_deleted
     and raw_record <> '{}'::jsonb
     and last_seen_at < p_sync_started_at;
  get diagnostics v_customers = row_count;

  return jsonb_build_object(
    'deleted_customers', v_customers,
    'deleted_companies', v_companies,
    'deleted_locations', v_locations,
    'deleted_contacts', v_contacts
  );
end;
$$;
