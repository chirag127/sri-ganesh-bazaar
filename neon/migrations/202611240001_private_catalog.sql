-- Public catalog is an explicit allowlist; private admin reads retain stored prices.
create or replace function public.catalog_snapshot() returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('configured',true,'products',coalesce(jsonb_agg(jsonb_build_object(
 'id',p.id,'slug',p.slug,'name',p.name,'category',p.category,'description',p.description,'image_url',p.image_url,'active',p.active,
 'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'product_id',v.product_id,'label',v.label,'weight_kg',v.weight_kg,'available',coalesce(i.on_hand-i.reserved,0)>0) order by v.label,v.id),'[]'::jsonb) from public.variants v left join public.inventory i on i.variant_id=v.id where v.product_id=p.id and v.active)
 ) order by p.name,p.id),'[]'::jsonb)) from public.products p where p.active
$$;
