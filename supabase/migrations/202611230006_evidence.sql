create function commerce_private.valid_payment_evidence(p_path text,p_user uuid,p_order uuid,p_exists boolean default false) returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if p_path is null or p_path !~ ('^'||p_user::text||'/'||p_order::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$') then return false; end if;
 if not exists(select 1 from public.orders o join public.customers c on c.id=o.customer_id where o.id=p_order and c.auth_user_id=p_user and c.deleted_at is null) then return false; end if;
 return not p_exists or exists(select 1 from storage.objects where bucket_id='payment-evidence' and name=p_path);
end $$;
create function commerce_private.evidence_access(p_path text,p_upload boolean) returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
declare parts text[]:=string_to_array(p_path,'/');
begin
 perform commerce_private.require_user();
 if array_length(parts,1)<>3 or parts[1]!~'^[0-9a-f-]{36}$' or parts[2]!~'^[0-9a-f-]{36}$' then return false; end if;
 if not p_upload and commerce_private.is_admin() then return true; end if;
 return commerce_private.valid_payment_evidence(p_path,auth.uid(),parts[2]::uuid,false);
exception when invalid_text_representation then return false;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('payment-evidence','payment-evidence',false,2097152,array['image/jpeg','image/png','image/webp']);
create policy evidence_insert on storage.objects for insert to authenticated with check(bucket_id='payment-evidence' and commerce_private.evidence_access(name,true) and (metadata->>'size')::bigint between 1 and 2097152 and metadata->>'mimetype' in ('image/jpeg','image/png','image/webp'));
create policy evidence_select on storage.objects for select to authenticated using(bucket_id='payment-evidence' and commerce_private.evidence_access(name,false));
revoke all on function commerce_private.valid_payment_evidence(text,uuid,uuid,boolean),commerce_private.evidence_access(text,boolean) from public,anon,authenticated,service_role;
grant execute on function commerce_private.evidence_access(text,boolean) to authenticated;
