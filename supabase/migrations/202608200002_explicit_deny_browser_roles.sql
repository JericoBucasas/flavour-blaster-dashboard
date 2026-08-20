-- Make the server-only access model explicit to Supabase's security advisor.
-- service_role bypasses RLS and retains only the grants from the base migration.

create policy fb_orders_deny_browser_roles
  on public.fb_orders as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy fb_products_deny_browser_roles
  on public.fb_products as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy fb_product_variants_deny_browser_roles
  on public.fb_product_variants as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy fb_order_lines_deny_browser_roles
  on public.fb_order_lines as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy fb_customers_deny_browser_roles
  on public.fb_customers as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy fb_sync_state_deny_browser_roles
  on public.fb_sync_state as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy fb_sync_runs_deny_browser_roles
  on public.fb_sync_runs as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy fb_manual_overrides_deny_browser_roles
  on public.fb_manual_overrides as restrictive for all to anon, authenticated
  using (false) with check (false);
