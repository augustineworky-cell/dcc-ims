-- ============================================================
-- IMS BACKEND v3 · PART 1 of 2 · no editing needed
-- Paste the whole file into Supabase SQL Editor and click Run, ONCE, on a fresh project.
-- Expected last table: DCC | 4 | 0   (admins is 0 until you run part 2)
-- ============================================================

-- STOCKLY IMS · 01 CORE TABLES + SECURITY
-- Multi-company ready. Stock is never stored: it is the sum of stock_movements.

create type public.app_role as enum ('admin', 'manager', 'staff', 'viewer');
create type public.move_type as enum ('opening', 'receipt', 'issue', 'transfer_out', 'transfer_in', 'count_adjust');
create type public.indent_status as enum ('draft', 'approved', 'ordered', 'received', 'cancelled');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  allow_negative_stock boolean not null default false,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  full_name text,
  role public.app_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- who am I ----------
create function public.my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where user_id = auth.uid() and active
$$;

create function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where user_id = auth.uid() and active
$$;


-- today's date in the company's own timezone (the server runs on UTC)
create function public.company_today() returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce(
    (select timezone from public.companies where id = public.my_company()), 'Asia/Kolkata'))::date
$$;

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code text not null,
  name text not null,
  kind text not null default 'warehouse' check (kind in ('warehouse', 'office')),
  active boolean not null default true,
  unique (company_id, code)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  active boolean not null default true,
  unique (company_id, name)
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code text not null,
  name text not null,
  group_name text,
  unit text not null default 'pcs',
  track_batch boolean not null default false,
  lead_time_days integer not null default 7 check (lead_time_days >= 0),
  safety_factor numeric(4,2) not null default 1.20 check (safety_factor >= 1),
  moq numeric(14,3) not null default 0 check (moq >= 0),
  seed_daily_usage numeric(14,3) not null default 0 check (seed_daily_usage >= 0),  -- starting guess until 30 days of real issues exist
  supplier_id uuid references public.suppliers(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, code)
);

-- The ledger. Positive qty = stock in, negative = stock out. Append-only.
create table public.stock_movements (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id),
  item_id uuid not null references public.items(id),
  warehouse_id uuid not null references public.warehouses(id),
  move_type public.move_type not null,
  qty numeric(14,3) not null check (qty <> 0),
  batch_no text,
  expiry_date date,
  ref_no text,
  transfer_id uuid,
  note text,
  occurred_on date not null default public.company_today(),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index stock_movements_item_wh on public.stock_movements (company_id, item_id, warehouse_id);
create index stock_movements_day on public.stock_movements (company_id, occurred_on);
create index stock_movements_transfer on public.stock_movements (transfer_id) where transfer_id is not null;

create function public.block_ledger_edit() returns trigger language plpgsql as $$
begin
  raise exception 'Stock movements cannot be edited or deleted. Post a correcting movement instead.';
end $$;
create trigger stock_movements_append_only
  before update or delete on public.stock_movements
  for each row execute function public.block_ledger_edit();

create table public.stock_counts (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id),
  item_id uuid not null references public.items(id),
  warehouse_id uuid not null references public.warehouses(id),
  system_qty numeric(14,3) not null,
  counted_qty numeric(14,3) not null check (counted_qty >= 0),
  note text,
  counted_by uuid default auth.uid(),
  counted_at timestamptz not null default now()
);

create table public.doc_counters (
  company_id uuid not null references public.companies(id),
  kind text not null,
  last_no integer not null default 0,
  primary key (company_id, kind)
);

create table public.indents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  indent_no text not null,
  status public.indent_status not null default 'draft',
  note text,
  requested_by uuid default auth.uid(),
  approved_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, indent_no)
);

