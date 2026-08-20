-- Keep the dashboard payload fast while retaining the full Shopify record in the tables.
-- Large HTML, media and metafield bodies stay server-side; operational fields and counts are returned.

create or replace function public.fb_product_catalog()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'generatedAt', now(),
    'lastSyncedAt', (select max(p.synced_at) from public.fb_products p where not p.is_deleted),
    'summary', jsonb_build_object(
      'products', (select count(*) from public.fb_products p where not p.is_deleted),
      'activeProducts', (select count(*) from public.fb_products p where not p.is_deleted and p.status = 'active'),
      'variants', (select count(*) from public.fb_product_variants v where not v.is_deleted),
      'inventory', (select coalesce(sum(v.inventory_quantity), 0) from public.fb_product_variants v where not v.is_deleted),
      'locations', (select count(distinct l.shopify_location_id) from public.fb_product_inventory_levels l where not l.is_deleted),
      'variantsWithCost', (select count(*) from public.fb_product_variants v where not v.is_deleted and v.unit_cost is not null)
    ),
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'shopify_product_id', p.shopify_product_id,
          'title', p.title,
          'description_excerpt', left(regexp_replace(coalesce(p.description_html, ''), '<[^>]+>', ' ', 'g'), 300),
          'handle', p.handle,
          'status', p.status,
          'vendor', p.vendor,
          'product_type', p.product_type,
          'tags', p.tags,
          'image_url', p.image_url,
          'template_suffix', p.template_suffix,
          'published_at', p.published_at,
          'shopify_created_at', p.shopify_created_at,
          'shopify_updated_at', p.shopify_updated_at,
          'seo_title', p.seo_title,
          'seo_description', p.seo_description,
          'options', p.options,
          'collection_names', coalesce((
            select jsonb_agg(c.item->>'title' order by c.item->>'title')
            from jsonb_array_elements(p.collections) c(item)
          ), '[]'::jsonb),
          'media_count', jsonb_array_length(p.media),
          'metafield_count', jsonb_array_length(p.metafields),
          'last_seen_at', p.last_seen_at,
          'synced_at', p.synced_at,
          'variants', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'shopify_variant_id', v.shopify_variant_id,
                'title', v.title,
                'sku', v.sku,
                'barcode', v.barcode,
                'position', v.position,
                'price', v.price,
                'compare_at_price', v.compare_at_price,
                'unit_cost', v.unit_cost,
                'unit_cost_currency', v.unit_cost_currency,
                'inventory_quantity', v.inventory_quantity,
                'inventory_policy', v.inventory_policy,
                'inventory_management', v.inventory_management,
                'taxable', v.taxable,
                'image_url', v.image_url,
                'inventory_item_id', v.inventory_item_id,
                'selected_options', v.selected_options,
                'weight', v.weight,
                'weight_unit', v.weight_unit,
                'requires_shipping', v.requires_shipping,
                'tracked', v.tracked,
                'shopify_created_at', v.shopify_created_at,
                'shopify_updated_at', v.shopify_updated_at,
                'last_seen_at', v.last_seen_at,
                'synced_at', v.synced_at,
                'inventory_locations', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'shopify_location_id', l.shopify_location_id,
                      'location_name', l.location_name,
                      'available', l.available,
                      'shopify_updated_at', l.shopify_updated_at,
                      'synced_at', l.synced_at
                    ) order by l.location_name, l.shopify_location_id
                  )
                  from public.fb_product_inventory_levels l
                  where l.shopify_variant_id = v.shopify_variant_id and not l.is_deleted
                ), '[]'::jsonb)
              ) order by v.position nulls last, v.shopify_variant_id
            )
            from public.fb_product_variants v
            where v.shopify_product_id = p.shopify_product_id and not v.is_deleted
          ), '[]'::jsonb),
          'title_history', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'old_title', h.old_title,
                'new_title', h.new_title,
                'shopify_updated_at', h.shopify_updated_at,
                'changed_at', h.changed_at
              ) order by h.changed_at desc
            )
            from public.fb_product_title_history h
            where h.shopify_product_id = p.shopify_product_id
          ), '[]'::jsonb)
        ) order by
          case p.status when 'active' then 0 when 'draft' then 1 when 'archived' then 2 else 3 end,
          p.title,
          p.shopify_product_id
      )
      from public.fb_products p
      where not p.is_deleted
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.fb_product_catalog() from public, anon, authenticated;
grant execute on function public.fb_product_catalog() to service_role;
