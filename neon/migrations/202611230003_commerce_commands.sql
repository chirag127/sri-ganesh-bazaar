create function public.commerce_command(p_action text,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog as $$
<<cmd>>
declare
  actor uuid := commerce_private.require_user(); request uuid; cached commerce_private.command_requests;
  is_staff boolean; customer uuid; entity uuid; oid uuid; qid uuid; uid uuid;
  rid uuid; eid uuid; bid uuid; previous uuid; target uuid; variant uuid; installation uuid;
  o public.orders; q public.quotes; c public.customers; inv public.inventory; payment public.receipts;
  deletion public.deletion_requests; product public.products; v public.variants; sale_cost commerce_private.sale_costs;
  row_data record; line jsonb; lines jsonb; result jsonb; kept uuid[] := '{}';
  amount bigint; total bigint; transport bigint; deposit bigint; paid bigint; n bigint; cost bigint;
  old_paid bigint; returned bigint; max_value numeric := 0; qty bigint; weight numeric; balance bigint;
  note text; phone text; reference text; method text; state text; receiver text; token text; email text;
  active boolean; restock boolean; credit boolean; deadline timestamptz; expired integer;
  admin_actions constant text[] := array['save_product','adjust_stock','create_customer','link_customer',
    'confirm_phone','issue_quote','accept_quote_for_customer','record_payment','record_remittance',
    'set_fulfillment','advance_order','counter_sale','record_return','record_refund','set_admin',
    'process_account_deletion','expire_reservations'];
  customer_actions constant text[] := array['save_profile','submit_enquiry','accept_quote','submit_payment',
    'cancel_order','request_account_deletion','register_push','unregister_push'];
begin
  if p_action is null or not (p_action=any(admin_actions) or p_action=any(customer_actions)) then
    raise exception 'Unknown commerce command';
  end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>65536 then
    raise exception 'Invalid command payload';
  end if;
  request := commerce_private.uuid_value(p_payload,'request_id');
  -- A waiting command must observe revocations committed by the prior lock holder.
  -- VOLATILE + READ COMMITTED gives this subsequent statement a fresh snapshot.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Commerce commands require READ COMMITTED isolation';
  end if;
  perform commerce_private.mutation_lock();
  is_staff := commerce_private.is_admin();
  if p_action=any(admin_actions) and not is_staff then
    raise exception using errcode='42501',message='Administrator access required';
  end if;
  select * into cached from commerce_private.command_requests where actor_id=actor and request_id=request;
  if found then
    if cached.action<>p_action or cached.payload<>p_payload then raise exception 'Request ID was already used with a different action or payload'; end if;
    return cached.result;
  end if;
  -- Errors escape the RPC: stock, ledger, outbox and the idempotency record all
  -- roll back together. Failed requests never become cached successes.
  expired := commerce_private.expire_holds();

  case p_action
  when 'save_profile' then
    customer := commerce_private.ensure_customer();
    perform commerce_private.active_customer(customer);
    phone := commerce_private.phone_value(commerce_private.text_value(p_payload,'phone',16,false));
    select * into strict c from public.customers where id=customer for update;
    if c.phone is distinct from phone then
      update commerce_private.phone_challenges set invalidated_at=now() where customer_id=customer and used_at is null and invalidated_at is null;
    end if;
    update public.customers set name=commerce_private.text_value(p_payload,'name',120),phone=cmd.phone,
      address=commerce_private.text_value(p_payload,'address',1000,false),
      phone_status=case when c.phone is distinct from cmd.phone then 'unverified' else c.phone_status end,
      phone_version=c.phone_version+case when c.phone is distinct from cmd.phone then 1 else 0 end
      where id=customer;
    entity := customer;
  when 'submit_enquiry' then
    customer := commerce_private.ensure_customer();
    perform commerce_private.active_customer(customer);
    if not exists(select 1 from public.customers where id=customer and customers.phone is not null) then raise exception 'Add a contact phone before sending an enquiry'; end if;
    lines := commerce_private.normalized_lines(p_payload->'lines');
    state := commerce_private.text_value(p_payload,'fulfillment',30);
    if state not in ('pickup','own_driver','shop_delivery') then raise exception 'Invalid fulfillment'; end if;
    note := commerce_private.text_value(p_payload,'address',1000,false);
    if state='shop_delivery' and note is null then raise exception 'Delivery address is required'; end if;
    insert into public.orders(customer_id,fulfillment,address,notes,lines)
      values(customer,state,note,commerce_private.text_value(p_payload,'notes',2000,false),lines) returning id into entity;
    perform commerce_private.emit(customer,'enquiry_submitted',entity,40);
  when 'accept_quote', 'accept_quote_for_customer' then
    oid := commerce_private.uuid_value(p_payload,'order_id');
    if p_action='accept_quote' and not commerce_private.owns_order(oid) then raise exception using errcode='42501',message='Order access denied'; end if;
    note := case when p_action='accept_quote_for_customer' then commerce_private.text_value(p_payload,'note',2000) else 'Customer accepted the displayed quote' end;
    entity := commerce_private.accept(oid,commerce_private.uuid_value(p_payload,'quote_id'),note);
  when 'submit_payment' then
    oid := commerce_private.uuid_value(p_payload,'order_id');
    if not commerce_private.owns_order(oid) then raise exception using errcode='42501',message='Order access denied'; end if;
    select * into strict o from public.orders where id=oid for update;
    if o.current_quote_id is null or o.status='cancelled' then raise exception 'A current non-cancelled quote is required'; end if;
    note := commerce_private.text_value(p_payload,'screenshot_path',200,false);
    if note is not null and not commerce_private.valid_payment_evidence(note,actor,oid,true) then raise exception 'Payment image is missing or does not belong to this order'; end if;
    insert into public.payment_submissions(customer_id,order_id,amount_paise,reference,screenshot_path)
      values(o.customer_id,oid,commerce_private.int_value(p_payload,'amount_paise',1,1000000000000),
        commerce_private.text_value(p_payload,'reference',200),note) returning id into entity;
    -- Evidence is not a payment. No receipt, allocation or ledger entry is posted.
  when 'cancel_order' then
    oid := commerce_private.uuid_value(p_payload,'order_id');
    if not is_staff and not commerce_private.owns_order(oid) then raise exception using errcode='42501',message='Order access denied'; end if;
    select * into strict o from public.orders where id=oid for update;
    if o.status in ('dispatched','completed','cancelled') or o.handed_over_at is not null then raise exception 'Only an order before handover can be cancelled'; end if;
    note := commerce_private.text_value(p_payload,'reason',2000);
    perform commerce_private.release_hold(oid,'Order cancelled: '||note);
    paid := commerce_private.paid(oid);
    if paid>0 then
      insert into public.payment_allocations(customer_id,order_id,amount_paise,note,actor_id)
        values(o.customer_id,oid,-paid,'Cancelled order: existing receipts retained as account credit',actor);
      insert into public.refund_requests(customer_id,order_id,amount_paise) values(o.customer_id,oid,paid);
    end if;
    update public.orders set status='cancelled',cancelled_reason=note,updated_at=now() where id=oid;
    perform commerce_private.emit(o.customer_id,'order_cancelled',oid,10);
    entity := oid;
  when 'request_account_deletion' then
    customer := commerce_private.ensure_customer();
    perform commerce_private.active_customer(customer);
    select id into entity from public.deletion_requests where customer_id=customer and status in ('requested','processing');
    if entity is null then
      insert into public.deletion_requests(customer_id,user_id,reason)
        values(customer,actor,commerce_private.text_value(p_payload,'reason',2000,false)) returning id into entity;
      perform commerce_private.emit(customer,'deletion_requested',entity,10);
    end if;
  when 'register_push' then
    customer := commerce_private.ensure_customer();
    perform commerce_private.active_customer(customer);
    installation := commerce_private.uuid_value(p_payload,'installation_id');
    token := commerce_private.text_value(p_payload,'token',4096);
    state := commerce_private.text_value(p_payload,'platform',10);
    if length(token)<10 or state not in ('web','android','ios') then raise exception 'Invalid push installation'; end if;
    if exists(select 1 from commerce_private.push_devices where (installation_id=installation or push_devices.token=cmd.token) and user_id<>actor) then
      raise exception 'Push installation is already registered to another account; unregister before switching accounts';
    end if;
    if exists(select 1 from commerce_private.push_devices where push_devices.token=cmd.token and installation_id<>installation) then raise exception 'Token already belongs to another installation'; end if;
    if not exists(select 1 from commerce_private.push_devices where installation_id=installation) and
      (select count(*) from commerce_private.push_devices where user_id=actor)>=10 then raise exception 'Too many push installations'; end if;
    insert into commerce_private.push_devices(user_id,installation_id,token,platform)
      values(actor,installation,token,state) on conflict(installation_id) do update
      set token=excluded.token,platform=excluded.platform,updated_at=now() returning id into entity;
  when 'unregister_push' then
    installation := commerce_private.uuid_value(p_payload,'installation_id');
    token := commerce_private.text_value(p_payload,'token',4096,false);
    delete from commerce_private.push_devices where installation_id=installation and user_id=actor and (cmd.token is null or push_devices.token=cmd.token);
    update commerce_private.notification_outbox set state='failed',last_error='installation_unregistered'
      where installation_id=installation and user_id=actor and notification_outbox.state='queued';
    entity := installation;
  when 'save_product' then
    entity := commerce_private.uuid_value(p_payload,'id',false);
    if entity is null then
      insert into public.products(name,slug,category,description,image_url,active)
        values(commerce_private.text_value(p_payload,'name',160),commerce_private.text_value(p_payload,'slug',100),
          commerce_private.text_value(p_payload,'category',80),coalesce(commerce_private.text_value(p_payload,'description',4000,false),''),
          commerce_private.text_value(p_payload,'image_url',2048,false),commerce_private.bool_value(p_payload,'active')) returning id into entity;
    else
      select * into strict product from public.products where id=entity for update;
      update public.products set name=commerce_private.text_value(p_payload,'name',160),slug=commerce_private.text_value(p_payload,'slug',100),
        category=commerce_private.text_value(p_payload,'category',80),description=coalesce(commerce_private.text_value(p_payload,'description',4000,false),''),
        image_url=commerce_private.text_value(p_payload,'image_url',2048,false),active=commerce_private.bool_value(p_payload,'active') where id=entity;
    end if;
    if p_payload->'variants' is null or jsonb_typeof(p_payload->'variants')<>'array' or jsonb_array_length(p_payload->'variants') not between 1 and 30 then raise exception 'Provide 1 to 30 package variants'; end if;
    for line in select value from jsonb_array_elements(p_payload->'variants') loop
      if jsonb_typeof(line->'weight_kg')<>'number' or line->'weight_kg' is null then raise exception 'Package weight must be a number'; end if;
      weight := (line->>'weight_kg')::numeric;
      if weight<=0 or weight>10000 or weight<>round(weight,3) then raise exception 'Invalid package weight'; end if;
      variant := commerce_private.uuid_value(line,'id',false);
      if variant is null then
        insert into public.variants(product_id,label,weight_kg,reference_price_paise)
          values(entity,commerce_private.text_value(line,'label',120),weight,commerce_private.int_value(line,'reference_price_paise',0,1000000000000)) returning id into variant;
        insert into public.inventory(variant_id) values(variant);
      else
        if variant=any(kept) then raise exception 'Duplicate package IDs'; end if;
        select * into strict v from public.variants where id=variant and product_id=entity for update;
        if v.weight_kg<>weight and (exists(select 1 from public.inventory_movements where variant_id=variant)
          or exists(select 1 from public.orders s cross join lateral jsonb_array_elements(s.lines) x where (x->>'variant_id')::uuid=variant)
          or exists(select 1 from public.quotes s cross join lateral jsonb_array_elements(s.lines) x where (x->>'variant_id')::uuid=variant)) then
          raise exception 'A used package weight is immutable; create a new variant';
        end if;
        update public.variants set label=commerce_private.text_value(line,'label',120),weight_kg=weight,
          reference_price_paise=commerce_private.int_value(line,'reference_price_paise',0,1000000000000),active=true where id=variant;
      end if;
      kept := array_append(kept,variant);
    end loop;
    update public.variants set active=false where product_id=entity and not (id=any(kept));
  when 'adjust_stock' then
    variant := commerce_private.uuid_value(p_payload,'variant_id');
    qty := commerce_private.int_value(p_payload,'quantity_delta',-10000000,10000000);
    if qty=0 then raise exception 'Stock adjustment cannot be zero'; end if;
    note := commerce_private.text_value(p_payload,'reason',2000);
    select * into strict inv from public.inventory where variant_id=variant for update;
    if inv.on_hand+qty<inv.reserved or inv.on_hand+qty>10000000 then raise exception 'Adjustment would consume reserved bags or exceed stock bounds'; end if;
    if qty>0 then
      cost := commerce_private.int_value(p_payload,'unit_cost_paise',0,1000000000000);
      update public.inventory set on_hand=on_hand+qty,
        average_cost_paise=round((inv.on_hand::numeric*inv.average_cost_paise+qty::numeric*cost)/(inv.on_hand+qty))::bigint where variant_id=variant;
    else
      cost := inv.average_cost_paise;
      update public.inventory set on_hand=on_hand+qty where variant_id=variant;
    end if;
    insert into public.inventory_movements(variant_id,quantity_delta,unit_cost_paise,reason,actor_id)
      values(variant,qty,cost,note,actor) returning id into entity;
  when 'create_customer' then
    note := commerce_private.text_value(p_payload,'note',2000,false);
    amount := commerce_private.int_value(p_payload,'opening_balance_paise',-1000000000000,1000000000000,0);
    if amount<>0 and note is null then raise exception 'Opening balance requires supporting evidence'; end if;
    insert into public.customers(name,phone,address)
      values(commerce_private.text_value(p_payload,'name',120),commerce_private.phone_value(commerce_private.text_value(p_payload,'phone',16,false)),
        commerce_private.text_value(p_payload,'address',1000,false)) returning id into entity;
    if amount<>0 then perform commerce_private.post_ledger(entity,null,'opening_balance',amount,note); end if;
  when 'link_customer' then
    customer := commerce_private.uuid_value(p_payload,'customer_id');
    note := commerce_private.text_value(p_payload,'note',2000);
    email := lower(commerce_private.text_value(p_payload,'user_email',320));
    select * into strict c from public.customers where id=customer for update;
    perform commerce_private.active_customer(customer);
    select id into strict uid from commerce_identity.users where lower(commerce_identity.users.email)=cmd.email and email_confirmed_at is not null and
      (raw_app_meta_data->>'provider'='google' or raw_app_meta_data->'providers' @> '["google"]'::jsonb);
    if c.auth_user_id is not null and c.auth_user_id<>uid then raise exception 'Customer is already linked to a different account'; end if;
    if exists(select 1 from public.deletion_requests where user_id=uid and status='completed') then raise exception 'Deleted account cannot be relinked'; end if;
    select id into previous from public.customers where auth_user_id=uid and id<>customer for update;
    if previous is not null then
      if exists(select 1 from public.orders where customer_id=previous) or exists(select 1 from public.ledger_entries where customer_id=previous)
        or exists(select 1 from public.deletion_requests where customer_id=previous) then raise exception 'Account has existing history; implicit merges are forbidden'; end if;
      update commerce_private.phone_challenges set invalidated_at=now() where customer_id=previous and used_at is null and invalidated_at is null;
      update public.customers set auth_user_id=null,name='Linked profile',email=null,phone=null,phone_status='unverified',address=null,deleted_at=now() where id=previous;
    end if;
    update public.customers set auth_user_id=uid,email=cmd.email where id=customer;
    perform commerce_private.emit(customer,'account_linked',customer,10);
    entity := customer;
  when 'confirm_phone' then
    entity := commerce_private.uuid_value(p_payload,'customer_id');
    note := commerce_private.text_value(p_payload,'note',2000);
    perform commerce_private.active_customer(entity);
    if not exists(select 1 from public.customers where id=entity and customers.phone is not null) then raise exception 'Customer has no phone to confirm'; end if;
    update public.customers set phone_status='staff_confirmed' where id=entity;
  when 'issue_quote' then
    oid := commerce_private.uuid_value(p_payload,'order_id');
    select * into strict o from public.orders where id=oid for update;
    perform commerce_private.active_customer(o.customer_id);
    if o.status in ('dispatched','completed','cancelled') or o.handed_over_at is not null then raise exception 'Cannot revise after cancellation or goods release'; end if;
    lines := commerce_private.normalized_lines(p_payload->'lines',true);
    select sum((x->>'quantity')::bigint*(x->>'unit_price_paise')::bigint) into total from jsonb_array_elements(lines) x;
    transport := commerce_private.int_value(p_payload,'transport_paise',0,1000000000000);
    if o.fulfillment='pickup' and transport<>0 then raise exception 'Pickup cannot carry a delivery charge'; end if;
    if total+transport>1000000000000 then raise exception 'Quote total exceeds supported amount'; end if;
    deposit := commerce_private.int_value(p_payload,'deposit_paise',0,total+transport);
    deadline := commerce_private.text_value(p_payload,'reservation_until',64)::timestamptz;
    if deadline<=now() or deadline>now()+interval '30 days' then raise exception 'Reservation deadline must be in the next 30 days'; end if;
    perform commerce_private.release_hold(oid,'Quote revised; renewed acceptance required');
    select coalesce(max(version),0)+1 into n from public.quotes where order_id=oid;
    insert into public.quotes(order_id,version,lines,goods_total_paise,transport_paise,total_paise,deposit_paise,expires_at,reservation_until,notes,credit_approved,created_by)
      values(oid,n,lines,total,transport,total+transport,deposit,now()+interval '48 hours',deadline,
        coalesce(commerce_private.text_value(p_payload,'notes',2000,false),''),commerce_private.bool_value(p_payload,'credit_approved'),actor) returning id into entity;
    select jsonb_agg(x-'unit_price_paise') into lines from jsonb_array_elements(lines) x;
    update public.orders set current_quote_id=entity,status='quoted',lines=cmd.lines,updated_at=now() where id=oid;
    old_paid := commerce_private.paid(oid);
    if old_paid>total+transport then
      insert into public.payment_allocations(customer_id,order_id,amount_paise,note,actor_id)
        values(o.customer_id,oid,total+transport-old_paid,'Quote reduced; excess preserved as account advance',actor);
    end if;
    perform commerce_private.emit(o.customer_id,'quote_issued',oid,10);
    result := jsonb_build_object('order_id',oid,'quote_id',entity);
  when 'record_payment' then
    customer := commerce_private.uuid_value(p_payload,'customer_id');
    oid := commerce_private.uuid_value(p_payload,'order_id',false);
    entity := commerce_private.take_payment(customer,oid,commerce_private.int_value(p_payload,'amount_paise',1,1000000000000),
      commerce_private.text_value(p_payload,'method',10),commerce_private.text_value(p_payload,'reference',200,false),
      commerce_private.text_value(p_payload,'note',2000),coalesce(commerce_private.text_value(p_payload,'received_by',10,false),'shop'),
      commerce_private.bool_value(p_payload,'bank_verified'),commerce_private.text_value(p_payload,'verification_note',2000,false),
      commerce_private.uuid_value(p_payload,'payment_submission_id',false));
    result := jsonb_build_object('payment_id',entity,'receipt_id',entity);
  when 'record_remittance' then
    rid := commerce_private.uuid_value(p_payload,'payment_id');
    select * into strict payment from public.receipts where id=rid;
    if payment.kind<>'payment' or payment.collector<>'driver' then raise exception 'Only a driver collection can be remitted'; end if;
    select * into strict row_data from public.driver_cash_entries where payment_id=rid and amount_paise>0;
    select coalesce(sum(amount_paise),0) into n from public.driver_cash_entries where payment_id=rid;
    amount := commerce_private.int_value(p_payload,'amount_paise',1,1000000000000);
    if amount>n then raise exception 'Cannot remit more cash than the driver holds'; end if;
    note := commerce_private.text_value(p_payload,'note',2000);
    insert into public.receipts(customer_id,order_id,kind,amount_paise,method,collector,note,actor_id)
      values(payment.customer_id,payment.order_id,'driver_remittance',amount,'cash','shop',note,actor) returning id into entity;
    insert into public.driver_cash_entries(order_id,receipt_id,payment_id,amount_paise,driver_name,driver_phone,note,actor_id)
      values(payment.order_id,entity,rid,-amount,row_data.driver_name,row_data.driver_phone,note,actor);
    -- This receipt settles driver cash, never customer debt a second time.
  when 'set_fulfillment' then
    oid := commerce_private.uuid_value(p_payload,'order_id');
    select * into strict o from public.orders where id=oid for update;
    if o.handed_over_at is not null or o.status='cancelled' then raise exception 'Fulfillment is fixed after handover/cancellation'; end if;
    state := commerce_private.text_value(p_payload,'fulfillment',30);
    receiver := commerce_private.text_value(p_payload,'cash_collector',10);
    note := commerce_private.text_value(p_payload,'address',1000,false);
    if state not in ('pickup','own_driver','shop_delivery') or receiver not in ('shop','driver') then raise exception 'Invalid fulfillment or collector'; end if;
    if state='shop_delivery' and note is null then raise exception 'Delivery address is required'; end if;
    if o.current_quote_id is not null and state='pickup' and exists(select 1 from public.quotes where id=o.current_quote_id and transport_paise<>0) then raise exception 'Revise the transport quote before changing to pickup'; end if;
    if o.status in ('accepted','ready') and state<>o.fulfillment then raise exception 'Revise the accepted quote before changing fulfillment'; end if;
    update public.orders set fulfillment=state,address=note,cash_collector=receiver,
      driver_name=commerce_private.text_value(p_payload,'driver_name',120,receiver='driver'),
      driver_phone=commerce_private.phone_value(commerce_private.text_value(p_payload,'driver_phone',16,receiver='driver')),updated_at=now() where id=oid;
    entity := oid;
  when 'advance_order' then
    oid := commerce_private.uuid_value(p_payload,'order_id');
    select * into strict o from public.orders where id=oid for update;
    state := commerce_private.text_value(p_payload,'status',30);
    note := commerce_private.text_value(p_payload,'handover_note',2000,false);
    if state='ready' and o.status='accepted' then null;
    elsif state='dispatched' and o.status='ready' and o.fulfillment<>'pickup' then
      bid := commerce_private.handover(oid,note,commerce_private.bool_value(p_payload,'cod_approved'));
    elsif state='completed' and o.status='ready' and o.fulfillment='pickup' then
      bid := commerce_private.handover(oid,note,false);
    elsif state='completed' and o.status='dispatched' and o.handed_over_at is not null then null;
    else raise exception 'Invalid order state transition'; end if;
    update public.orders set status=state,updated_at=now() where id=oid;
    perform commerce_private.emit(o.customer_id,'order_'||state,oid,30);
    entity := oid;
    result := jsonb_build_object('bill_id',bid);
  when 'counter_sale' then
    customer := commerce_private.uuid_value(p_payload,'customer_id');
    perform commerce_private.active_customer(customer);
    note := commerce_private.text_value(p_payload,'note',2000);
    lines := commerce_private.normalized_lines(p_payload->'lines',true);
    select sum((x->>'quantity')::bigint*(x->>'unit_price_paise')::bigint) into total from jsonb_array_elements(lines) x;
    paid := commerce_private.int_value(p_payload,'paid_paise',0,1000000000000);
    method := commerce_private.text_value(p_payload,'method',10);
    if method not in ('cash','upi') then raise exception 'Invalid payment method'; end if;
    credit := commerce_private.bool_value(p_payload,'credit_approved');
    insert into public.orders(customer_id,fulfillment,notes,lines) values(customer,'pickup',note,
      (select jsonb_agg(x-'unit_price_paise') from jsonb_array_elements(lines) x)) returning id into oid;
    insert into public.quotes(order_id,version,lines,goods_total_paise,transport_paise,total_paise,deposit_paise,expires_at,reservation_until,notes,credit_approved,created_by)
      values(oid,1,lines,total,0,total,0,now()+interval '48 hours',now()+interval '48 hours',note,credit,actor) returning id into qid;
    update public.orders set status='quoted',current_quote_id=qid where id=oid;
    perform commerce_private.accept(oid,qid,'Staff recorded counter sale');
    if paid>0 then
      rid := commerce_private.take_payment(customer,oid,paid,method,commerce_private.text_value(p_payload,'reference',200,false),note,'shop',
        commerce_private.bool_value(p_payload,'bank_verified'),commerce_private.text_value(p_payload,'verification_note',2000,false));
    end if;
    bid := commerce_private.handover(oid,note,false);
    update public.orders set status='completed',updated_at=now() where id=oid;
    entity := oid;
    result := jsonb_build_object('bill_id',bid,'payment_id',rid,'receipt_id',rid);
  when 'record_return' then
    oid := commerce_private.uuid_value(p_payload,'order_id');
    select * into strict o from public.orders where id=oid for update;
    if o.handed_over_at is null then raise exception 'Only handed-over goods can be returned'; end if;
    select * into strict row_data from public.bills where order_id=oid;
    bid := row_data.id;
    eid := row_data.ledger_entry_id;
    lines := '[]'::jsonb;
    if p_payload->'lines' is null or jsonb_typeof(p_payload->'lines')<>'array' or jsonb_array_length(p_payload->'lines') not between 1 and 100 then raise exception 'Provide return package lines'; end if;
    for line in select value from jsonb_array_elements(p_payload->'lines') order by value->>'variant_id' loop
      variant := commerce_private.uuid_value(line,'variant_id');
      if variant=any(kept) then raise exception 'Duplicate returned package'; end if;
      kept := array_append(kept,variant);
      qty := commerce_private.int_value(line,'quantity',1,10000);
      restock := commerce_private.bool_value(line,'restock');
      select * into strict sale_cost from commerce_private.sale_costs where order_id=oid and variant_id=variant;
      select coalesce(sum((x->>'quantity')::bigint),0) into returned from public.returns r cross join lateral jsonb_array_elements(r.lines) x
        where r.order_id=oid and (x->>'variant_id')::uuid=variant;
      if qty>sale_cost.quantity-returned then raise exception 'Return exceeds unreturned sold bags'; end if;
      select (x->>'unit_price_paise')::bigint into strict cost from public.bills b cross join lateral jsonb_array_elements(b.lines) x
        where b.id=bid and (x->>'variant_id')::uuid=variant;
      max_value := max_value+qty::numeric*cost;
      if restock then
        select * into strict inv from public.inventory where variant_id=variant for update;
        update public.inventory set on_hand=on_hand+qty,
          average_cost_paise=round((inv.on_hand::numeric*inv.average_cost_paise+qty::numeric*sale_cost.unit_cost_paise)/(inv.on_hand+qty))::bigint where variant_id=variant;
        insert into public.inventory_movements(variant_id,order_id,quantity_delta,unit_cost_paise,reason,actor_id)
          values(variant,oid,qty,sale_cost.unit_cost_paise,'Approved return restocked at historical purchase cost',actor);
      end if;
      lines := lines || jsonb_build_array(jsonb_build_object('variant_id',variant,'quantity',qty,'restock',restock));
    end loop;
    amount := commerce_private.int_value(p_payload,'amount_paise',0,1000000000000);
    if amount>max_value then raise exception 'Return credit exceeds the original value of these bags'; end if;
    note := commerce_private.text_value(p_payload,'note',2000);
    eid := commerce_private.post_ledger(o.customer_id,oid,'return',-amount,note,eid);
    insert into public.returns(customer_id,order_id,bill_id,lines,amount_paise,ledger_entry_id,note,actor_id)
      values(o.customer_id,oid,bid,lines,amount,eid,note,actor) returning id into entity;
    if amount>0 then
      insert into public.refund_requests(customer_id,order_id,amount_paise) values(o.customer_id,oid,amount)
        on conflict(order_id) do update set amount_paise=refund_requests.amount_paise+excluded.amount_paise,status='pending';
    end if;
    perform commerce_private.emit(o.customer_id,'return_recorded',oid,10);
  when 'record_refund' then
    customer := commerce_private.uuid_value(p_payload,'customer_id');
    oid := commerce_private.uuid_value(p_payload,'order_id',false);
    perform commerce_private.active_customer(customer);
    if oid is not null and not exists(select 1 from public.orders where id=oid and customer_id=customer) then raise exception 'Refund customer does not own this order'; end if;
    amount := commerce_private.int_value(p_payload,'amount_paise',1,1000000000000);
    if amount>commerce_private.free_credit(customer) then raise exception 'Refund exceeds available unallocated customer credit'; end if;
    method := commerce_private.text_value(p_payload,'method',10);
    reference := commerce_private.text_value(p_payload,'reference',200,false);
    if method not in ('cash','upi') or (method='upi' and reference is null) then raise exception 'Refund requires a valid payment method and UPI reference'; end if;
    note := commerce_private.text_value(p_payload,'note',2000);
    eid := commerce_private.post_ledger(customer,oid,'refund',amount,note);
    insert into public.receipts(customer_id,order_id,kind,amount_paise,method,reference,note,ledger_entry_id,actor_id)
      values(customer,oid,'refund',amount,method,reference,note,eid,actor) returning id into entity;
    n := amount;
    for row_data in select s.id from public.orders s where s.customer_id=customer and (oid is null or s.id=oid) and s.handed_over_at is not null order by s.created_at,s.id loop
      old_paid := greatest(0,commerce_private.paid(row_data.id)-commerce_private.net_total(row_data.id));
      paid := least(n,old_paid);
      if paid>0 then
        insert into public.payment_allocations(customer_id,order_id,ledger_entry_id,amount_paise,note,actor_id)
          values(customer,row_data.id,eid,-paid,'Returned value refunded; original receipt remains immutable',actor);
        n := n-paid;
      end if;
      exit when n=0;
    end loop;
    n := amount;
    for row_data in select * from public.refund_requests where customer_id=customer and status='pending' and (oid is null or order_id=oid) order by created_at,id for update loop
      paid := least(n,row_data.amount_paise-row_data.refunded_paise);
      update public.refund_requests set refunded_paise=refunded_paise+paid,
        status=case when refunded_paise+paid=amount_paise then 'completed' else 'pending' end where id=row_data.id;
      n := n-paid;
      exit when n=0;
    end loop;
    perform commerce_private.emit(customer,'refund_recorded',coalesce(oid,entity),10);
  when 'set_admin' then
    email := lower(commerce_private.text_value(p_payload,'email',320));
    select id into strict entity from commerce_identity.users where lower(commerce_identity.users.email)=cmd.email and email_confirmed_at is not null and
      (raw_app_meta_data->>'provider'='google' or raw_app_meta_data->'providers' @> '["google"]'::jsonb);
    if commerce_private.bool_value(p_payload,'enabled') then
      if exists(select 1 from public.deletion_requests where user_id=entity and status='completed') then raise exception 'Deleted account cannot become an administrator'; end if;
      insert into public.admins(user_id,appointed_by) values(entity,actor) on conflict(user_id) do nothing;
    else
      delete from public.admins where user_id=entity;
    end if;
  when 'process_account_deletion' then
    entity := commerce_private.uuid_value(p_payload,'deletion_request_id');
    select * into strict deletion from public.deletion_requests where id=entity for update;
    state := commerce_private.text_value(p_payload,'status',20);
    note := commerce_private.text_value(p_payload,'note',2000);
    if state not in ('processing','completed','rejected') or deletion.status in ('completed','rejected') then raise exception 'Invalid deletion request transition'; end if;
    if state='completed' then
      if deletion.status<>'processing' then raise exception 'Review and start processing before completing deletion'; end if;
      if exists(select 1 from public.admins where user_id=deletion.user_id) then raise exception 'Remove staff access before completing deletion'; end if;
      if commerce_private.balance(deletion.customer_id)<>0 or exists(select 1 from public.orders where customer_id=deletion.customer_id and status not in ('cancelled','completed')) then
        raise exception 'Resolve open orders, advances and dues before completing deletion';
      end if;
      update public.customers set name='Deleted customer',phone=null,phone_status='unverified',phone_version=phone_version+1,
        email=null,address=null,auth_user_id=null,deleted_at=now() where id=deletion.customer_id;
      update public.orders set address=null,notes=null where customer_id=deletion.customer_id;
      update commerce_private.phone_challenges set invalidated_at=now(),firebase_uid=null where customer_id=deletion.customer_id;
      delete from commerce_private.push_devices where user_id=deletion.user_id;
      update commerce_private.notification_outbox set state='failed',last_error='account_deleted' where user_id=deletion.user_id and notification_outbox.state='queued';
      -- Bills, receipts and ledger survive. Auth deletion and evidence retention are
      -- explicit operator tasks, never falsely represented as an API-side delete.
    end if;
    update public.deletion_requests set status=state,note=cmd.note,updated_at=now() where id=entity;
  when 'expire_reservations' then
    entity := request;
    result := jsonb_build_object('expired',expired);
  end case;

  result := coalesce(result,'{}'::jsonb)||jsonb_build_object('id',entity,'request_id',request);
  if is_staff then
    insert into public.audit_log(actor_id,action,entity_id,details)
      values(actor,p_action,entity,jsonb_strip_nulls(jsonb_build_object('request_id',request,'note',note)));
  end if;
  insert into commerce_private.command_requests(actor_id,request_id,action,payload,result) values(actor,request,p_action,p_payload,result);
  return result;
end;
$$;
revoke all on function public.commerce_command(text,jsonb) from public,commerce_guest,commerce_runtime,commerce_worker;
grant execute on function public.commerce_command(text,jsonb) to commerce_runtime;
