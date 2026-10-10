-- Receipts that learn from corrections (shared between everyone, privately).
-- scan_votes: one row per person per store per rule. "voter" is a scrambled tag (HMAC made on the server),
-- not a user id. No amounts, dates, pictures or receipt text. Only the server functions can read or write these.
create table if not exists public.scan_votes (
  vendor_key text not null,
  rule       text not null check (rule in ('total_label','tip','date_order','category')),
  value      text not null,
  voter      text not null,
  updated_at timestamptz not null default now(),
  primary key (vendor_key, rule, voter)
);
create index if not exists scan_votes_voter on public.scan_votes (voter);
alter table public.scan_votes enable row level security; -- no policies: nobody can read it from the app

-- How often scans needed fixing (for the owner's accuracy numbers): counts only.
create table if not exists public.scan_stats (
  day   date primary key,
  reads integer not null default 0,
  fixed integer not null default 0
);
alter table public.scan_stats enable row level security;

create or replace function public.scan_stat(p_fixed boolean) returns void
language sql security definer set search_path = public as $$
  insert into public.scan_stats (day, reads, fixed) values (current_date, 1, case when p_fixed then 1 else 0 end)
  on conflict (day) do update set reads = scan_stats.reads + 1, fixed = scan_stats.fixed + excluded.fixed;
$$;
revoke execute on function public.scan_stat(boolean) from public, anon, authenticated;
