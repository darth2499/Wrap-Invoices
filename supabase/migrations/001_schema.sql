-- =====================================================================
-- Wrap — database schema
-- Run this whole file once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run: every object is created with IF NOT EXISTS / OR REPLACE.
-- =====================================================================

-- ---------- helpers ----------
create or replace function public.new_token() returns text
language sql volatile as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------- invites (invite-only sign-up) ----------
create table if not exists public.invites (
  email      text primary key,
  is_admin   boolean not null default false,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- profiles (one per user: business settings) ----------
create table if not exists public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  email                text,
  is_admin             boolean not null default false,
  business_name        text,
  business_email       text,
  address              text,
  phone                text,
  website              text,
  logo_key             text,
  template             text not null default 'minimal',
  accent               text not null default '#16161A',
  payment_instructions text,
  footer_note          text,
  next_invoice_number  integer not null default 1,
  next_quote_number    integer not null default 1,
  default_terms_days   integer not null default 30,
  ot_base_hours        numeric(5,2) not null default 10,
  ot_mult1             numeric(5,2) not null default 1.5,
  ot_mult1_hours       numeric(5,2) not null default 2,
  ot_mult2             numeric(5,2) not null default 2,
  reminder_days        integer[] not null default '{3,7,14}',
  auto_remind_default  boolean not null default false,
  mileage_rate         numeric(6,3) not null default 0.70,
  tax_set_aside_pct    numeric(5,2) not null default 25,
  gmail_email          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Only people who hold the private Gmail permission token: never readable from the browser.
create table if not exists public.gmail_tokens (
  owner_id      uuid primary key references auth.users(id) on delete cascade,
  email         text,
  refresh_token text not null,
  updated_at    timestamptz not null default now()
);

-- ---------- clients & projects ----------
create table if not exists public.clients (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name            text not null,
  email           text,
  cc_emails       text,
  address         text,
  phone           text,
  notes           text,
  ot_base_hours   numeric(5,2),
  expects_1099    boolean not null default false,
  statement_token text not null unique default public.new_token(),
  archived        boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (id, owner_id)
);

create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id  uuid,
  name       text not null,
  archived   boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (client_id, owner_id) references public.clients(id, owner_id) on delete set null (client_id)
);

-- ---------- catalog: saved items, gear, day types, taxes ----------
create table if not exists public.catalog_items (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  description text,
  kind        text not null default 'labor' check (kind in ('labor','gear','expense','other')),
  unit        text not null default 'day' check (unit in ('day','hour','week','flat')),
  rate        numeric(12,2) not null default 0,
  week_rate   numeric(12,2),
  ot_eligible boolean not null default false,
  archived    boolean not null default false,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.day_types (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  multiplier numeric(6,3) not null default 1,
  position   integer not null default 0
);

create table if not exists public.tax_rates (
  id       uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name     text not null,
  rate     numeric(6,3) not null default 0
);

-- ---------- invoices & quotes ----------
create table if not exists public.invoices (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind                 text not null default 'invoice' check (kind in ('invoice','quote')),
  number               text not null,
  client_id            uuid,
  project_id           uuid,
  status               text not null default 'draft'
                       check (status in ('draft','sent','paid','void','accepted','declined','converted')),
  issue_date           date not null default current_date,
  due_date             date,
  terms                text,
  notes                text,
  mode                 text not null default 'basic' check (mode in ('basic','advanced')),
  jobs                 jsonb,
  discount_type        text not null default 'amount' check (discount_type in ('amount','percent')),
  discount_value       numeric(12,2) not null default 0,
  deposit_percent      numeric(6,2),
  subtotal             numeric(12,2) not null default 0,
  discount_total       numeric(12,2) not null default 0,
  tax_total            numeric(12,2) not null default 0,
  total                numeric(12,2) not null default 0,
  share_token          text not null unique default public.new_token(),
  sent_at              timestamptz,
  first_viewed_at      timestamptz,
  last_viewed_at       timestamptz,
  view_count           integer not null default 0,
  auto_remind          boolean not null default false,
  last_reminder_at     timestamptz,
  reminders_sent       integer not null default 0,
  version              integer not null default 1,
  quote_id             uuid,
  converted_invoice_id uuid,
  voided_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (owner_id, kind, number),
  unique (id, owner_id),
  foreign key (client_id, owner_id) references public.clients(id, owner_id) on delete restrict,
  foreign key (project_id, owner_id) references public.projects(id, owner_id) on delete set null (project_id),
  foreign key (quote_id, owner_id) references public.invoices(id, owner_id) on delete set null (quote_id),
  foreign key (converted_invoice_id, owner_id) references public.invoices(id, owner_id) on delete set null (converted_invoice_id)
);

-- ---------- receipts ----------
create table if not exists public.receipts (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  vendor       text,
  receipt_date date,
  total        numeric(12,2),
  subtotal     numeric(12,2),
  tax          numeric(12,2),
  tip          numeric(12,2),
  category     text,
  notes        text,
  file_key     text,
  original_key text,
  mime         text,
  file_hash    text,
  status       text not null default 'review' check (status in ('processing','review','confirmed')),
  invoice_id   uuid,
  billable     boolean not null default false,
  ai           jsonb,
  created_at   timestamptz not null default now(),
  unique (owner_id, file_hash),
  unique (id, owner_id),
  foreign key (invoice_id, owner_id) references public.invoices(id, owner_id) on delete set null (invoice_id)
);

create table if not exists public.invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  invoice_id  uuid not null,
  position    integer not null default 0,
  kind        text not null default 'labor' check (kind in ('labor','gear','expense','other')),
  item        text not null default '',
  description text,
  note        text,
  qty         numeric(12,3) not null default 1,
  rate        numeric(12,2) not null default 0,
  amount      numeric(12,2) not null default 0,
  tax_rate    numeric(6,3) not null default 0,
  day_type    text,
  receipt_id  uuid,
  foreign key (invoice_id, owner_id) references public.invoices(id, owner_id) on delete cascade,
  foreign key (receipt_id, owner_id) references public.receipts(id, owner_id) on delete set null (receipt_id)
);

