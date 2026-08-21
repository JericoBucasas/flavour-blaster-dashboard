-- SalesAgreement/Sale events can arrive before their order snapshot during an
-- incremental sync. Keep the Shopify order identifier and index, but do not
-- reject a valid financial event solely because fb_orders has not caught up.

alter table public.fb_sales_events
  drop constraint if exists fb_sales_events_shopify_order_id_fkey;

comment on column public.fb_sales_events.shopify_order_id is
  'Shopify order identifier retained without a hard foreign key so sales events can arrive before the corresponding order snapshot.';
