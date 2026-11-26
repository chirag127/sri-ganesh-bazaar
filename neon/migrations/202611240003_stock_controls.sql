-- A selling pause is independent of publication and physical inventory.
alter table public.inventory add column selling_paused boolean not null default false;
alter function public.commerce_command(text,jsonb) rename to commerce_command_before_stock;
revoke all on function public.commerce_command_before_stock(text,jsonb) from public,commerce_guest,commerce_runtime,commerce_worker;
create function public.commerce_command(p_action text,p_payload jsonb) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare actor uuid; request uuid; cached commerce_private.command_requests; inv public.inventory; variant uuid; qty bigint; expected bigint; reason text; result jsonb; line jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'READ COMMITTED required'; end if;
 actor:=commerce_private.require_user();
 perform commerce_private.mutation_lock();
 if p_action in ('count_stock','set_stock_availability') then
  perform commerce_private.require_admin();
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>8192 then raise exception 'Invalid payload'; end if;
  request:=commerce_private.uuid_value(p_payload,'request_id');
  select * into cached from commerce_private.command_requests where actor_id=actor and request_id=request;
  if found then
   if cached.action<>p_action or cached.payload<>p_payload then raise exception 'Request ID already used'; end if;
   return cached.result;
  end if;
  variant:=commerce_private.uuid_value(p_payload,'variant_id');
  reason:=commerce_private.text_value(p_payload,'reason',2000);
  select * into strict inv from public.inventory where variant_id=variant for update;
  if p_action='count_stock' then
   expected:=commerce_private.int_value(p_payload,'expected_on_hand',0,10000000);
   if inv.on_hand<>expected then raise exception 'Stock changed; refresh before counting again'; end if;
   qty:=commerce_private.int_value(p_payload,'counted_on_hand',0,10000000);
   if qty<inv.reserved then raise exception 'Count cannot consume reserved stock'; end if;
   update public.inventory set on_hand=qty where variant_id=variant;
   -- A physical count correction retains existing valuation, unlike a purchase receipt.
   insert into public.inventory_movements(variant_id,quantity_delta,unit_cost_paise,reason,actor_id) values(variant,qty-inv.on_hand,inv.average_cost_paise,reason,actor);
  else
   if not (p_payload ? 'available') then raise exception 'Missing availability'; end if;
   update public.inventory set selling_paused=not commerce_private.bool_value(p_payload,'available') where variant_id=variant;
  end if;
  result:=jsonb_build_object('id',variant,'request_id',request);
  insert into public.audit_log(actor_id,action,entity_id,details) values(actor,p_action,variant,p_payload);
  insert into commerce_private.command_requests(actor_id,request_id,action,payload,result) values(actor,request,p_action,p_payload,result);
  return result;
 end if;
 -- Existing commands keep their original authorization and idempotency checks.
 if p_action in ('submit_enquiry','counter_sale','issue_quote') then
  for line in select value from jsonb_array_elements(p_payload->'lines') loop
   if exists(select 1 from public.inventory where variant_id=commerce_private.uuid_value(line,'variant_id') and selling_paused) then raise exception 'Item marked unavailable'; end if;
  end loop;
 end if;
 return public.commerce_command_before_stock(p_action,p_payload);
end $$;
revoke all on function public.commerce_command(text,jsonb) from public,commerce_guest,commerce_worker;
grant execute on function public.commerce_command(text,jsonb) to commerce_runtime;

-- Keep the existing private-price allowlist, changing only the public availability bit.
alter function public.catalog_snapshot() rename to catalog_snapshot_before_stock;
revoke all on function public.catalog_snapshot_before_stock() from public,commerce_guest,commerce_runtime,commerce_worker;
create function public.catalog_snapshot() returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('configured',true,'products',coalesce(jsonb_agg(p||jsonb_build_object('variants',(select coalesce(jsonb_agg(v||jsonb_build_object('available',(v->>'available')::boolean and not coalesce(i.selling_paused,false))),'[]'::jsonb) from jsonb_array_elements(p->'variants') v left join public.inventory i on i.variant_id=(v->>'id')::uuid))),'[]'::jsonb)) from jsonb_array_elements(public.catalog_snapshot_before_stock()->'products') p
$$;
revoke all on function public.catalog_snapshot() from public,commerce_worker;
grant execute on function public.catalog_snapshot() to commerce_guest,commerce_runtime;

-- Reject a pause even for quotes issued before the owner changed availability.
alter function commerce_private.accept(uuid,uuid,text) rename to accept_before_stock;
create function commerce_private.accept(p_order uuid,p_quote uuid,p_note text) returns uuid language plpgsql set search_path=pg_catalog as $$
begin
 if exists(select 1 from public.quotes q cross join lateral jsonb_array_elements(q.lines) l join public.inventory i on i.variant_id=(l->>'variant_id')::uuid where q.id=p_quote and i.selling_paused) then raise exception 'Item marked unavailable'; end if;
 return commerce_private.accept_before_stock(p_order,p_quote,p_note);
end $$;
alter function public.cart_estimate(jsonb,text) rename to cart_estimate_before_stock;
revoke all on function public.cart_estimate_before_stock(jsonb,text) from public,commerce_guest,commerce_runtime,commerce_worker;
create function public.cart_estimate(p_lines jsonb,p_fulfillment text) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 result:=public.cart_estimate_before_stock(p_lines,p_fulfillment);
 if exists(select 1 from jsonb_array_elements(p_lines) l join public.inventory i on i.variant_id=(l->>'variant_id')::uuid where i.selling_paused) then raise exception 'Item marked unavailable'; end if;
 return result;
end $$;
revoke all on function public.cart_estimate(jsonb,text) from public,commerce_guest,commerce_worker;
grant execute on function public.cart_estimate(jsonb,text) to commerce_runtime;
revoke all on function commerce_private.accept(uuid,uuid,text),commerce_private.accept_before_stock(uuid,uuid,text) from public,commerce_guest,commerce_runtime,commerce_worker;