create table if not exists public.invoice_revisions (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  invoice_id uuid not null,
  version    integer not null,
  snapshot   jsonb not null,
  summary    text,
  created_at timestamptz not null default now(),
  foreign key (invoice_id, owner_id) references public.invoices(id, owner_id) on delete cascade
);

create table if not exists public.invoice_events (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  invoice_id uuid not null,
  type       text not null,
  detail     text,
  created_at timestamptz not null default now(),
  foreign key (invoice_id, owner_id) references public.invoices(id, owner_id) on delete cascade
);

create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  invoice_id uuid not null,
  paid_on    date not null default current_date,
  amount     numeric(12,2) not null check (amount <> 0),
  method     text,
  note       text,
  created_at timestamptz not null default now(),
  foreign key (invoice_id, owner_id) references public.invoices(id, owner_id) on delete cascade
);

-- ---------- mileage, crew, 1099 ----------
create table if not exists public.mileage_trips (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trip_date   date not null default current_date,
  start_place text,
  end_place   text,
  miles       numeric(8,1) not null default 0,
  round_trip  boolean not null default false,
  purpose     text,
  client_id   uuid,
  invoice_id  uuid,
  billable    boolean not null default false,
  rate        numeric(6,3) not null default 0.70,
  created_at  timestamptz not null default now(),
  foreign key (client_id, owner_id) references public.clients(id, owner_id) on delete set null (client_id),
  foreign key (invoice_id, owner_id) references public.invoices(id, owner_id) on delete set null (invoice_id)
);

create table if not exists public.crew_members (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  email      text,
  phone      text,
  role       text,
  notes      text,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table if not exists public.crew_payouts (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  crew_id     uuid not null,
  work_date   date not null default current_date,
  client_id   uuid,
  invoice_id  uuid,
  description text,
  amount      numeric(12,2) not null default 0,
  paid_on     date,
  method      text,
  created_at  timestamptz not null default now(),
  foreign key (crew_id, owner_id) references public.crew_members(id, owner_id) on delete restrict,
  foreign key (client_id, owner_id) references public.clients(id, owner_id) on delete set null (client_id),
  foreign key (invoice_id, owner_id) references public.invoices(id, owner_id) on delete set null (invoice_id)
);

create table if not exists public.form1099 (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id       uuid not null,
  tax_year        integer not null,
  amount_reported numeric(12,2),
  note            text,
  unique (owner_id, client_id, tax_year),
  foreign key (client_id, owner_id) references public.clients(id, owner_id) on delete cascade
);

-- ---------- indexes ----------
create index if not exists invoices_owner_idx    on public.invoices(owner_id, kind, status);
create index if not exists invoices_client_idx   on public.invoices(client_id);
create index if not exists lines_invoice_idx     on public.invoice_lines(invoice_id);
create index if not exists payments_invoice_idx  on public.payments(invoice_id);
create index if not exists receipts_owner_idx    on public.receipts(owner_id, receipt_date);
create index if not exists receipts_invoice_idx  on public.receipts(invoice_id);
create index if not exists events_invoice_idx    on public.invoice_events(invoice_id);
create index if not exists revisions_invoice_idx on public.invoice_revisions(invoice_id);
create index if not exists projects_client_idx   on public.projects(client_id);

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists invoices_touch on public.invoices;
create trigger invoices_touch before update on public.invoices for each row execute function public.touch_updated_at();

-- =====================================================================
-- Row Level Security: every row is visible only to the person who owns it.
-- =====================================================================
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

do $$
declare t text;
begin
  foreach t in array array['clients','projects','catalog_items','day_types','tax_rates','invoices',
                           'invoice_lines','invoice_revisions','invoice_events','payments','receipts',
                           'mileage_trips','crew_members','crew_payouts','form1099']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated
                    using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;

alter table public.profiles enable row level security;
drop policy if exists profile_select on public.profiles;
create policy profile_select on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists profile_update on public.profiles;
create policy profile_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Users can't promote themselves to admin.
create or replace function public.protect_admin_flag() returns trigger
language plpgsql as $$
begin
  if new.is_admin is distinct from old.is_admin and coalesce(auth.role(), '') = 'authenticated' then
    new.is_admin := old.is_admin;
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect_admin on public.profiles;
create trigger profiles_protect_admin before update on public.profiles
  for each row execute function public.protect_admin_flag();

alter table public.gmail_tokens enable row level security;  -- no policies: browser can never read it

alter table public.invites enable row level security;
drop policy if exists invites_admin on public.invites;
create policy invites_admin on public.invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
-- Sign-up gate: only invited emails can create an account.
-- =====================================================================
create or replace function public.gate_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.invites where lower(email) = lower(new.email)) then
    raise exception 'WRAP_NOT_INVITED: % is not on the invite list', new.email;
  end if;
  return new;