create table public.indent_lines (
  id bigint generated always as identity primary key,
  indent_id uuid not null references public.indents(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  item_id uuid not null references public.items(id),
  qty numeric(14,3) not null check (qty > 0),
  received_qty numeric(14,3) not null default 0 check (received_qty >= 0)
);
create index indent_lines_item on public.indent_lines (company_id, item_id);

-- ---------- row level security ----------
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.warehouses enable row level security;
alter table public.suppliers enable row level security;
alter table public.items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_counts enable row level security;
alter table public.doc_counters enable row level security;
alter table public.indents enable row level security;
alter table public.indent_lines enable row level security;

create policy companies_read on public.companies for select to authenticated using (id = public.my_company());
create policy profiles_read on public.profiles for select to authenticated using (company_id = public.my_company());
create policy profiles_admin on public.profiles for all to authenticated
  using (company_id = public.my_company() and public.my_role() = 'admin')
  with check (company_id = public.my_company() and public.my_role() = 'admin');

create policy wh_read on public.warehouses for select to authenticated using (company_id = public.my_company());
create policy wh_write on public.warehouses for all to authenticated
  using (company_id = public.my_company() and public.my_role() in ('admin', 'manager'))
  with check (company_id = public.my_company() and public.my_role() in ('admin', 'manager'));

create policy sup_read on public.suppliers for select to authenticated using (company_id = public.my_company());
create policy sup_write on public.suppliers for all to authenticated
  using (company_id = public.my_company() and public.my_role() in ('admin', 'manager'))
  with check (company_id = public.my_company() and public.my_role() in ('admin', 'manager'));

create policy items_read on public.items for select to authenticated using (company_id = public.my_company());
create policy items_write on public.items for all to authenticated
  using (company_id = public.my_company() and public.my_role() in ('admin', 'manager'))
  with check (company_id = public.my_company() and public.my_role() in ('admin', 'manager'));

create policy mv_read on public.stock_movements for select to authenticated using (company_id = public.my_company());
-- no insert policy on purpose: the posting functions are the only way to write the ledger

create policy sc_read on public.stock_counts for select to authenticated using (company_id = public.my_company());

create policy dc_all on public.doc_counters for all to authenticated
  using (company_id = public.my_company() and public.my_role() in ('admin', 'manager'))
  with check (company_id = public.my_company() and public.my_role() in ('admin', 'manager'));

create policy ind_read on public.indents for select to authenticated using (company_id = public.my_company());
create policy ind_write on public.indents for all to authenticated
  using (company_id = public.my_company() and public.my_role() in ('admin', 'manager'))
  with check (company_id = public.my_company() and public.my_role() in ('admin', 'manager'));

create policy il_read on public.indent_lines for select to authenticated using (company_id = public.my_company());
create policy il_write on public.indent_lines for all to authenticated
  using (company_id = public.my_company() and public.my_role() in ('admin', 'manager'))
  with check (company_id = public.my_company() and public.my_role() in ('admin', 'manager'));

-- nothing is open to the public (anon) key
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- the ledger and counts are written only by the posting functions (they run as the owner)
revoke insert, update, delete, truncate, references, trigger on public.stock_movements, public.stock_counts from authenticated;

-- STOCKLY IMS · 02 POSTING FUNCTIONS + STOCK VIEWS
-- The app never edits stock. It calls these functions, which write ledger rows.

-- Current stock per item per warehouse
create view public.stock_balance with (security_invoker = true) as
select company_id, item_id, warehouse_id, sum(qty)::numeric(14,3) as qty
from public.stock_movements
group by company_id, item_id, warehouse_id;

create function public._check_refs(p_item uuid, p_wh uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid := public.my_company();
begin
  if v_company is null then raise exception 'Not signed in to a company'; end if;
  if coalesce(public.my_role()::text, 'viewer') = 'viewer' then raise exception 'Your role cannot post stock'; end if;
  if not exists (select 1 from public.items where id = p_item and company_id = v_company and active) then
    raise exception 'Unknown or inactive item';
  end if;
  if not exists (select 1 from public.warehouses where id = p_wh and company_id = v_company and active) then
    raise exception 'Unknown or inactive warehouse';
  end if;
  return v_company;
end $$;

create function public.post_receipt(
  p_item uuid, p_wh uuid, p_qty numeric,
  p_batch text default null, p_expiry date default null,
  p_ref text default null, p_note text default null, p_date date default public.company_today()
) returns bigint language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_id bigint; v_left numeric; r record; v_take numeric;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be more than zero'; end if;
  v_company := public._check_refs(p_item, p_wh);
  insert into public.stock_movements (company_id, item_id, warehouse_id, move_type, qty, batch_no, expiry_date, ref_no, note, occurred_on)
  values (v_company, p_item, p_wh, 'receipt', p_qty, p_batch, p_expiry, p_ref, p_note, p_date)
  returning id into v_id;

  -- tick off open indents for this item, oldest first
  v_left := p_qty;
  for r in
    select l.id, (l.qty - l.received_qty) as open_qty
    from public.indent_lines l join public.indents n on n.id = l.indent_id
    where l.item_id = p_item and l.company_id = v_company
      and n.status in ('approved', 'ordered') and l.qty > l.received_qty
    order by n.created_at, l.id
    for update of l
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.open_qty);
    update public.indent_lines set received_qty = received_qty + v_take where id = r.id;
    v_left := v_left - v_take;
  end loop;
  update public.indents n set status = 'received'
  where n.company_id = v_company and n.status in ('approved', 'ordered')
    and exists (select 1 from public.indent_lines l where l.indent_id = n.id)
    and not exists (select 1 from public.indent_lines l where l.indent_id = n.id and l.qty > l.received_qty);
  return v_id;
end $$;

create function public.post_issue(
  p_item uuid, p_wh uuid, p_qty numeric,
  p_ref text default null, p_note text default null, p_date date default public.company_today()
) returns bigint language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_id bigint; v_bal numeric; v_neg boolean;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be more than zero'; end if;
  v_company := public._check_refs(p_item, p_wh);
  perform pg_advisory_xact_lock(hashtextextended(p_item::text || p_wh::text, 0));
  select coalesce(sum(qty), 0) into v_bal from public.stock_movements where item_id = p_item and warehouse_id = p_wh;
  select allow_negative_stock into v_neg from public.companies where id = v_company;
  if v_bal < p_qty and not coalesce(v_neg, false) then
    raise exception 'Not enough stock. Available: %', v_bal;
  end if;
  insert into public.stock_movements (company_id, item_id, warehouse_id, move_type, qty, ref_no, note, occurred_on)
  values (v_company, p_item, p_wh, 'issue', -p_qty, p_ref, p_note, p_date)
  returning id into v_id;
  return v_id;
end $$;

create function public.post_transfer(
  p_item uuid, p_from uuid, p_to uuid, p_qty numeric,
  p_ref text default null, p_note text default null, p_date date default public.company_today()
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_tid uuid := gen_random_uuid(); v_bal numeric; v_neg boolean;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be more than zero'; end if;
  if p_from = p_to then raise exception 'From and to warehouse are the same'; end if;
  v_company := public._check_refs(p_item, p_from);
  perform public._check_refs(p_item, p_to);
  perform pg_advisory_xact_lock(hashtextextended(p_item::text || p_from::text, 0));
  select coalesce(sum(qty), 0) into v_bal from public.stock_movements where item_id = p_item and warehouse_id = p_from;
  select allow_negative_stock into v_neg from public.companies where id = v_company;
  if v_bal < p_qty and not coalesce(v_neg, false) then
    raise exception 'Not enough stock to transfer. Available: %', v_bal;
  end if;
  insert into public.stock_movements (company_id, item_id, warehouse_id, move_type, qty, ref_no, note, transfer_id, occurred_on)
  values (v_company, p_item, p_from, 'transfer_out', -p_qty, p_ref, p_note, v_tid, p_date),
         (v_company, p_item, p_to,   'transfer_in',   p_qty, p_ref, p_note, v_tid, p_date);
  return v_tid;
end $$;

-- A physical count overrides the computed stock: we post the difference.
create function public.post_count(
  p_item uuid, p_wh uuid, p_counted numeric, p_note text default null
) returns numeric language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_sys numeric; v_diff numeric;
begin
  if p_counted is null or p_counted < 0 then raise exception 'Counted quantity cannot be negative'; end if;
  v_company := public._check_refs(p_item, p_wh);
  perform pg_advisory_xact_lock(hashtextextended(p_item::text || p_wh::text, 0));
  select coalesce(sum(qty), 0) into v_sys from public.stock_movements where item_id = p_item and warehouse_id = p_wh;
  v_diff := p_counted - v_sys;
  insert into public.stock_counts (company_id, item_id, warehouse_id, system_qty, counted_qty, note)
  values (v_company, p_item, p_wh, v_sys, p_counted, p_note);
  if v_diff <> 0 then
    insert into public.stock_movements (company_id, item_id, warehouse_id, move_type, qty, ref_no, note)
    values (v_company, p_item, p_wh, 'count_adjust', v_diff, 'COUNT', coalesce(p_note, 'Physical count'));
  end if;
  return v_diff;
end $$;

-- ---------- stock health + reorder (BCI logic, kept simple) ----------
-- max level = average daily issue (last 30 days) x lead time x safety factor
create view public.item_health with (security_invoker = true) as
with usage as (
  select item_id, sum(-qty) / 30.0 as avg_daily
  from public.stock_movements
  where move_type = 'issue' and occurred_on >= public.company_today() - 30
  group by item_id
), bal as (
  select item_id, sum(qty) as stock from public.stock_movements group by item_id
), hist as (
  select coalesce(min(occurred_on), public.company_today()) as first_day
  from public.stock_movements where move_type = 'issue'
), calc as (
  select i.company_id, i.id as item_id, i.code, i.name, i.group_name, i.unit,
         coalesce(b.stock, 0)::numeric(14,3) as stock,
         (case when h.first_day > public.company_today() - 30
               then greatest(coalesce(u.avg_daily, 0), i.seed_daily_usage)   -- less than 30 days of history: never go below the starting guess
               else coalesce(u.avg_daily, 0) end)::numeric(14,3) as avg_daily,
         ceil((case when h.first_day > public.company_today() - 30
               then greatest(coalesce(u.avg_daily, 0), i.seed_daily_usage)
               else coalesce(u.avg_daily, 0) end) * i.lead_time_days * i.safety_factor)::numeric(14,3) as max_level
  from public.items i
  cross join hist h
  left join bal b on b.item_id = i.id
  left join usage u on u.item_id = i.id
  where i.active
)
select *,
  case when max_level > 0 then round(100 * stock / max_level) end as pct,
  case
    when stock <= 0 then 'out'
    when max_level = 0 then 'no-usage'
    when 100 * stock / max_level <= 33 then 'critical'
    when 100 * stock / max_level <= 66 then 'low'
    when 100 * stock / max_level <= 100 then 'healthy'
    else 'over'
  end as band
from calc;

create view public.reorder_suggestions with (security_invoker = true) as
with ordered as (
  select l.item_id, sum(l.qty - l.received_qty) as on_order
  from public.indent_lines l join public.indents n on n.id = l.indent_id
  where n.status in ('draft', 'approved', 'ordered')
  group by l.item_id
), x as (
  select h.company_id, h.item_id, h.code, h.name, h.unit, h.stock, h.max_level, h.band,
         coalesce(o.on_order, 0) as on_order, i.moq
  from public.item_health h
  join public.items i on i.id = h.item_id
  left join ordered o on o.item_id = h.item_id
  where h.max_level > 0
)
select company_id, item_id, code, name, unit, stock, on_order, max_level, band,
  (case when moq > 0 then ceil((max_level - stock - on_order) / moq) * moq
        else ceil(max_level - stock - on_order) end)::numeric(14,3) as suggested_qty
from x
where stock + on_order <= max_level * 0.66;

-- Next number like IND-18, per company
create function public.next_no(p_kind text, p_prefix text) returns text
language plpgsql as $$
declare v_company uuid := public.my_company(); v_n integer;
begin
  insert into public.doc_counters (company_id, kind, last_no) values (v_company, p_kind, 1)
  on conflict (company_id, kind) do update set last_no = public.doc_counters.last_no + 1
  returning last_no into v_n;
  return p_prefix || '-' || v_n;
end $$;

-- One click: draft an indent from every reorder suggestion
create function public.create_indent_from_suggestions(p_note text default null) returns uuid
language plpgsql as $$
declare v_company uuid := public.my_company(); v_id uuid;
begin
  if coalesce(public.my_role()::text, '') not in ('admin', 'manager') then raise exception 'Only a manager or admin can create indents'; end if;
  if not exists (select 1 from public.reorder_suggestions where suggested_qty > 0) then
    raise exception 'Nothing to reorder right now';
  end if;
  insert into public.indents (company_id, indent_no, note)
  values (v_company, public.next_no('indent', 'IND'), p_note) returning id into v_id;
  insert into public.indent_lines (indent_id, company_id, item_id, qty)
  select v_id, v_company, item_id, suggested_qty from public.reorder_suggestions where suggested_qty > 0;
  return v_id;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- STOCKLY IMS · 03 FIRST COMPANY, WAREHOUSES, ADMIN
-- Safe to run more than once.

insert into public.companies (name, code)
values ('DCC Supply Chain & Distribution LLP', 'DCC')
on conflict (code) do nothing;

insert into public.warehouses (company_id, code, name, kind)
select c.id, v.code, v.name, v.kind
from public.companies c,
     (values ('OKH', 'Okhla C-34', 'warehouse'),
             ('CHT', 'Chattarpur', 'warehouse'),
             ('GGN', 'Gurgaon', 'warehouse'),
             ('SDJ', 'Safdarjung HO', 'office')) as v(code, name, kind)
where c.code = 'DCC'
on conflict (company_id, code) do nothing;

-- Check: you should see DCC and 4 warehouses. Admins is 0 for now; the second snippet links your login.
select c.code as company,
       (select count(*) from public.warehouses w where w.company_id = c.id) as warehouses,
       (select count(*) from public.profiles p where p.company_id = c.id and p.role = 'admin') as admins
from public.companies c;
