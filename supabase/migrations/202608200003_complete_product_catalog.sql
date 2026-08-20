-- Complete, current-state Shopify product catalog support.
-- Shopify remains the source of truth; browser roles stay explicitly denied.

alter table public.fb_products
  add column if not exists description_html text,
  add column if not exists template_suffix text,
  add column if not exists seo_title text,
  add column if not exists seo_description text,
  add column if not exists options jsonb not null default '[]'::jsonb,
  add column if not exists media jsonb not null default '[]'::jsonb,
  add column if not exists collections jsonb not null default '[]'::jsonb,
  add column if not exists metafields jsonb not null default '[]'::jsonb,
  add column if not exists last_seen_at timestamptz,
  add column if not exists is_deleted boolean not null default false,
  add column if not exists deleted_at timestamptz;

alter table public.fb_product_variants
  add column if not exists inventory_item_id bigint,
  add column if not exists selected_options jsonb not null default '[]'::jsonb,
  add column if not exists position integer,
  add column if not exists weight numeric(16,4),
  add column if not exists weight_unit text,
  add column if not exists requires_shipping boolean,
  add column if not exists tracked boolean,
  add column if not exists last_seen_at timestamptz,
  add column if not exists is_deleted boolean not null default false,
  add column if not exists deleted_at timestamptz;

create index if not exists fb_products_live_status_idx
  on public.fb_products (is_deleted, status, title);
create index if not exists fb_product_variants_inventory_item_idx
  on public.fb_product_variants (inventory_item_id)
  where inventory_item_id is not null;
create index if not exists fb_product_variants_live_product_idx
  on public.fb_product_variants (is_deleted, shopify_product_id);

create table if not exists public.fb_product_inventory_levels (
  shopify_variant_id bigint not null references public.fb_product_variants(shopify_variant_id) on delete cascade,
  shopify_inventory_item_id bigint not null,
  shopify_location_id bigint not null,
  location_name text,
  available integer,
  shopify_updated_at timestamptz,
  last_seen_at timestamptz not null,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (shopify_variant_id, shopify_location_id)
);

create index if not exists fb_product_inventory_levels_location_idx
  on public.fb_product_inventory_levels (shopify_location_id, is_deleted);
create index if not exists fb_product_inventory_levels_item_idx
  on public.fb_product_inventory_levels (shopify_inventory_item_id, is_deleted);

create table if not exists public.fb_product_title_history (
  id bigint generated always as identity primary key,
  shopify_product_id bigint not null references public.fb_products(shopify_product_id) on delete cascade,
  old_title text not null,
  new_title text not null,
  shopify_updated_at timestamptz,
  changed_at timestamptz not null default now()
);

create index if not exists fb_product_title_history_product_idx
  on public.fb_product_title_history (shopify_product_id, changed_at desc);

create or replace function public.fb_record_product_title_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.title is distinct from new.title then
    insert into public.fb_product_title_history
      (shopify_product_id, old_title, new_title, shopify_updated_at)
    values
      (new.shopify_product_id, old.title, new.title, new.shopify_updated_at);
  end if;
  return new;
end;
$$;

drop trigger if exists fb_products_title_history_trg on public.fb_products;
create trigger fb_products_title_history_trg
after update of title on public.fb_products
for each row execute function public.fb_record_product_title_change();

create or replace function public.fb_finalize_product_catalog_sync(p_sync_started_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_products integer := 0;
  v_variants integer := 0;
  v_levels integer := 0;
begin
  if p_sync_started_at is null or p_sync_started_at > now() + interval '5 minutes' then
    raise exception 'INVALID_PRODUCT_SYNC_START';
  end if;

  update public.fb_product_inventory_levels
     set is_deleted = true,
         deleted_at = coalesce(deleted_at, now()),
         updated_at = now()
   where is_deleted = false
     and last_seen_at < p_sync_started_at;
  get diagnostics v_levels = row_count;

  update public.fb_product_variants
     set is_deleted = true,
         deleted_at = coalesce(deleted_at, now()),
         updated_at = now()
   where is_deleted = false
     and (last_seen_at is null or last_seen_at < p_sync_started_at);
  get diagnostics v_variants = row_count;

  update public.fb_products
     set is_deleted = true,
         deleted_at = coalesce(deleted_at, now()),
         updated_at = now()
   where is_deleted = false
     and (last_seen_at is null or last_seen_at < p_sync_started_at);
  get diagnostics v_products = row_count;

  return jsonb_build_object(
    'deleted_products', v_products,
    'deleted_variants', v_variants,
    'deleted_inventory_levels', v_levels
  );
end;
$$;

alter table public.fb_product_inventory_levels enable row level security;
alter table public.fb_product_title_history enable row level security;

revoke all on table public.fb_product_inventory_levels from public, anon, authenticated;
revoke all on table public.fb_product_title_history from public, anon, authenticated;
revoke all on sequence public.fb_product_title_history_id_seq from public, anon, authenticated;
revoke execute on function public.fb_record_product_title_change() from public, anon, authenticated;
revoke execute on function public.fb_finalize_product_catalog_sync(timestamptz) from public, anon, authenticated;

grant select, insert, update, delete on table public.fb_product_inventory_levels to service_role;
grant select, insert, update, delete on table public.fb_product_title_history to service_role;
grant usage, select on sequence public.fb_product_title_history_id_seq to service_role;
grant execute on function public.fb_record_product_title_change() to service_role;
grant execute on function public.fb_finalize_product_catalog_sync(timestamptz) to service_role;

drop policy if exists fb_product_inventory_levels_deny_browser_roles on public.fb_product_inventory_levels;
create policy fb_product_inventory_levels_deny_browser_roles
  on public.fb_product_inventory_levels as restrictive for all to anon, authenticated
  using (false) with check (false);

drop policy if exists fb_product_title_history_deny_browser_roles on public.fb_product_title_history;
create policy fb_product_title_history_deny_browser_roles
  on public.fb_product_title_history as restrictive for all to anon, authenticated
  using (false) with check (false);
