create function commerce_private.customer_json(p_id uuid) returns jsonb language sql stable set search_path=pg_catalog as $$
 select (to_jsonb(c)-'phone_version'-'deleted_at')||jsonb_build_object('balance_paise',commerce_private.balance(c.id)) from public.customers c where id=p_id
$$;
create function commerce_private.order_json(p_id uuid) returns jsonb language sql stable set search_path=pg_catalog as $$
 select (to_jsonb(o)-'current_quote_id'-'handed_over_at')||jsonb_build_object('quote',(select to_jsonb(q) from public.quotes q where q.id=o.current_quote_id),'paid_paise',commerce_private.paid(o.id),'customer_name',c.name,'goods_released_at',o.handed_over_at) from public.orders o join public.customers c on c.id=o.customer_id where o.id=p_id
$$;
create function commerce_private.products_json(p_all boolean default false) returns jsonb language sql stable set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('variants',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'product_id',v.product_id,'label',v.label,'weight_kg',v.weight_kg,'reference_price_paise',v.reference_price_paise,'available',coalesce(i.on_hand-i.reserved,0)>0) order by v.label),'[]') from public.variants v left join public.inventory i on i.variant_id=v.id where v.product_id=p.id and (p_all or v.active))) order by p.name),'[]') from public.products p where p_all or p.active
$$;
create function public.catalog_snapshot() returns jsonb language sql stable security definer set search_path=pg_catalog as $$ select jsonb_build_object('products',commerce_private.products_json(false),'configured',true) $$;
create function public.commerce_page(p_entity text,p_search text default '',p_limit integer default 50,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare u uuid:=commerce_private.require_user(); staff boolean:=commerce_private.is_admin(); c uuid; items jsonb; total bigint; rel text; needle text;
begin
 if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset not between 0 and 1000000 or p_search is null or length(p_search)>120 then raise exception 'Invalid pagination'; end if;
 if p_entity not in ('customers','orders','ledger','bills','submissions') or p_entity is null then raise exception 'Invalid entity'; end if;
 if p_entity='customers' and not staff then raise exception using errcode='42501',message='Administrator access required'; end if;
 c:=commerce_private.ensure_customer(); needle:='%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%';
 if p_entity='customers' then
  select count(*) into total from public.customers x where x.name ilike needle or x.phone ilike needle or x.email ilike needle;
  select coalesce(jsonb_agg(commerce_private.customer_json(x.id)),'[]') into items from (select id from public.customers x where x.name ilike needle or x.phone ilike needle or x.email ilike needle order by created_at desc,id limit p_limit offset p_offset) x;
 elsif p_entity='orders' then
  select count(*) into total from public.orders x where (staff or x.customer_id=c) and (x.number ilike needle or x.customer_id::text=p_search);
  select coalesce(jsonb_agg(commerce_private.order_json(x.id)),'[]') into items from (select id from public.orders x where (staff or x.customer_id=c) and (x.number ilike needle or x.customer_id::text=p_search) order by created_at desc,id limit p_limit offset p_offset) x;
 else
  rel:=case p_entity when 'ledger' then 'ledger_entries' when 'submissions' then 'payment_submissions' else 'bills' end;
  execute format('select count(*) from public.%I x where ($1 or customer_id=$2) and ($3='''' or customer_id::text=$3 or order_id::text=$3)',rel) into total using staff,c,p_search;
  execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]'') from (select * from public.%I where ($1 or customer_id=$2) and ($3='''' or customer_id::text=$3 or order_id::text=$3) order by %I desc,id limit $4 offset $5) x',rel,case when rel='bills' then 'issued_at' else 'created_at' end) into items using staff,c,p_search,p_limit,p_offset;
 end if;
 return jsonb_build_object('items',items,'total',total,'offset',p_offset,'limit',p_limit);
end $$;
create function commerce_private.related(p_customer uuid,p_order uuid default null) returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare result jsonb:='{}'; t text; rows jsonb;
begin
 foreach t in array array['bills','receipts','payment_submissions','returns','refund_requests'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]'') from (select * from public.%I where customer_id=$1 and ($2 is null or order_id=$2) order by %I desc,id limit 200) x',t,case when t in ('bills','receipts') then 'issued_at' else 'created_at' end) into rows using p_customer,p_order;
  if t='receipts' then select coalesce(jsonb_agg(x||jsonb_build_object('payment_id',x->'id','received_by',x->'collector')),'[]') into rows from jsonb_array_elements(rows) x where x->>'kind'<>'driver_remittance'; end if;
  result:=result||jsonb_build_object(t,rows);
 end loop;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (select * from public.deletion_requests where customer_id=p_customer order by created_at desc,id limit 200) x;
 result:=result||jsonb_build_object('deletion_requests',rows);
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (select r.id,r.id payment_id,r.customer_id,r.order_id,r.amount_paise,d.driver_name,d.driver_phone,d.created_at,coalesce(-sum(e.amount_paise) filter(where e.amount_paise<0),0) remitted_paise,case when sum(e.amount_paise)=0 then 'remitted' when sum(e.amount_paise)=r.amount_paise then 'pending' else 'partial' end status from public.receipts r join public.driver_cash_entries d on d.receipt_id=r.id and d.amount_paise>0 join public.driver_cash_entries e on e.payment_id=r.id where r.customer_id=p_customer and (p_order is null or r.order_id=p_order) group by r.id,d.driver_name,d.driver_phone,d.created_at order by d.created_at desc limit 200) x;
 return result||jsonb_build_object('driver_collections',rows);
