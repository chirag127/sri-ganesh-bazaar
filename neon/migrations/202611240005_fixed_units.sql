-- Fixed selling units retain integer inventory; physical mass is optional metadata.
alter table public.variants alter column weight_kg drop not null;
alter table public.variants add column unit_kind text not null default 'bag'
 check (unit_kind in ('bag','jar','bottle','piece','pack'));

-- Enforce accounting-unit immutability even for privileged maintenance updates.
create function commerce_private.protect_variant_unit() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if (new.weight_kg is distinct from old.weight_kg or new.unit_kind is distinct from old.unit_kind or new.label is distinct from old.label)
 and (exists(select 1 from public.inventory_movements where variant_id=old.id)
 or exists(select 1 from public.inventory where variant_id=old.id and (on_hand<>0 or reserved<>0))
 or exists(select 1 from public.orders o cross join lateral jsonb_array_elements(o.lines) l where l->>'variant_id'=old.id::text)
 or exists(select 1 from public.quotes q cross join lateral jsonb_array_elements(q.lines) l where l->>'variant_id'=old.id::text)) then
 raise exception 'A used selling unit is immutable; create a new variant';
 end if;
 return new;
end $$;
create trigger protect_variant_unit before update on public.variants for each row execute function commerce_private.protect_variant_unit();
revoke all on function commerce_private.protect_variant_unit() from public,commerce_guest,commerce_runtime,commerce_worker;

alter function public.commerce_command(text,jsonb) rename to commerce_command_before_units;
revoke all on function public.commerce_command_before_units(text,jsonb) from public,commerce_guest,commerce_runtime,commerce_worker;
create function public.commerce_command(p_action text,p_payload jsonb) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare actor uuid; request uuid; cached commerce_private.command_requests; entity uuid; variant uuid; line jsonb; weight numeric; kind text; kept uuid[]:='{}'; result jsonb; threshold bigint; old_threshold integer;
begin
 if p_action is null or p_action not in ('save_product','set_reorder_level') then return public.commerce_command_before_units(p_action,p_payload); end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'READ COMMITTED required'; end if;
 actor:=commerce_private.require_user();
 perform commerce_private.mutation_lock();
 perform commerce_private.require_admin();
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>131072 then raise exception 'Invalid payload'; end if;
 request:=commerce_private.uuid_value(p_payload,'request_id');
 select * into cached from commerce_private.command_requests where actor_id=actor and request_id=request;
 if found then
  if cached.action<>p_action or cached.payload<>p_payload then raise exception 'Request ID already used'; end if;
  return cached.result;
 end if;
 if p_action='set_reorder_level' then
  entity:=commerce_private.uuid_value(p_payload,'variant_id');
  threshold:=commerce_private.int_value(p_payload,'reorder_level',0,10000000);
  select reorder_level into strict old_threshold from public.inventory where variant_id=entity for update;
  update public.inventory set reorder_level=threshold where variant_id=entity;
  insert into public.audit_log(actor_id,action,entity_id,details) values(actor,p_action,entity,jsonb_build_object('request_id',request,'before',old_threshold,'after',threshold));
 else
  entity:=commerce_private.uuid_value(p_payload,'id',false);
  if entity is null then
   insert into public.products(name,slug,category,description,image_url,active) values(
    commerce_private.text_value(p_payload,'name',140),commerce_private.text_value(p_payload,'slug',100),commerce_private.text_value(p_payload,'category',80),coalesce(commerce_private.text_value(p_payload,'description',4000,false),''),commerce_private.text_value(p_payload,'image_url',2048,false),commerce_private.bool_value(p_payload,'active')) returning id into entity;
  else
   perform 1 from public.products where id=entity for update;
   if not found then raise exception 'Unknown product'; end if;
   update public.products set name=commerce_private.text_value(p_payload,'name',140),slug=commerce_private.text_value(p_payload,'slug',100),category=commerce_private.text_value(p_payload,'category',80),description=coalesce(commerce_private.text_value(p_payload,'description',4000,false),''),image_url=commerce_private.text_value(p_payload,'image_url',2048,false),active=commerce_private.bool_value(p_payload,'active') where id=entity;
  end if;
  if p_payload->'variants' is null or jsonb_typeof(p_payload->'variants')<>'array' or jsonb_array_length(p_payload->'variants') not between 1 and 20 then raise exception 'Provide 1 to 20 fixed-unit variants'; end if;
  for line in select value from jsonb_array_elements(p_payload->'variants') loop
   variant:=commerce_private.uuid_value(line,'id',false);
   -- Older clients omit unit_kind; preserve existing metadata rather than resetting it.
   kind:=line->>'unit_kind';
   if kind is null then
    if variant is not null then select unit_kind into kind from public.variants where id=variant and product_id=entity; end if;
    kind:=coalesce(kind,'bag');
   end if;
   if kind not in ('bag','jar','bottle','piece','pack') then raise exception 'Invalid fixed unit'; end if;
   weight:=null;
   if line ? 'weight_kg' and line->'weight_kg'<>'null'::jsonb then
    if jsonb_typeof(line->'weight_kg')<>'number' then raise exception 'Invalid physical weight'; end if;
    weight:=(line->>'weight_kg')::numeric;
    if weight<=0 or weight>10000 or weight<>round(weight,3) then raise exception 'Invalid physical weight'; end if;
   end if;
   if variant is null then
    insert into public.variants(product_id,label,weight_kg,unit_kind,reference_price_paise) values(entity,commerce_private.text_value(line,'label',100),weight,kind,commerce_private.int_value(line,'reference_price_paise',0,1000000000000)) returning id into variant;
    insert into public.inventory(variant_id) values(variant);
   else
    if variant=any(kept) then raise exception 'Duplicate package IDs'; end if;
    perform 1 from public.variants where id=variant and product_id=entity for update;
    if not found then raise exception 'Unknown product variant'; end if;
    update public.variants set label=commerce_private.text_value(line,'label',100),weight_kg=weight,unit_kind=kind,reference_price_paise=commerce_private.int_value(line,'reference_price_paise',0,1000000000000),active=true where id=variant;
   end if;
   kept:=array_append(kept,variant);
  end loop;
  update public.variants set active=false where product_id=entity and not(id=any(kept));
  insert into public.audit_log(actor_id,action,entity_id,details) values(actor,p_action,entity,jsonb_build_object('request_id',request));
 end if;
 result:=jsonb_build_object('id',entity,'request_id',request);
 insert into commerce_private.command_requests(actor_id,request_id,action,payload,result) values(actor,request,p_action,p_payload,result);
 return result;
