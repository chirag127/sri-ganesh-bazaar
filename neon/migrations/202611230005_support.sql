create function public.phone_start(p_phone text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare u uuid:=commerce_private.require_user(); c public.customers; s commerce_private.server_settings; h commerce_private.phone_challenges;
begin
 perform commerce_private.mutation_lock();
 select * into strict c from public.customers where id=commerce_private.ensure_customer() for update;
 perform commerce_private.active_customer(c.id);
 if p_phone is distinct from c.phone or p_phone is null then raise exception 'Save the current phone first'; end if;
 select * into strict s from commerce_private.server_settings where singleton;
 if not s.sms_enabled then return jsonb_build_object('allowed',false,'reason','sms_disabled','challenge_id',null,'expires_at',null); end if;
 if (select count(*) from commerce_private.phone_challenges where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=s.sms_daily_limit then
 return jsonb_build_object('allowed',false,'reason','daily_limit','challenge_id',null,'expires_at',null); end if;
 if exists(select 1 from commerce_private.phone_challenges where user_id=u and created_at>now()-interval '60 seconds') then return jsonb_build_object('allowed',false,'reason','cooldown','challenge_id',null,'expires_at',null); end if;
 update commerce_private.phone_challenges set invalidated_at=now() where user_id=u and used_at is null;
 insert into commerce_private.phone_challenges(user_id,customer_id,phone,phone_version) values(u,c.id,c.phone,c.phone_version) returning * into h;
 return jsonb_build_object('allowed',true,'reason',null,'challenge_id',h.id,'expires_at',h.expires_at);
end $$;
create function public.phone_challenge(p_challenge_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare h commerce_private.phone_challenges;
begin
 perform commerce_private.require_service();
 select h1.* into strict h from commerce_private.phone_challenges h1 join public.customers c on c.id=h1.customer_id where h1.id=p_challenge_id and h1.used_at is null and h1.invalidated_at is null and h1.expires_at>now() and c.auth_user_id=h1.user_id and c.phone=h1.phone and c.phone_version=h1.phone_version and c.deleted_at is null;
 return jsonb_build_object('id',h.id,'user_id',h.user_id,'phone',h.phone,'created_at',h.created_at,'expires_at',h.expires_at,'consumed_at',h.used_at);
end $$;
create function public.phone_complete(p_challenge_id uuid,p_user_id uuid,p_phone text,p_firebase_uid text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare h commerce_private.phone_challenges;
begin
 perform commerce_private.require_service(); perform commerce_private.mutation_lock();
 perform public.phone_challenge(p_challenge_id);
 select * into strict h from commerce_private.phone_challenges where id=p_challenge_id for update;
 if h.user_id is distinct from p_user_id or h.phone is distinct from p_phone or nullif(btrim(p_firebase_uid),'') is null or length(p_firebase_uid)>128 then raise exception 'Invalid phone proof subject'; end if;
 update commerce_private.phone_challenges set used_at=now(),firebase_uid=p_firebase_uid where id=h.id;
 update public.customers set phone_status='sms_verified' where id=h.customer_id;
 insert into public.audit_log(actor_id,action,entity_id) values(p_user_id,'phone_verified',h.customer_id);
 return jsonb_build_object('id',h.customer_id,'phone_status','sms_verified');
end $$;
create function public.notification_claim(p_limit integer) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s commerce_private.server_settings; j commerce_private.notification_outbox; result jsonb:='[]'; destination text; tokens jsonb; used integer;
begin
 perform commerce_private.require_service(); perform commerce_private.mutation_lock();
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid claim limit'; end if;
 select * into strict s from commerce_private.server_settings where singleton;
 update commerce_private.notification_outbox set state='uncertain',last_error='lease_expired' where state='processing' and leased_until<=now();
 select count(*) into used from commerce_private.notification_attempts where channel='email' and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 for j in select * from commerce_private.notification_outbox where state='queued' and available_at<=now() and ((channel='email' and s.email_enabled) or (channel='push' and s.push_enabled)) order by priority,created_at,id limit p_limit for update loop
  if j.channel='email' and used>=s.email_daily_limit then continue; end if;
  select email into destination from public.customers where id=j.customer_id and auth_user_id=j.user_id and deleted_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('token',token,'platform',platform,'installation_id',installation_id)),'[]') into tokens from commerce_private.push_devices where user_id=j.user_id and installation_id=j.installation_id;
  if (j.channel='email' and destination is null) or (j.channel='push' and jsonb_array_length(tokens)<>1) then update commerce_private.notification_outbox set state='failed',last_error='destination_missing' where id=j.id; continue; end if;
  insert into commerce_private.notification_attempts(outbox_id,channel) values(j.id,j.channel);
  update commerce_private.notification_outbox set state='processing',attempts=1,leased_until=now()+interval '5 minutes' where id=j.id;
  if j.channel='email' then used:=used+1; end if;
  result:=result||jsonb_build_array(jsonb_build_object('id',j.id,'user_id',j.user_id,'customer_id',j.customer_id,'channel',j.channel,'event',j.event,'payload',j.payload,'attempts',1,'email',destination,'tokens',tokens));
 end loop;
 return result;
end $$;
create function public.notification_finish(p_job_id uuid,p_state text,p_provider_id text,p_error text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j commerce_private.notification_outbox;
begin
 perform commerce_private.require_service(); perform commerce_private.mutation_lock();
 if p_state is null or p_state not in ('sent','failed','uncertain') or length(p_provider_id)>512 or length(p_error)>200 then raise exception 'Invalid delivery outcome'; end if;
 if p_state='sent' and nullif(btrim(p_provider_id),'') is null then raise exception 'Provider receipt required'; end if;
 select * into strict j from commerce_private.notification_outbox where id=p_job_id for update;
 if j.state=p_state then return jsonb_build_object('id',j.id); end if;
 if j.state<>'processing' then raise exception 'Job is not leased'; end if;
 update commerce_private.notification_outbox set state=p_state,provider_id=p_provider_id,last_error=p_error where id=j.id;
 update commerce_private.notification_attempts set finished_at=now() where outbox_id=j.id;
 return jsonb_build_object('id',j.id);
end $$;
revoke all on function public.phone_start(text),public.phone_challenge(uuid),public.phone_complete(uuid,uuid,text,text),public.notification_claim(integer),public.notification_finish(uuid,text,text,text) from public,commerce_guest,commerce_runtime,commerce_worker;
grant execute on function public.phone_start(text) to commerce_runtime;
grant execute on function public.phone_challenge(uuid),public.phone_complete(uuid,uuid,text,text),public.notification_claim(integer),public.notification_finish(uuid,text,text,text) to commerce_worker;
