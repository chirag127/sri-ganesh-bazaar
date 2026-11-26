-- All client writes go through the transaction dispatcher. No costs or exact stock
-- are exposed by the public catalog. Money is integer INR paise throughout.
create schema if not exists commerce_private;
revoke all on schema commerce_private from public, commerce_guest, commerce_runtime, commerce_worker;
grant usage on schema commerce_private to commerce_runtime;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references commerce_identity.users(id) on delete set null,
  name text not null check (length(name) between 1 and 120),
  phone text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  phone_status text not null default 'unverified' check (phone_status in ('unverified','sms_verified','staff_confirmed')),
  phone_version integer not null default 0,
  email text,
  address text check (length(address) <= 1000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (phone is not null or phone_status = 'unverified')
);
create index customers_name_idx on public.customers(lower(name), id);
create index customers_phone_idx on public.customers(phone);

create table public.admins (
  user_id uuid primary key references commerce_identity.users(id) on delete restrict,
  appointed_by uuid,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 100),
  name text not null check (length(name) between 1 and 160),
  category text not null check (length(category) between 1 and 80),
  description text not null default '' check (length(description) <= 4000),
  image_url text check (image_url is null or (image_url ~ '^https://' and length(image_url) <= 2048)),
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  label text not null check (length(label) between 1 and 120),
  weight_kg numeric(10,3) not null check (weight_kg > 0 and weight_kg <= 10000),
  reference_price_paise bigint not null check (reference_price_paise between 0 and 1000000000000),
  active boolean not null default true,
  unique(product_id, label)
);
create table public.inventory (
  variant_id uuid primary key references public.variants(id),
  on_hand integer not null default 0 check (on_hand between 0 and 10000000),
  reserved integer not null default 0 check (reserved between 0 and on_hand),
  average_cost_paise bigint not null default 0 check (average_cost_paise between 0 and 1000000000000),
  reorder_level integer not null default 0 check (reorder_level >= 0)
);

