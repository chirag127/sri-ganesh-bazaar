-- Private helpers are not RPCs. Every SECURITY DEFINER pins its search path.
create function commerce_private.require_user() returns uuid
language plpgsql stable security definer set search_path = pg_catalog as $$
declare u uuid := commerce_identity.uid();
begin
  if u is null or coalesce(commerce_identity.claims()->>'role','') <> 'commerce_runtime'
    or coalesce((commerce_identity.claims()->>'is_anonymous')::boolean,false)
    or not exists (select 1 from commerce_identity.users a where a.id=u and
      (a.raw_app_meta_data->>'provider'='google' or a.raw_app_meta_data->'providers' @> '["google"]'::jsonb)) then
    raise exception using errcode='42501', message='Sign in with Google to continue';
  end if;
  return u;
end;
$$;
create function commerce_private.is_admin() returns boolean
language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(commerce_identity.claims()->>'role','')='commerce_runtime'
    and exists (select 1 from public.admins s join commerce_identity.users u on u.id=s.user_id
      where s.user_id=commerce_identity.uid() and (u.raw_app_meta_data->>'provider'='google'
        or u.raw_app_meta_data->'providers' @> '["google"]'::jsonb))
$$;
create function commerce_private.require_admin() returns uuid
language plpgsql stable security definer set search_path = pg_catalog as $$
declare u uuid := commerce_private.require_user();
begin
  if not commerce_private.is_admin() then
    raise exception using errcode='42501', message='Administrator access required';
  end if;
  return u;
end;
$$;
create function commerce_private.require_service() returns void
language plpgsql stable security definer set search_path = pg_catalog as $$
begin
  if coalesce(commerce_identity.claims()->>'role','') <> 'commerce_worker' then
    raise exception using errcode='42501', message='Service access required';
  end if;
end;
$$;
-- One shop, at most hundreds of writes/day: serialize business mutations rather
-- than risk conflicting order/customer/inventory lock orders across commands.
-- Readers do not take this lock. Row locks additionally protect inventory rows.
create function commerce_private.mutation_lock() returns void
language sql volatile set search_path = pg_catalog as $$
  select pg_advisory_xact_lock(741821,1)
$$;
create function commerce_private.text_value(p jsonb,k text,n integer,required boolean default true) returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare v text;
begin
  if p->k is null or p->k='null'::jsonb then
    if required then raise exception 'Missing %',k; end if;
    return null;
  end if;
  if jsonb_typeof(p->k)<>'string' then raise exception 'Invalid %',k; end if;
  v := btrim(p->>k);
  if length(v)>n or (required and v='') then raise exception 'Invalid %',k; end if;
  return nullif(v,'');
end;
$$;
create function commerce_private.int_value(p jsonb,k text,lo bigint,hi bigint,default_value bigint default null) returns bigint
language plpgsql immutable set search_path = pg_catalog as $$
declare v numeric;
begin
  if not (p ? k) or p->k='null'::jsonb then
    if default_value is null then raise exception 'Missing %',k; end if;
    return default_value;
  end if;
  if jsonb_typeof(p->k)<>'number' or (p->>k)!~'^-?[0-9]+$' then
    raise exception '% must be a whole number',k;
  end if;
  v := (p->>k)::numeric;
  if v<lo or v>hi then raise exception '% is outside the allowed range',k; end if;
  return v::bigint;
end;
$$;
create function commerce_private.bool_value(p jsonb,k text,d boolean default false) returns boolean
language plpgsql immutable set search_path = pg_catalog as $$
begin
  if not (p ? k) then return d; end if;
  if jsonb_typeof(p->k)<>'boolean' then raise exception 'Invalid %',k; end if;
  return (p->>k)::boolean;
end;
$$;
create function commerce_private.uuid_value(p jsonb,k text,required boolean default true) returns uuid
language plpgsql immutable set search_path = pg_catalog as $$
declare v text := commerce_private.text_value(p,k,36,required);
begin
  if v is null then return null; end if;
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid %',k; end if;
  return v::uuid;
end;
$$;
create function commerce_private.phone_value(p text) returns text
language plpgsql immutable set search_path = pg_catalog as $$
begin
  if p is not null and p !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Use an international phone number including +'; end if;
  return p;
