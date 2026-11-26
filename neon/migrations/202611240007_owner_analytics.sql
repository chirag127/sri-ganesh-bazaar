-- Counts only: no customer identifiers, free text, or private unit prices.
-- STABLE uses the calling statement snapshot for authorization and every count.
-- A revocation committed before the statement is visible; an already-running
-- report may finish on its prior authorized snapshot. No mutation lock is held.
create index owner_analytics_enquiries_created_idx on commerce_private.command_requests(created_at) where action='submit_enquiry';
create index owner_analytics_accepted_created_idx on public.orders(created_at) where status in ('accepted','ready','dispatched','completed');
create index owner_analytics_bills_issued_idx on public.bills(issued_at);
create index owner_analytics_pending_created_idx on public.product_requests(created_at) where status='pending';
create index owner_analytics_low_stock_idx on public.inventory(variant_id) where on_hand-reserved <= reorder_level;
create function public.owner_analytics(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 if current_setting('transaction_isolation') <> 'read committed' then raise exception 'READ COMMITTED required'; end if;
 perform commerce_private.require_user();
 perform commerce_private.require_admin();
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
 or p_to < p_from or p_to-p_from > 365 then raise exception 'Provide a date range of at most 366 days'; end if;
 select jsonb_build_object(
 'from_date',p_from,'to_date',p_to,'timezone','Asia/Kolkata',
 'enquiries_created',(select count(*) from commerce_private.command_requests where action='submit_enquiry' and created_at >= (p_from::timestamp at time zone 'Asia/Kolkata') and created_at < ((p_to+1)::timestamp at time zone 'Asia/Kolkata')),
 'accepted_orders_current',(select count(*) from public.orders where created_at >= (p_from::timestamp at time zone 'Asia/Kolkata') and created_at < ((p_to+1)::timestamp at time zone 'Asia/Kolkata') and status in ('accepted','ready','dispatched','completed')),
 'billed_sales',(select count(*) from public.bills where issued_at >= (p_from::timestamp at time zone 'Asia/Kolkata') and issued_at < ((p_to+1)::timestamp at time zone 'Asia/Kolkata')),
 'pending_requests_created',(select count(*) from public.product_requests where created_at >= (p_from::timestamp at time zone 'Asia/Kolkata') and created_at < ((p_to+1)::timestamp at time zone 'Asia/Kolkata') and status='pending'),
 'low_stock_now',(select count(*) from public.inventory i join public.variants v on v.id=i.variant_id join public.products p on p.id=v.product_id where p.active and v.active and i.on_hand-i.reserved <= i.reorder_level)
 ) into result;
 return result;
end $$;
revoke all on function public.owner_analytics(date,date) from public,commerce_guest,commerce_worker;
grant execute on function public.owner_analytics(date,date) to commerce_runtime;
