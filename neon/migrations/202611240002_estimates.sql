-- Estimates are private, advisory, and never reserve stock or create a bill.
alter table public.customers add column estimate_approved boolean not null default false;
alter table commerce_private.server_settings add column delivery_min_paise bigint check (delivery_min_paise between 0 and 1000000000000), add column delivery_max_paise bigint check (delivery_max_paise between delivery_min_paise and 1000000000000);

create function public.estimate_settings_command(p_action text,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare actor uuid:=commerce_private.require_user(); request uuid; cached commerce_private.command_requests; target uuid; result jsonb; lo bigint; hi bigint;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'READ COMMITTED required'; end if;
 perform commerce_private.mutation_lock();
 perform commerce_private.require_admin();
 if p_action is null or p_action not in ('set_estimate_approval','set_delivery_range') then raise exception 'Unknown settings command'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>4096 then raise exception 'Invalid payload'; end if;
 request:=commerce_private.uuid_value(p_payload,'request_id');
 select * into cached from commerce_private.command_requests where actor_id=actor and request_id=request;
 if found then
  if cached.action<>p_action or cached.payload<>p_payload then raise exception 'Request ID already used'; end if;
  return cached.result;
 end if;
 if p_action='set_estimate_approval' then
  target:=commerce_private.uuid_value(p_payload,'customer_id');
  perform commerce_private.active_customer(target);
  if not (p_payload ? 'approved') then raise exception 'Missing approved'; end if;
  update public.customers set estimate_approved=commerce_private.bool_value(p_payload,'approved') where id=target;
 else
  lo:=commerce_private.int_value(p_payload,'min_paise',0,1000000000000);
  hi:=commerce_private.int_value(p_payload,'max_paise',lo,1000000000000);
  update commerce_private.server_settings set delivery_min_paise=lo,delivery_max_paise=hi where singleton;
 end if;
 result:=jsonb_build_object('id',target,'request_id',request);
 insert into public.audit_log(actor_id,action,entity_id,details) values(actor,p_action,target,jsonb_build_object('request_id',request));
 insert into commerce_private.command_requests(actor_id,request_id,action,payload,result) values(actor,request,p_action,p_payload,result);
 return result;
end $$;

create function public.cart_estimate(p_lines jsonb,p_fulfillment text) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare customer uuid; line jsonb; variant uuid; qty bigint; price bigint; total numeric:=0; seen uuid[]:='{}'; lo bigint:=0; hi bigint:=0;
begin
 perform commerce_private.require_user();
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'READ COMMITTED required'; end if;
 perform commerce_private.mutation_lock();
 customer:=commerce_private.ensure_customer();
 perform commerce_private.active_customer(customer);
 if not exists(select 1 from public.customers where id=customer and estimate_approved) then raise exception using errcode='42501',message='Shop approval required'; end if;
 if p_fulfillment is null or p_fulfillment not in ('pickup','own_driver','shop_delivery') then raise exception 'Invalid fulfillment'; end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' then raise exception 'Invalid lines'; end if;
 if jsonb_array_length(p_lines) not between 1 and 100 or octet_length(p_lines::text)>32768 then raise exception 'Invalid lines'; end if;
 for line in select value from jsonb_array_elements(p_lines) loop
  if jsonb_typeof(line)<>'object' or exists(select 1 from jsonb_object_keys(line) k where k not in ('variant_id','quantity')) then raise exception 'Invalid line'; end if;
  variant:=commerce_private.uuid_value(line,'variant_id');
  if variant=any(seen) then raise exception 'Duplicate variant'; end if;
  seen:=array_append(seen,variant);
  qty:=commerce_private.int_value(line,'quantity',1,10000);
  select v.reference_price_paise into price from public.variants v join public.products p on p.id=v.product_id join public.inventory i on i.variant_id=v.id where v.id=variant and v.active and p.active and i.on_hand-i.reserved>=qty;
  if not found then raise exception 'Item unavailable for estimate'; end if;
  total:=total+price::numeric*qty;
  if total>9000000000000000 then raise exception 'Estimate exceeds limit'; end if;
 end loop;
 if p_fulfillment='shop_delivery' then select delivery_min_paise,delivery_max_paise into lo,hi from commerce_private.server_settings where singleton; end if;
 if total+coalesce(hi,0)>9007199254740991 then raise exception 'Estimate exceeds limit'; end if;
 return jsonb_build_object('goods_total_paise',total::bigint,'delivery_min_paise',lo,'delivery_max_paise',hi,'total_min_paise',total::bigint+lo,'total_max_paise',total::bigint+hi,'approximate',true,'reserves_stock',false);
end $$;
revoke all on function public.cart_estimate(jsonb,text),public.estimate_settings_command(text,jsonb) from public,commerce_guest,commerce_worker;
grant execute on function public.cart_estimate(jsonb,text),public.estimate_settings_command(text,jsonb) to commerce_runtime;