end $$;

create or replace function public.setup_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare admin boolean;
begin
  select is_admin into admin from public.invites where lower(email) = lower(new.email);
  insert into public.profiles (id, email, is_admin, business_name, business_email)
  values (new.id, new.email, coalesce(admin, false),
          coalesce(new.raw_user_meta_data->>'full_name', ''), new.email)
  on conflict (id) do nothing;

  insert into public.day_types (owner_id, name, multiplier, position) values
    (new.id, 'Full day', 1, 0), (new.id, 'Half day', 0.6, 1), (new.id, 'Travel day', 0.5, 2),
    (new.id, 'Prep / wrap day', 0.5, 3), (new.id, 'Weather hold', 0.5, 4),
    (new.id, 'Cancellation (under 48 h)', 0.5, 5), (new.id, 'Cancellation (under 24 h)', 1, 6);
  return new;
end $$;

drop trigger if exists wrap_gate_new_user on auth.users;
create trigger wrap_gate_new_user before insert on auth.users
  for each row execute function public.gate_new_user();
drop trigger if exists wrap_setup_new_user on auth.users;
create trigger wrap_setup_new_user after insert on auth.users
  for each row execute function public.setup_new_user();

-- =====================================================================
-- Invoice status: recalculated whenever payments or totals change.
-- =====================================================================
create or replace function public.refresh_invoice_status(inv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i record; paid numeric;
begin
  select * into i from public.invoices where id = inv;
  if not found or i.kind <> 'invoice' or i.status in ('void','draft') then return; end if;
  if auth.uid() is not null and i.owner_id <> auth.uid() then return; end if;
  select coalesce(sum(amount), 0) into paid from public.payments where invoice_id = inv and owner_id = i.owner_id;
  if paid >= i.total and i.total > 0 then
    if i.status <> 'paid' then update public.invoices set status = 'paid' where id = inv; end if;
  elsif i.status = 'paid' then
    update public.invoices set status = 'sent' where id = inv;
  end if;
end $$;

create or replace function public.payments_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_invoice_status(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;
drop trigger if exists payments_status on public.payments;
create trigger payments_status after insert or update or delete on public.payments
  for each row execute function public.payments_changed();

-- =====================================================================
-- save_invoice: saves an invoice + its lines in one step.
-- If the invoice was already sent, the old version is kept in invoice_revisions
-- and the share link stays the same.
-- =====================================================================
create or replace function public.save_invoice(inv jsonb, lines jsonb, summary text default null)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := coalesce((inv->>'id')::uuid, gen_random_uuid());
  old record;
  snap jsonb;
  l jsonb;
  pos int := 0;
begin
  select * into old from public.invoices where id = v_id;

  if found and old.status <> 'draft' then
    select jsonb_build_object(
      'invoice', to_jsonb(old),
      'lines', coalesce((select jsonb_agg(to_jsonb(x) order by x.position) from public.invoice_lines x where x.invoice_id = v_id), '[]'::jsonb))
    into snap;
    insert into public.invoice_revisions (invoice_id, version, snapshot, summary)
    values (v_id, old.version, snap, summary);
    insert into public.invoice_events (invoice_id, type, detail)
    values (v_id, 'edited', coalesce(summary, 'Invoice updated (version ' || (old.version + 1) || ')'));
  end if;

  if found then
    update public.invoices set
      number = inv->>'number',
      client_id = nullif(inv->>'client_id','')::uuid,
      project_id = nullif(inv->>'project_id','')::uuid,
      issue_date = coalesce(nullif(inv->>'issue_date','')::date, current_date),
      due_date = nullif(inv->>'due_date','')::date,
      terms = inv->>'terms',
      notes = inv->>'notes',
      mode = coalesce(inv->>'mode','basic'),
      jobs = inv->'jobs',
      discount_type = coalesce(inv->>'discount_type','amount'),
      discount_value = coalesce((inv->>'discount_value')::numeric, 0),
      deposit_percent = nullif(inv->>'deposit_percent','')::numeric,
      subtotal = coalesce((inv->>'subtotal')::numeric, 0),
      discount_total = coalesce((inv->>'discount_total')::numeric, 0),
      tax_total = coalesce((inv->>'tax_total')::numeric, 0),
      total = coalesce((inv->>'total')::numeric, 0),
      auto_remind = coalesce((inv->>'auto_remind')::boolean, auto_remind),
      version = case when old.status <> 'draft' then old.version + 1 else old.version end
    where id = v_id;
  else
    insert into public.invoices (id, kind, number, client_id, project_id, status, issue_date, due_date, terms, notes,
      mode, jobs, discount_type, discount_value, deposit_percent, subtotal, discount_total, tax_total, total, auto_remind, quote_id)
    values (v_id, coalesce(inv->>'kind','invoice'), inv->>'number', nullif(inv->>'client_id','')::uuid,
      nullif(inv->>'project_id','')::uuid, 'draft', coalesce(nullif(inv->>'issue_date','')::date, current_date),
      nullif(inv->>'due_date','')::date, inv->>'terms', inv->>'notes', coalesce(inv->>'mode','basic'), inv->'jobs',
      coalesce(inv->>'discount_type','amount'), coalesce((inv->>'discount_value')::numeric, 0),
      nullif(inv->>'deposit_percent','')::numeric, coalesce((inv->>'subtotal')::numeric, 0),
      coalesce((inv->>'discount_total')::numeric, 0), coalesce((inv->>'tax_total')::numeric, 0),
      coalesce((inv->>'total')::numeric, 0), coalesce((inv->>'auto_remind')::boolean, false),
      nullif(inv->>'quote_id','')::uuid);
    insert into public.invoice_events (invoice_id, type, detail) values (v_id, 'created', null);
  end if;

  delete from public.invoice_lines where invoice_id = v_id;
  for l in select * from jsonb_array_elements(coalesce(lines, '[]'::jsonb)) loop
    insert into public.invoice_lines (invoice_id, position, kind, item, description, note, qty, rate, amount, tax_rate, day_type, receipt_id)
    values (v_id, pos, coalesce(l->>'kind','labor'), coalesce(l->>'item',''), l->>'description', l->>'note',
      coalesce((l->>'qty')::numeric, 1), coalesce((l->>'rate')::numeric, 0), coalesce((l->>'amount')::numeric, 0),
      coalesce((l->>'tax_rate')::numeric, 0), l->>'day_type', nullif(l->>'receipt_id','')::uuid);
    pos := pos + 1;
  end loop;

  perform public.refresh_invoice_status(v_id);
  return v_id;
end $$;

-- Hands out the next invoice/quote number and moves the counter forward.
create or replace function public.take_number(p_kind text) returns integer
language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  loop
    if p_kind = 'quote' then
      update public.profiles set next_quote_number = next_quote_number + 1 where id = auth.uid()
        returning next_quote_number - 1 into n;
    else
      update public.profiles set next_invoice_number = next_invoice_number + 1 where id = auth.uid()
        returning next_invoice_number - 1 into n;
    end if;
    -- Skip numbers already used (e.g. by imported invoices).
    exit when n is null or not exists (
      select 1 from public.invoices where kind = coalesce(p_kind, 'invoice') and number = n::text);
  end loop;
  return n;
end $$;

-- Deletes all of the signed-in person's business data (used by "Restore → replace everything").
create or replace function public.wipe_my_data() returns void
language plpgsql security invoker set search_path = public as $$
begin
  delete from public.crew_payouts;  delete from public.crew_members;
  delete from public.mileage_trips; delete from public.form1099;
  delete from public.payments;      delete from public.invoice_events;
  delete from public.invoice_revisions; delete from public.invoice_lines;
  update public.receipts set invoice_id = null;
  update public.invoices set quote_id = null, converted_invoice_id = null;
  delete from public.invoices;      delete from public.receipts;
  delete from public.projects;      delete from public.clients;
  delete from public.catalog_items; delete from public.day_types; delete from public.tax_rates;
end $$;

grant execute on function public.save_invoice(jsonb, jsonb, text) to authenticated;
grant execute on function public.take_number(text) to authenticated;
grant execute on function public.wipe_my_data() to authenticated;
revoke execute on function public.refresh_invoice_status(uuid) from public, anon;
grant execute on function public.refresh_invoice_status(uuid) to authenticated;