end;
$$;
create function commerce_private.ensure_customer() returns uuid
language plpgsql security definer set search_path = pg_catalog as $$
declare u uuid := commerce_private.require_user(); c uuid; a record;
begin
  select id into c from public.customers where auth_user_id=u;
  if c is not null then return c; end if;
  -- A completed deletion is a durable tombstone, not permission to recreate a
  -- profile from auth metadata on the very next workspace read.
  select customer_id into c from public.deletion_requests
    where user_id=u and status='completed' order by created_at desc limit 1;
  if c is not null then return c; end if;
  select email, raw_user_meta_data into a from commerce_identity.users where id=u;
  insert into public.customers(auth_user_id,name,email)
    values(u,left(coalesce(nullif(btrim(a.raw_user_meta_data->>'full_name'),''),'Customer'),120),a.email)
    on conflict(auth_user_id) do nothing returning id into c;
  if c is null then select id into c from public.customers where auth_user_id=u; end if;
  return c;
end;
$$;
create function commerce_private.active_customer(p_customer uuid) returns void
language plpgsql stable set search_path = pg_catalog as $$
begin
  if not exists(select 1 from public.customers where id=p_customer and deleted_at is null) then
    raise exception 'Customer is missing or has been deleted';
  end if;
end;
$$;
create function commerce_private.owns_customer(p_customer uuid) returns boolean
language sql stable security definer set search_path = pg_catalog as $$
  select exists(select 1 from public.customers where id=p_customer and auth_user_id=commerce_identity.uid() and deleted_at is null)
$$;
create function commerce_private.owns_order(p_order uuid) returns boolean
language sql stable security definer set search_path = pg_catalog as $$
  select exists(select 1 from public.orders o join public.customers c on c.id=o.customer_id
    where o.id=p_order and c.auth_user_id=commerce_identity.uid() and c.deleted_at is null)
$$;
create function commerce_private.balance(p_customer uuid) returns bigint
language sql stable set search_path = pg_catalog as $$
  select coalesce(sum(amount_paise),0)::bigint from public.ledger_entries where customer_id=p_customer
$$;
create function commerce_private.paid(p_order uuid) returns bigint
language sql stable set search_path = pg_catalog as $$
  select coalesce(sum(amount_paise),0)::bigint from public.payment_allocations where order_id=p_order
$$;
create function commerce_private.net_total(p_order uuid) returns bigint
language sql stable set search_path = pg_catalog as $$
  select greatest(0,q.total_paise - coalesce((select sum(amount_paise) from public.returns where order_id=o.id),0))::bigint
  from public.orders o join public.quotes q on q.id=o.current_quote_id where o.id=p_order
$$;
create function commerce_private.free_credit(p_customer uuid) returns bigint
language sql stable set search_path = pg_catalog as $$
  select greatest(0,-commerce_private.balance(p_customer) - coalesce((
    select sum(a.amount_paise) from public.payment_allocations a join public.orders o on o.id=a.order_id
    where a.customer_id=p_customer and o.handed_over_at is null and o.status<>'cancelled'),0))::bigint
$$;
create function commerce_private.post_ledger(p_customer uuid,p_order uuid,p_kind text,p_amount bigint,p_note text,p_reverses uuid default null) returns uuid
language plpgsql set search_path = pg_catalog as $$
declare v uuid;
begin
  if p_amount=0 then return null; end if;
  perform 1 from public.customers where id=p_customer for update;
  if abs(commerce_private.balance(p_customer)::numeric+p_amount)>9000000000000000 then
    raise exception 'Account balance exceeds supported exact money range';
  end if;
  insert into public.ledger_entries(customer_id,order_id,kind,amount_paise,note,actor_id,reverses_entry_id)
    values(p_customer,p_order,p_kind,p_amount,p_note,commerce_identity.uid(),p_reverses) returning id into v;
  return v;
end;
$$;
create function commerce_private.emit(p_customer uuid,p_event text,p_entity uuid,p_priority integer default 50) returns void
language plpgsql set search_path = pg_catalog as $$
declare u uuid;
begin
  select auth_user_id into u from public.customers where id=p_customer and deleted_at is null;
  if u is null then return; end if;
  -- Notification bodies contain only navigation IDs, never prices, phone numbers,
  -- addresses, payment references, or sensitive ledger details.
  insert into commerce_private.notification_outbox(user_id,customer_id,channel,event,payload,priority)
    values(u,p_customer,'email',p_event,jsonb_build_object('entity_id',p_entity),p_priority);
  insert into commerce_private.notification_outbox(user_id,customer_id,channel,event,payload,priority,installation_id)
    select u,p_customer,'push',p_event,jsonb_build_object('entity_id',p_entity),p_priority,installation_id
      from commerce_private.push_devices where user_id=u;
