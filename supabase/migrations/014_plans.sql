-- Run once in the Supabase SQL Editor (already included in 001_schema.sql for new setups).

-- Plans: "user" (everything except uploading receipt files) or "pro" (can upload receipts).
-- The owner always has everything. Only the owner can change someone's plan (from Settings → People).
alter table public.profiles add column if not exists plan text not null default 'user';
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check check (plan in ('user', 'pro'));

-- Nobody can upgrade themselves from the browser.
create or replace function public.protect_admin_flag() returns trigger
language plpgsql as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    if new.is_admin is distinct from old.is_admin then new.is_admin := old.is_admin; end if;
    if new.plan is distinct from old.plan then new.plan := old.plan; end if;
  end if;
  return new;
end $$;
