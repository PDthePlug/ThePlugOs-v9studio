create table if not exists shops (
  id text primary key,
  user_id text not null unique,
  name text not null,
  branch_name text not null,
  onboarding_status text not null default 'COMPLETED',
  created_at timestamptz not null default now()
);
create index if not exists shops_user_id_idx on shops (user_id);

create table if not exists staff (
  id text primary key,
  user_id text not null,
  name text not null,
  role text not null,
  pin_hash text not null,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now()
);
create index if not exists staff_user_id_idx on staff (user_id);

create table if not exists products (
  id text primary key,
  user_id text not null,
  name text not null,
  category text not null,
  price_cents integer not null,
  stock numeric(12,3) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists products_user_id_idx on products (user_id);

create table if not exists devices (
  id text primary key,
  user_id text not null,
  name text not null,
  role text not null,
  status text not null default 'ACTIVE',
  last_seen timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists devices_user_id_idx on devices (user_id);

create table if not exists pairing_codes (
  id text primary key,
  user_id text not null,
  code_hash text not null,
  role text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists pairing_codes_user_id_idx on pairing_codes (user_id);

create table if not exists staff_sessions (
  id text primary key,
  user_id text not null,
  staff_id text not null,
  role text not null,
  device_id text,
  created_at timestamptz not null default now()
);
create index if not exists staff_sessions_user_id_idx on staff_sessions (user_id);

create table if not exists cash_shifts (
  id text primary key,
  user_id text not null,
  status text not null,
  opened_by text not null,
  opening_float_cents integer not null default 0,
  expected_cents integer,
  counted_cents integer,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists cash_shifts_user_id_idx on cash_shifts (user_id);

create table if not exists orders (
  id text primary key,
  user_id text not null,
  number integer not null,
  status text not null,
  cashier_id text,
  cashier_name text,
  payment_status text not null default 'UNPAID',
  tendered_cents integer,
  total_cents integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_user_id_idx on orders (user_id);

create table if not exists order_items (
  id text primary key,
  order_id text not null,
  user_id text not null,
  product_id text,
  name text not null,
  qty integer not null,
  price_cents integer not null
);
create index if not exists order_items_order_id_idx on order_items (order_id);

create table if not exists inventory_moves (
  id text primary key,
  user_id text not null,
  product_id text not null,
  kind text not null,
  qty numeric(12,3) not null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists inventory_moves_user_id_idx on inventory_moves (user_id);

create table if not exists outbox (
  id text primary key,
  user_id text not null,
  kind text not null,
  payload text not null,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  acked_at timestamptz
);
create index if not exists outbox_user_id_idx on outbox (user_id);