end;
$$;
create function commerce_private.normalized_lines(p_lines jsonb,p_priced boolean default false,p_active boolean default true) returns jsonb
language plpgsql set search_path = pg_catalog as $$
declare line jsonb; v record; qty bigint; price bigint; result jsonb := '[]'; seen uuid[] := '{}';
begin
  if p_lines is null or jsonb_typeof(p_lines)<>'array' then raise exception 'Provide a list of bag/package lines'; end if;
  if jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Provide 1 to 100 bag/package lines'; end if;
  for line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(line)<>'object' then raise exception 'Invalid order line'; end if;
    select s.id,s.label,s.reference_price_paise,s.active,p.active as product_active,p.name into v
      from public.variants s join public.products p on p.id=s.product_id
      where s.id=commerce_private.uuid_value(line,'variant_id');
    if not found or (p_active and (not v.active or not v.product_active)) then raise exception 'Product/package is not available'; end if;
    if v.id=any(seen) then raise exception 'Duplicate package lines are not allowed'; end if;
    seen := array_append(seen,v.id);
    qty := commerce_private.int_value(line,'quantity',1,10000);
    line := jsonb_build_object('variant_id',v.id,'label',v.name || ' — ' || v.label,'quantity',qty)
      || case when p_priced then jsonb_build_object('unit_price_paise',commerce_private.int_value(line,'unit_price_paise',0,1000000000000)) else '{}'::jsonb end;
    result := result || jsonb_build_array(line);
  end loop;
  if p_priced and (select sum((x->>'quantity')::numeric*(x->>'unit_price_paise')::numeric) from jsonb_array_elements(result) x)>1000000000000 then
    raise exception 'Quote total exceeds supported amount';
  end if;
  return result;
end;
$$;
create function commerce_private.release_hold(p_order uuid,p_reason text) returns void
language plpgsql set search_path = pg_catalog as $$
declare r record;
begin
  for r in select * from public.reservations where order_id=p_order order by variant_id loop
    perform 1 from public.inventory where variant_id=r.variant_id for update;
    update public.inventory set reserved=reserved-r.quantity where variant_id=r.variant_id;
    insert into public.inventory_movements(variant_id,order_id,quantity_delta,reserved_delta,reason,actor_id)
      values(r.variant_id,p_order,0,-r.quantity,p_reason,commerce_identity.uid());
  end loop;
  delete from public.reservations where order_id=p_order;
end;
$$;
create function commerce_private.expire_holds() returns integer
language plpgsql set search_path = pg_catalog as $$
declare o record; n integer := 0;
begin
  perform commerce_private.mutation_lock();
  for o in select s.id,s.customer_id from public.orders s join public.quotes q on q.id=s.current_quote_id
    where s.status in ('accepted','ready') and s.handed_over_at is null and q.reservation_until<=now()
      and commerce_private.paid(s.id)<q.deposit_paise order by s.id for update of s loop
    perform commerce_private.release_hold(o.id,'Unpaid reservation expired');
    update public.orders set status='quoted',updated_at=now() where id=o.id;
    insert into public.audit_log(actor_id,action,entity_id) values(commerce_identity.uid(),'reservation_expired',o.id);
    perform commerce_private.emit(o.customer_id,'reservation_expired',o.id,20);
    n := n+1;
  end loop;
  return n;
end;
$$;
create function commerce_private.allocate_credit(p_order uuid) returns bigint
language plpgsql set search_path = pg_catalog as $$
declare o public.orders; n bigint;
begin
  select * into strict o from public.orders where id=p_order for update;
  n := least(greatest(0,commerce_private.net_total(p_order)-commerce_private.paid(p_order)),commerce_private.free_credit(o.customer_id));
  if n>0 then
    insert into public.payment_allocations(customer_id,order_id,amount_paise,note,actor_id)
      values(o.customer_id,p_order,n,'Existing account advance allocated; no new payment',commerce_identity.uid());
  end if;
  return n;
