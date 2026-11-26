-- Generic events only; no customer details or prices enter notification payloads.
create table commerce_private.admin_alerts (
 id uuid primary key default gen_random_uuid(), event text not null check(event in ('new_enquiry','quote_accepted','payment_submitted','low_stock')),
 dedupe_key text unique not null, state text not null default 'queued' check(state in ('queued','processing','sent','failed','uncertain')),
 attempts integer not null default 0, available_at timestamptz not null default now(), lease_id uuid, leased_until timestamptz,
 provider_id text, created_at timestamptz not null default now()
);
revoke all on commerce_private.admin_alerts from public,commerce_guest,commerce_runtime,commerce_worker;
create index admin_alerts_queue on commerce_private.admin_alerts(available_at,created_at) where state='queued';
create table commerce_private.admin_alert_pacing (
 singleton boolean primary key default true check(singleton), next_claim_at timestamptz not null default now()
);
insert into commerce_private.admin_alert_pacing(singleton) values(true);
revoke all on commerce_private.admin_alert_pacing from public,commerce_guest,commerce_runtime,commerce_worker;
create function commerce_private.enqueue_admin_alert() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare e text; k text;
begin
 if TG_TABLE_NAME='orders' then
  if TG_OP='INSERT' then if new.status<>'enquiry' then return new; end if; e:='new_enquiry';
  else if new.status<>'accepted' or old.status='accepted' then return new; end if; e:='quote_accepted'; end if;
  k:=e||':'||new.id::text;
 elsif TG_TABLE_NAME='payment_submissions' then e:='payment_submitted'; k:=e||':'||new.id::text;
 else
  if new.on_hand-new.reserved>new.reorder_level then return new; end if;
  if TG_OP='INSERT' then return new; end if;
  if old.on_hand-old.reserved<=old.reorder_level then return new; end if;
  e:='low_stock'; k:=e||':'||new.variant_id::text||':'||txid_current()::text;
 end if;
 insert into commerce_private.admin_alerts(event,dedupe_key) values(e,k) on conflict(dedupe_key) do nothing;
 return new;
end $$;
create trigger admin_alert_order_insert after insert on public.orders for each row execute function commerce_private.enqueue_admin_alert();
create trigger admin_alert_order_update after update of status on public.orders for each row execute function commerce_private.enqueue_admin_alert();
create trigger admin_alert_payment after insert on public.payment_submissions for each row execute function commerce_private.enqueue_admin_alert();
create trigger admin_alert_stock after update of on_hand,reserved,reorder_level on public.inventory for each row execute function commerce_private.enqueue_admin_alert();
revoke all on function commerce_private.enqueue_admin_alert() from public,commerce_guest,commerce_runtime,commerce_worker;
create function public.admin_alert_claim() returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j commerce_private.admin_alerts;
begin
 perform commerce_private.require_service();
 perform pg_advisory_xact_lock(780631);
 update commerce_private.admin_alerts set state='uncertain' where state='processing' and leased_until<=now();
 -- One global in-flight delivery and at least one second between claims.
 if exists(select 1 from commerce_private.admin_alerts where state='processing')
 or exists(select 1 from commerce_private.admin_alert_pacing where next_claim_at>now()) then return null; end if;
 select * into j from commerce_private.admin_alerts where state='queued' and available_at<=now() and attempts<3 order by created_at,id limit 1 for update skip locked;
 if not found then return null; end if;
 update commerce_private.admin_alerts set state='processing',attempts=attempts+1,lease_id=gen_random_uuid(),leased_until=now()+interval '60 seconds' where id=j.id returning * into j;
 update commerce_private.admin_alert_pacing set next_claim_at=now()+interval '1 second' where singleton;
 return jsonb_build_object('id',j.id,'event',j.event,'lease_id',j.lease_id);
end $$;
create function public.admin_alert_finish(p_id uuid,p_lease uuid,p_state text,p_provider text,p_retry integer) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j commerce_private.admin_alerts;
begin
 perform commerce_private.require_service();
 perform pg_advisory_xact_lock(780631);
 select * into strict j from commerce_private.admin_alerts where id=p_id for update;
 if j.state<>'processing' or j.lease_id is distinct from p_lease or j.leased_until<=now() then raise exception 'Invalid alert lease'; end if;
 if p_state not in ('sent','failed','uncertain','rate_limited') or p_state is null then raise exception 'Invalid outcome'; end if;
 if p_state='sent' and (p_provider is null or p_provider !~ '^[0-9]{1,30}$') then raise exception 'Receipt required'; end if;
 if p_state='rate_limited' and (p_retry is null or p_retry not between 1 and 86400) then raise exception 'Invalid retry'; end if;
 update commerce_private.admin_alerts set state=case when p_state='rate_limited' then case when attempts<3 then 'queued' else 'failed' end else p_state end,
 available_at=case when p_state='rate_limited' then now()+make_interval(secs=>p_retry) else available_at end,
 provider_id=case when p_state='sent' then p_provider else null end where id=p_id;
 if p_state='rate_limited' then
  update commerce_private.admin_alert_pacing set next_claim_at=greatest(next_claim_at,now()+make_interval(secs=>p_retry)) where singleton;
 end if;
 return true;
end $$;
revoke all on function public.admin_alert_claim(),public.admin_alert_finish(uuid,uuid,text,text,integer) from public,commerce_guest,commerce_runtime,commerce_worker;
grant execute on function public.admin_alert_claim(),public.admin_alert_finish(uuid,uuid,text,text,integer) to commerce_worker;