end $$;
create function public.customer_workspace() returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c uuid:=commerce_private.ensure_customer(); orders jsonb; ledger jsonb;
begin
 select coalesce(jsonb_agg(commerce_private.order_json(x.id)),'[]') into orders from (select id from public.orders where customer_id=c order by created_at desc,id limit 200) x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into ledger from (select * from public.ledger_entries where customer_id=c order by created_at desc,id limit 200) x;
 return commerce_private.related(c)||jsonb_build_object('customer',commerce_private.customer_json(c),'orders',orders,'ledger',ledger,'balance_paise',commerce_private.balance(c),'is_admin',commerce_private.is_admin());
end $$;
create function public.admin_workspace() returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb; rows jsonb; t text;
begin
 perform commerce_private.require_admin();
 result:=jsonb_build_object('customers',public.commerce_page('customers','',200,0)->'items','orders',public.commerce_page('orders','',200,0)->'items','ledger',public.commerce_page('ledger','',200,0)->'items','bills',public.commerce_page('bills','',200,0)->'items','payment_submissions',public.commerce_page('submissions','',200,0)->'items','products',commerce_private.products_json(true));
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (select i.*,p.name product_name,v.label,i.on_hand-i.reserved available from public.inventory i join public.variants v on v.id=i.variant_id join public.products p on p.id=v.product_id) x;
 result:=result||jsonb_build_object('inventory',rows);
 select coalesce(jsonb_agg(jsonb_build_object('user_id',a.user_id,'email',u.email)),'[]') into rows from public.admins a join commerce_identity.users u on u.id=a.user_id;
 result:=result||jsonb_build_object('admins',rows);
 foreach t in array array['receipts','deletion_requests','returns','refund_requests','audit_log'] loop
 execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]'') from (select * from public.%I order by %I desc,id limit 200) x',t,case when t='receipts' then 'issued_at' else 'created_at' end) into rows;
 if t='receipts' then select coalesce(jsonb_agg(x||jsonb_build_object('payment_id',x->'id','received_by',x->'collector')),'[]') into rows from jsonb_array_elements(rows) x where x->>'kind'<>'driver_remittance'; end if;
 result:=result||jsonb_build_object(case when t='audit_log' then 'audit' else t end,rows);
 end loop;
 return result;
end $$;
create function public.customer_orders(p_offset integer,p_limit integer) returns jsonb language sql security definer set search_path=pg_catalog as $$ select public.commerce_page('orders','',p_limit,p_offset) $$;
create function public.customer_order_detail(p_order_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c uuid;
begin
 perform commerce_private.require_user();
 if not commerce_private.owns_order(p_order_id) then raise exception using errcode='42501',message='Order access denied'; end if;
 select customer_id into strict c from public.orders where id=p_order_id;
 return commerce_private.related(c,p_order_id)||jsonb_build_object('order',commerce_private.order_json(p_order_id),'customer',commerce_private.customer_json(c),'balance_paise',commerce_private.balance(c));
end $$;
create function public.admin_order_detail(p_order_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c uuid;
begin
 perform commerce_private.require_admin(); select customer_id into strict c from public.orders where id=p_order_id;
 return commerce_private.related(c,p_order_id)||jsonb_build_object('order',commerce_private.order_json(p_order_id),'customer',commerce_private.customer_json(c),'balance_paise',commerce_private.balance(c));
end $$;
create function public.admin_customer_detail(p_customer_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare orders jsonb; ledger jsonb;
begin
 perform commerce_private.require_admin(); perform commerce_private.active_customer(p_customer_id);
 select coalesce(jsonb_agg(commerce_private.order_json(x.id)),'[]') into orders from (select id from public.orders where customer_id=p_customer_id order by created_at desc,id limit 200) x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into ledger from (select * from public.ledger_entries where customer_id=p_customer_id order by created_at desc,id limit 200) x;
 return commerce_private.related(p_customer_id)||jsonb_build_object('customer',commerce_private.customer_json(p_customer_id),'balance_paise',commerce_private.balance(p_customer_id),'orders',orders,'ledger',ledger);
end $$;
revoke all on all functions in schema commerce_private from public,commerce_guest,commerce_runtime,commerce_worker;
revoke all on function public.catalog_snapshot(),public.commerce_page(text,text,integer,integer),public.customer_workspace(),public.admin_workspace(),public.customer_orders(integer,integer),public.customer_order_detail(uuid),public.admin_order_detail(uuid),public.admin_customer_detail(uuid) from public,commerce_guest,commerce_runtime,commerce_worker;
grant execute on function public.catalog_snapshot() to commerce_guest,commerce_runtime;
grant execute on function public.commerce_page(text,text,integer,integer),public.customer_workspace(),public.admin_workspace(),public.customer_orders(integer,integer),public.customer_order_detail(uuid),public.admin_order_detail(uuid),public.admin_customer_detail(uuid) to commerce_runtime;