end;
$$;
create function commerce_private.accept(p_order uuid,p_quote uuid,p_note text) returns uuid
language plpgsql set search_path = pg_catalog as $$
declare o public.orders; q public.quotes; line jsonb; v uuid; n integer; inv public.inventory;
begin
  select * into strict o from public.orders where id=p_order for update;
  if o.current_quote_id is distinct from p_quote then raise exception 'The quote changed; review the latest version'; end if;
  if o.status<>'quoted' then raise exception 'Order is not awaiting quote acceptance'; end if;
  select * into strict q from public.quotes where id=p_quote and order_id=p_order;
  if q.expires_at<=now() then raise exception 'Quote has expired; request a new quote'; end if;
  if q.reservation_until<=now() then raise exception 'Reservation deadline has passed; request a new quote'; end if;
  perform commerce_private.active_customer(o.customer_id);
  for line in select value from jsonb_array_elements(q.lines) order by value->>'variant_id' loop
    v := (line->>'variant_id')::uuid; n := (line->>'quantity')::integer;
    if not exists(select 1 from public.variants s join public.products p on p.id=s.product_id where s.id=v and s.active and p.active) then
      raise exception 'A quoted package is no longer available';
    end if;
    select * into strict inv from public.inventory where variant_id=v for update;
    if inv.on_hand-inv.reserved<n then raise exception 'Insufficient stock for the complete quote'; end if;
    update public.inventory set reserved=reserved+n where variant_id=v;
    insert into public.reservations(order_id,variant_id,quantity) values(p_order,v,n);
    insert into public.inventory_movements(variant_id,order_id,quantity_delta,reserved_delta,reason,actor_id)
      values(v,p_order,0,n,p_note,commerce_identity.uid());
  end loop;
  update public.orders set status='accepted',updated_at=now() where id=p_order;
  perform commerce_private.allocate_credit(p_order);
  perform commerce_private.emit(o.customer_id,'quote_accepted',p_order,20);
  return p_order;
end;
$$;
create function commerce_private.take_payment(p_customer uuid,p_order uuid,p_amount bigint,p_method text,p_reference text,
  p_note text,p_collector text,p_verified boolean,p_verification text,p_submission uuid default null) returns uuid
language plpgsql set search_path = pg_catalog as $$
declare o public.orders; s public.payment_submissions; e uuid; r uuid; allocation bigint; remaining bigint; sale record;
begin
  perform commerce_private.active_customer(p_customer);
  perform 1 from public.customers where id=p_customer for update;
  if p_amount is null or p_amount not between 1 and 1000000000000 then raise exception 'Payment must be positive integer paise'; end if;
  if p_method is null or p_method not in ('cash','upi') or p_collector is null or p_collector not in ('shop','driver') then raise exception 'Invalid payment method or receiver'; end if;
  if p_note is null or length(btrim(p_note))=0 then raise exception 'Record actual receipt evidence in the note'; end if;
  if p_method='upi' and (not coalesce(p_verified,false) or nullif(btrim(p_reference),'') is null or nullif(btrim(p_verification),'') is null) then
    raise exception 'UPI requires bank verification, reference, and verification note';
  end if;
  if p_order is not null then
    select * into strict o from public.orders where id=p_order for update;
    if o.customer_id<>p_customer then raise exception 'Payment customer does not own this order'; end if;
    if o.status in ('enquiry','cancelled') then raise exception 'Payment needs a current, non-cancelled quote'; end if;
  end if;
  if p_collector='driver' then
    if p_order is null or p_method<>'cash' or o.cash_collector<>'driver' or o.driver_name is null or o.driver_phone is null or o.handed_over_at is null then
      raise exception 'Driver collection requires handed-over goods and the assigned driver';
    end if;
    if p_amount>greatest(0,commerce_private.net_total(p_order)-commerce_private.paid(p_order)) then
      raise exception 'Driver cannot collect more than this order owes';
    end if;
  end if;
  if p_submission is not null then
    select * into strict s from public.payment_submissions where id=p_submission for update;
    if p_order is null or s.order_id<>p_order or s.customer_id<>p_customer or s.status<>'pending'
      or s.amount_paise<>p_amount or lower(s.reference)<>lower(p_reference) or p_method<>'upi' then
      raise exception 'Payment evidence does not match this unreviewed receipt';
    end if;
  end if;
  e := commerce_private.post_ledger(p_customer,p_order,'payment',-p_amount,p_note);
  insert into public.receipts(customer_id,order_id,kind,amount_paise,method,reference,collector,verification_note,note,ledger_entry_id,actor_id)
    values(p_customer,p_order,'payment',p_amount,p_method,p_reference,p_collector,p_verification,p_note,e,commerce_identity.uid()) returning id into r;
  if p_collector='driver' then
    insert into public.driver_cash_entries(order_id,receipt_id,payment_id,amount_paise,driver_name,driver_phone,note,actor_id)
      values(p_order,r,r,p_amount,o.driver_name,o.driver_phone,p_note,commerce_identity.uid());
  end if;
  if p_order is not null then
    allocation := least(p_amount,greatest(0,commerce_private.net_total(p_order)-commerce_private.paid(p_order)));
    if allocation>0 then
      insert into public.payment_allocations(customer_id,order_id,ledger_entry_id,amount_paise,note,actor_id)
        values(p_customer,p_order,e,allocation,'Receipt allocated to this order',commerce_identity.uid());
    end if;
  else
    -- Unspecified account payments settle billed dues oldest first. Any excess
    -- stays an advance, rather than silently disappearing or being billed twice.
    remaining := p_amount;
    for sale in select id from public.orders where customer_id=p_customer and handed_over_at is not null order by handed_over_at,id loop
      allocation := least(remaining,greatest(0,commerce_private.net_total(sale.id)-commerce_private.paid(sale.id)));
      if allocation>0 then
        insert into public.payment_allocations(customer_id,order_id,ledger_entry_id,amount_paise,note,actor_id)
          values(p_customer,sale.id,e,allocation,'Account receipt allocated to billed due',commerce_identity.uid());
        remaining := remaining-allocation;
      end if;
      exit when remaining=0;
    end loop;
  end if;
  if p_submission is not null then
    update public.payment_submissions set status='verified',receipt_id=r,reviewed_at=now() where id=p_submission;
  end if;
  perform commerce_private.emit(p_customer,'payment_received',coalesce(p_order,r),10);
  return r;
