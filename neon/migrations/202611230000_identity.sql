-- Run migrations as a dedicated owner, not the application login. Grant only
-- commerce_runtime to the trusted HTTP server and commerce_worker to its worker.
-- Never expose either SQL credential or arbitrary SQL execution to a client.
create role commerce_guest nologin;
create role commerce_runtime nologin;
create role commerce_worker nologin;
create schema commerce_identity;
revoke all on schema commerce_identity from public;
create table commerce_identity.users (
 id uuid primary key default gen_random_uuid(),
 external_subject text unique not null,
 email text,
 email_confirmed_at timestamptz,
 raw_app_meta_data jsonb not null default '{"provider":"google","providers":["google"]}',
 raw_user_meta_data jsonb not null default '{}'
);
-- The server MUST validate the Neon session and Google identity before calling
-- begin_request, on the SAME connection and transaction as the business RPC.
-- set_config(..., true) prevents identity leaking to the next pooled request.
create function commerce_identity.begin_request(p_subject text,p_email text,p_name text,p_email_verified boolean)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare u uuid;
begin
 if not pg_has_role(session_user,'commerce_runtime','member') then raise exception using errcode='42501',message='Trusted backend required'; end if;
 if nullif(btrim(p_subject),'') is null or length(p_subject)>512 then raise exception 'Invalid verified subject'; end if;
 if length(p_email)>320 or length(p_name)>120 then raise exception 'Invalid identity profile'; end if;
 insert into commerce_identity.users(external_subject,email,email_confirmed_at,raw_user_meta_data)
 values(p_subject,p_email,case when p_email_verified then now() end,jsonb_build_object('full_name',p_name))
 on conflict(external_subject) do update set email=excluded.email,email_confirmed_at=excluded.email_confirmed_at,raw_user_meta_data=excluded.raw_user_meta_data
 returning id into u;
 perform set_config('commerce.user_id',u::text,true);
 return u;
end $$;
create function commerce_identity.uid() returns uuid language sql stable as $$
 select case when pg_has_role(session_user,'commerce_runtime','member') then nullif(current_setting('commerce.user_id',true),'')::uuid else null end
$$;
create function commerce_identity.claims() returns jsonb language sql stable as $$
 select jsonb_build_object('role',case when pg_has_role(session_user,'commerce_worker','member') then 'commerce_worker' when pg_has_role(session_user,'commerce_runtime','member') then 'commerce_runtime' else 'commerce_guest' end)
$$;
revoke all on all tables in schema commerce_identity from public;
revoke all on all functions in schema commerce_identity from public;
grant usage on schema commerce_identity to commerce_runtime,commerce_worker;
grant execute on function commerce_identity.begin_request(text,text,text,boolean) to commerce_runtime;
grant execute on function commerce_identity.uid(),commerce_identity.claims() to commerce_runtime,commerce_worker;