create sequence commerce_private.order_number;
create sequence commerce_private.bill_number;
create sequence commerce_private.receipt_number;
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('SGB-O-' || lpad(nextval('commerce_private.order_number')::text, 8, '0')),
  customer_id uuid not null references public.customers(id),
  status text not null default 'enquiry' check (status in ('enquiry','quoted','accepted','ready','dispatched','completed','cancelled')),
  fulfillment text not null check (fulfillment in ('pickup','own_driver','shop_delivery')),
  address text check (length(address) <= 1000),
  notes text check (length(notes) <= 2000),
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  current_quote_id uuid,
  cash_collector text not null default 'shop' check (cash_collector in ('shop','driver')),
  driver_name text check (length(driver_name) <= 120),
  driver_phone text check (driver_phone ~ '^\+[1-9][0-9]{7,14}$'),
  handover_mode text check (handover_mode in ('paid','credit','cod')),
  handover_note text,
  cod_amount_paise bigint not null default 0 check (cod_amount_paise >= 0),
  handed_over_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cash_collector <> 'driver' or (fulfillment <> 'pickup' and driver_name is not null and driver_phone is not null))
);
create index orders_customer_created_idx on public.orders(customer_id, created_at desc, id);
create index orders_created_idx on public.orders(created_at desc, id);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  version integer not null check (version > 0),
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  goods_total_paise bigint not null check (goods_total_paise between 0 and 1000000000000),
  transport_paise bigint not null check (transport_paise between 0 and 1000000000000),
  total_paise bigint not null check (total_paise = goods_total_paise + transport_paise and total_paise <= 1000000000000),
  deposit_paise bigint not null check (deposit_paise between 0 and total_paise),
  expires_at timestamptz not null,
  reservation_until timestamptz not null,
  notes text not null default '' check (length(notes) <= 2000),
  credit_approved boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique(order_id,version),
  check (expires_at = created_at + interval '48 hours'),
  check (reservation_until > created_at and reservation_until <= created_at + interval '30 days')
);
alter table public.orders add constraint orders_quote_fk foreign key (current_quote_id) references public.quotes(id);
create table public.reservations (
  order_id uuid not null references public.orders(id),
  variant_id uuid not null references public.variants(id),
  quantity integer not null check (quantity between 1 and 10000),
  primary key(order_id,variant_id)
);
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.variants(id),
  order_id uuid references public.orders(id),
  quantity_delta integer not null,
  reserved_delta integer not null default 0,
  unit_cost_paise bigint,
  reason text not null,
  actor_id uuid,
  created_at timestamptz not null default now(),
  check (quantity_delta <> 0 or reserved_delta <> 0)
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  order_id uuid references public.orders(id),
  kind text not null check (kind in ('opening_balance','payment','sale','return','refund')),
  amount_paise bigint not null check (amount_paise <> 0 and amount_paise between -1000000000000 and 1000000000000),
  reverses_entry_id uuid references public.ledger_entries(id),
  note text not null check (length(note) between 1 and 2000),
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  check ((kind in ('payment','return') and amount_paise < 0) or (kind in ('sale','refund') and amount_paise > 0) or kind = 'opening_balance')
);
create index ledger_customer_created_idx on public.ledger_entries(customer_id, created_at desc, id);
create index ledger_order_idx on public.ledger_entries(order_id);
-- Allocation moves existing account credit onto an order; it NEVER posts a second
-- negative ledger entry. Pending-order allocations are excluded from refundability.
create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  order_id uuid not null references public.orders(id),
  ledger_entry_id uuid references public.ledger_entries(id),
  amount_paise bigint not null check (amount_paise <> 0),
  note text not null,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index allocations_order_idx on public.payment_allocations(order_id);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('SGB-B-' || lpad(nextval('commerce_private.bill_number')::text, 8, '0')),
  order_id uuid not null unique references public.orders(id),
  customer_id uuid not null references public.customers(id),
  issued_at timestamptz not null default now(),
  total_paise bigint not null check (total_paise between 0 and 1000000000000),
  lines jsonb not null,
  transport_paise bigint not null check (transport_paise >= 0),
  ledger_entry_id uuid references public.ledger_entries(id)
);
-- Historical costs never appear in bills, quote JSON, or public product rows.
create table commerce_private.sale_costs (
  order_id uuid not null references public.orders(id),
  variant_id uuid not null references public.variants(id),
  quantity integer not null,
  unit_cost_paise bigint not null,
  primary key(order_id,variant_id)
);
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('SGB-R-' || lpad(nextval('commerce_private.receipt_number')::text, 8, '0')),
  customer_id uuid not null references public.customers(id),
  order_id uuid references public.orders(id),
  kind text not null check (kind in ('payment','refund','driver_remittance')),
  amount_paise bigint not null check (amount_paise between 1 and 1000000000000),
  method text not null check (method in ('cash','upi')),
  reference text check (length(reference) <= 200),
  collector text not null default 'shop' check (collector in ('shop','driver')),
  verification_note text,
  note text not null,
  ledger_entry_id uuid references public.ledger_entries(id),
  actor_id uuid not null,
  issued_at timestamptz not null default now(),
  check ((kind = 'driver_remittance' and ledger_entry_id is null) or (kind <> 'driver_remittance' and ledger_entry_id is not null))
);
create index receipts_customer_idx on public.receipts(customer_id, issued_at desc);
create index receipts_order_idx on public.receipts(order_id);
create unique index upi_incoming_reference_unique on public.receipts(lower(reference)) where method = 'upi' and kind = 'payment';
create table public.driver_cash_entries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  receipt_id uuid not null unique references public.receipts(id),
  payment_id uuid not null references public.receipts(id),
  amount_paise bigint not null check (amount_paise <> 0),
  driver_name text not null,
  driver_phone text not null,
  note text not null,
  actor_id uuid not null,
  created_at timestamptz not null default now()
);