end $$;
revoke all on function public.commerce_command(text,jsonb) from public,commerce_guest,commerce_worker;
grant execute on function public.commerce_command(text,jsonb) to commerce_runtime;

create or replace function public.catalog_snapshot() returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('configured',true,'products',coalesce(jsonb_agg(jsonb_build_object(
 'id',p.id,'slug',p.slug,'name',p.name,'category',p.category,'description',p.description,'image_url',p.image_url,'active',p.active,
 'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'product_id',v.product_id,'label',v.label,'weight_kg',v.weight_kg,'unit_kind',v.unit_kind,'available',coalesce(i.on_hand-i.reserved,0)>0 and not coalesce(i.selling_paused,false)) order by v.label,v.id),'[]'::jsonb) from public.variants v left join public.inventory i on i.variant_id=v.id where v.product_id=p.id and v.active)
 ) order by p.name,p.id),'[]'::jsonb)) from public.products p where p.active
$$;
create or replace function commerce_private.products_json(p_all boolean default false) returns jsonb language sql stable set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('variants',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'product_id',v.product_id,'label',v.label,'weight_kg',v.weight_kg,'unit_kind',v.unit_kind,'reference_price_paise',v.reference_price_paise,'available',coalesce(i.on_hand-i.reserved,0)>0 and not coalesce(i.selling_paused,false)) order by v.label,v.id),'[]') from public.variants v left join public.inventory i on i.variant_id=v.id where v.product_id=p.id and (p_all or v.active))) order by p.name,p.id),'[]') from public.products p where p_all or p.active
$$;
