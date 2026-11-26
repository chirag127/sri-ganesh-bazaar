-- Private unmet demand is separate from orders, inventory and financial records.
create table public.product_requests (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id),
 description text not null check(length(description) between 1 and 2000),
 status text not null default 'pending' check(status in ('pending','resolved')),
 resolution text not null default '' check(length(resolution)<=2000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.product_requests enable row level security;
revoke all on public.product_requests from public,commerce_guest,commerce_runtime,commerce_worker;
create index on public.product_requests(customer_id,created_at desc,id);
create function public.product_request_command(p_action text,p_payload jsonb) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare actor uuid:=commerce_private.require_user(); customer uuid; request uuid; target uuid; cached commerce_private.command_requests; result jsonb; request_text text; state text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'READ COMMITTED required'; end if;
 perform commerce_private.mutation_lock();
 if p_action is null or p_action not in ('create','update') then raise exception 'Invalid action'; end if;
 if p_action='update' then perform commerce_private.require_admin(); end if;
 customer:=commerce_private.ensure_customer(); perform commerce_private.active_customer(customer);
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>16384 then raise exception 'Invalid payload'; end if;
 request:=commerce_private.uuid_value(p_payload,'request_id');
 select * into cached from commerce_private.command_requests where actor_id=actor and request_id=request;
 if found then
  if cached.action<>'product_request_'||p_action or cached.payload<>p_payload then raise exception 'Request ID already used'; end if;
  return cached.result;
 end if;
 if p_action='create' then
  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('request_id','description')) then raise exception 'Invalid fields'; end if;
  request_text:=commerce_private.text_value(p_payload,'description',2000,true);
  insert into public.product_requests(customer_id,description) values(customer,request_text) returning id into target;
 else
  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('request_id','id','status','resolution')) then raise exception 'Invalid fields'; end if;
  target:=commerce_private.uuid_value(p_payload,'id'); state:=commerce_private.text_value(p_payload,'status',20,true);
  if state not in ('pending','resolved') then raise exception 'Invalid status'; end if;
  request_text:=commerce_private.text_value(p_payload,'resolution',2000,true);
  update public.product_requests set status=state,resolution=request_text,updated_at=now() where id=target;
  if not found then raise exception 'Request not found'; end if;
 end if;
 result:=jsonb_build_object('id',target,'request_id',request);
 insert into public.audit_log(actor_id,action,entity_id,details) values(actor,'product_request_'||p_action,target,jsonb_build_object('request_id',request));
 insert into commerce_private.command_requests(actor_id,request_id,action,payload,result) values(actor,request,'product_request_'||p_action,p_payload,result);
 return result;
end $$;
create function public.product_requests_page(p_admin boolean,p_limit integer,p_offset integer) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare customer uuid; items jsonb; total bigint;
begin
 perform commerce_private.require_user();
 if p_admin is null or p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset not between 0 and 1000000 then raise exception 'Invalid pagination'; end if;
 if p_admin then perform commerce_private.require_admin(); end if;
 customer:=commerce_private.ensure_customer(); perform commerce_private.active_customer(customer);
 select count(*) into total from public.product_requests r where p_admin or r.customer_id=customer;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into items from (select * from public.product_requests r where p_admin or r.customer_id=customer order by created_at desc,id limit p_limit offset p_offset) r;
 return jsonb_build_object('items',items,'total',total,'offset',p_offset,'limit',p_limit);
end $$;
revoke all on function public.product_request_command(text,jsonb),public.product_requests_page(boolean,integer,integer) from public,commerce_guest,commerce_worker;
grant execute on function public.product_request_command(text,jsonb),public.product_requests_page(boolean,integer,integer) to commerce_runtime;
