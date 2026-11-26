-- Object bytes live in private Neon Object Storage. Only the trusted upload
-- handler records metadata AFTER verifying upload ownership, size and MIME.
create table commerce_private.payment_evidence (
 path text primary key,
 user_id uuid not null references commerce_identity.users(id),
 order_id uuid not null references public.orders(id),
 bytes integer not null check(bytes between 1 and 2097152),
 mime text not null check(mime in ('image/jpeg','image/png','image/webp')),
 created_at timestamptz not null default now()
);
revoke all on commerce_private.payment_evidence from public,commerce_guest,commerce_runtime,commerce_worker;
create function commerce_private.valid_payment_evidence(p_path text,p_user uuid,p_order uuid,p_exists boolean default false) returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if p_path is null or p_path !~ ('^'||p_user::text||'/'||p_order::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$') then return false; end if;
 if not exists(select 1 from public.orders o join public.customers c on c.id=o.customer_id where o.id=p_order and c.auth_user_id=p_user and c.deleted_at is null) then return false; end if;
 return not p_exists or exists(select 1 from commerce_private.payment_evidence where path=p_path and user_id=p_user and order_id=p_order);
end $$;
create function public.register_payment_evidence(p_path text,p_order uuid,p_bytes integer,p_mime text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare u uuid:=commerce_private.require_user();
begin
 if not commerce_private.valid_payment_evidence(p_path,u,p_order,false) then raise exception 'Evidence ownership denied'; end if;
 insert into commerce_private.payment_evidence(path,user_id,order_id,bytes,mime) values(p_path,u,p_order,p_bytes,p_mime);
 return jsonb_build_object('path',p_path);
end $$;
create function public.payment_evidence_access(p_path text) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare u uuid:=commerce_private.require_user();
begin
 return exists(select 1 from commerce_private.payment_evidence e where e.path=p_path and (e.user_id=u or commerce_private.is_admin()));
end $$;
revoke all on function commerce_private.valid_payment_evidence(text,uuid,uuid,boolean) from public;
revoke all on function public.register_payment_evidence(text,uuid,integer,text),public.payment_evidence_access(text) from public;
grant execute on function public.register_payment_evidence(text,uuid,integer,text),public.payment_evidence_access(text) to commerce_runtime;