end;
$$;
create function commerce_private.handover(p_order uuid,p_note text,p_cod boolean default false) returns uuid
language plpgsql set search_path = pg_catalog as $$
declare o public.orders; q public.quotes; r record; inv public.inventory; e uuid; b uuid; due bigint; mode text;
begin
  select * into strict o from public.orders where id=p_order for update;
  if o.handed_over_at is not null then raise exception 'Goods were already released'; end if;
  if o.status not in ('accepted','ready') then raise exception 'Accept the current quote before handover'; end if;
  select * into strict q from public.quotes where id=o.current_quote_id and order_id=o.id;
  if nullif(btrim(p_note),'') is null then raise exception 'Handover evidence is required'; end if;
  perform commerce_private.allocate_credit(p_order);
  due := greatest(0,q.total_paise-commerce_private.paid(p_order));
  if due=0 then mode := 'paid';
  elsif p_cod then
    if o.cash_collector<>'driver' or o.fulfillment='pickup' or nullif(btrim(o.driver_name),'') is null or o.driver_phone is null then
      raise exception 'COD needs an assigned driver and explicit collection responsibility';
    end if;
    mode := 'cod';
  elsif q.credit_approved then mode := 'credit';
  else raise exception 'Unpaid handover needs per-sale credit or explicit driver COD approval';
  end if;
  if (select count(*) from public.reservations where order_id=p_order)<>jsonb_array_length(q.lines) then
    raise exception 'The complete inventory reservation is missing';
  end if;
  for r in select s.* from public.reservations s where s.order_id=p_order order by variant_id loop
    if not exists(select 1 from jsonb_array_elements(q.lines) x where (x->>'variant_id')::uuid=r.variant_id and (x->>'quantity')::integer=r.quantity) then
      raise exception 'Reservation no longer matches accepted quote';
    end if;
    select * into strict inv from public.inventory where variant_id=r.variant_id for update;
    update public.inventory set on_hand=on_hand-r.quantity,reserved=reserved-r.quantity where variant_id=r.variant_id;
    insert into commerce_private.sale_costs(order_id,variant_id,quantity,unit_cost_paise) values(p_order,r.variant_id,r.quantity,inv.average_cost_paise);
    insert into public.inventory_movements(variant_id,order_id,quantity_delta,reserved_delta,unit_cost_paise,reason,actor_id)
      values(r.variant_id,p_order,-r.quantity,-r.quantity,inv.average_cost_paise,'Goods handed over',commerce_identity.uid());
  end loop;
  delete from public.reservations where order_id=p_order;
  e := commerce_private.post_ledger(o.customer_id,p_order,'sale',q.total_paise,'Sales bill for '||o.number);
  insert into public.bills(order_id,customer_id,total_paise,lines,transport_paise,ledger_entry_id)
    values(p_order,o.customer_id,q.total_paise,q.lines,q.transport_paise,e) returning id into b;
  update public.orders set handed_over_at=now(),handover_mode=mode,handover_note=p_note,
    cod_amount_paise=case when mode='cod' then due else 0 end,updated_at=now() where id=p_order;
  perform commerce_private.emit(o.customer_id,'goods_handed_over',p_order,10);
  return b;
end;
$$;
-- Enforce the last-admin invariant even for a mistakenly issued direct SQL delete.
create function commerce_private.guard_last_admin() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform commerce_private.mutation_lock();
  if tg_op='DELETE' or new.user_id is distinct from old.user_id then
    if (select count(*) from public.admins)<=1 then raise exception 'The last administrator cannot be removed'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_last_admin before update or delete on public.admins for each row execute function commerce_private.guard_last_admin();
revoke all on all functions in schema commerce_private from public,commerce_guest,commerce_runtime,commerce_worker;