create table public.payment_submissions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  order_id uuid not null references public.orders(id),
  amount_paise bigint not null check (amount_paise between 1 and 1000000000000),
  reference text not null check (length(reference) between 1 and 200),
  screenshot_path text unique,
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  receipt_id uuid unique references public.receipts(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index payment_submissions_customer_idx on public.payment_submissions(customer_id, created_at desc);
create table public.returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  customer_id uuid not null references public.customers(id),
  bill_id uuid not null references public.bills(id),
  lines jsonb not null,
  amount_paise bigint not null check (amount_paise between 0 and 1000000000000),
  ledger_entry_id uuid references public.ledger_entries(id),
  note text not null,
  actor_id uuid not null,
  created_at timestamptz not null default now()
);
create index returns_order_idx on public.returns(order_id);
create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  order_id uuid not null unique references public.orders(id),
  amount_paise bigint not null check (amount_paise > 0),
  refunded_paise bigint not null default 0 check (refunded_paise >= 0 and refunded_paise <= amount_paise),
  status text not null default 'pending' check (status in ('pending','completed')),
  created_at timestamptz not null default now()
);
create table public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  user_id uuid not null,
  reason text,
  status text not null default 'requested' check (status in ('requested','processing','completed','rejected')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index deletion_one_open on public.deletion_requests(customer_id) where status in ('requested','processing');
create index deletion_subject_idx on public.deletion_requests(user_id);
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  entity_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table commerce_private.command_requests (
  actor_id uuid not null,
  request_id uuid not null,
  action text not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,request_id)
);

create table commerce_private.server_settings (
  singleton boolean primary key default true check (singleton),
  sms_enabled boolean not null default false,
  sms_daily_limit integer not null default 8 check (sms_daily_limit between 0 and 100),
  email_enabled boolean not null default false,
  email_daily_limit integer not null default 250 check (email_daily_limit between 0 and 300),
  push_enabled boolean not null default false
);
insert into commerce_private.server_settings(singleton) values (true);
create table commerce_private.phone_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  customer_id uuid not null references public.customers(id),
  phone text not null,
  phone_version integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  used_at timestamptz,
  invalidated_at timestamptz,
  firebase_uid text
);
create index phone_challenges_daily_idx on commerce_private.phone_challenges(created_at, user_id);
create table commerce_private.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references commerce_identity.users(id) on delete cascade,
  installation_id uuid not null unique,
  token text not null unique check (length(token) between 10 and 4096),
  platform text not null check (platform in ('web','android','ios')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table commerce_private.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  customer_id uuid references public.customers(id),
  channel text not null check (channel in ('email','push')),
  event text not null,
  payload jsonb not null,
  priority integer not null default 50,
  installation_id uuid,
  state text not null default 'queued' check (state in ('queued','processing','sent','failed','uncertain')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  leased_until timestamptz,
  current_attempt_id uuid,
  provider_id text,
  last_error text,
  created_at timestamptz not null default now()
);
create index outbox_ready_idx on commerce_private.notification_outbox(state,available_at,priority);
create table commerce_private.notification_attempts (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references commerce_private.notification_outbox(id),
  channel text not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create function commerce_private.immutable_record() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  raise exception using errcode = '55000', message = 'Posted records are immutable; post a linked correction instead';
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['ledger_entries','payment_allocations','bills','receipts','returns','inventory_movements','driver_cash_entries','quotes','audit_log'] loop
    execute format('create trigger immutable_record before update or delete on public.%I for each row execute function commerce_private.immutable_record()', t);
  end loop;
end;
$$;

-- RLS is a second boundary even for tables the browser has no write grants on.
do $$
declare t text;
begin
  foreach t in array array['customers','admins','products','variants','inventory','orders','quotes','reservations','inventory_movements','ledger_entries','payment_allocations','bills','receipts','driver_cash_entries','payment_submissions','returns','refund_requests','deletion_requests','audit_log'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, commerce_guest, commerce_runtime, commerce_worker',t);
  end loop;
  foreach t in array array['sale_costs','command_requests','server_settings','phone_challenges','push_devices','notification_outbox','notification_attempts'] loop
    execute format('alter table commerce_private.%I enable row level security',t);
    execute format('revoke all on commerce_private.%I from public, commerce_guest, commerce_runtime, commerce_worker',t);
  end loop;
end;
$$;
revoke all on all sequences in schema commerce_private from public, commerce_guest, commerce_runtime, commerce_worker;
revoke all on all functions in schema commerce_private from public, commerce_guest, commerce_runtime, commerce_worker;
