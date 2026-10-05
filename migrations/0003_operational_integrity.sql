alter table staff add column failed_attempts integer not null default 0;
alter table staff add column locked_until timestamptz;
alter table devices add column token_hash text;
alter table pairing_codes add column attempts integer not null default 0;
alter table orders add column request_id text;
alter table orders add column request_payload text;
alter table orders add column shift_id text;
alter table orders add column paid_at timestamptz;
create unique index devices_token_unique on devices(token_hash) where token_hash is not null;
create unique index orders_request_unique on orders(user_id, request_id) where request_id is not null;
create unique index orders_number_unique on orders(user_id, number);
create unique index shifts_one_open on cash_shifts(user_id) where status = 'OPEN';
alter table products add constraint products_price_valid check (price_cents >= 0);
alter table products add constraint products_stock_valid check (stock >= 0);
alter table order_items add constraint items_quantity_valid check (qty > 0);
alter table order_items add constraint items_price_valid check (price_cents >= 0);
create index orders_paid_at_idx on orders(user_id, paid_at);
create index orders_shift_idx on orders(user_id, shift_id);
create table business_commands (
  user_id text not null,
  request_id text not null,
  payload text not null,
  created_at timestamptz not null default now(),
  primary key(user_id, request_id)
);
