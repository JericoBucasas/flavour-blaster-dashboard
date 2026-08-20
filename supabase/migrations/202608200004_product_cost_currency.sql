alter table public.fb_product_variants
  add column if not exists unit_cost_currency text;
