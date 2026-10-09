-- Run once in the Supabase SQL Editor (already included in 001_schema.sql for new setups).

-- Invoice look: show just your logo top-left, or your logo with your name under it.
alter table public.profiles add column if not exists logo_mode text not null default 'logo';

-- Crew addresses (for their 1099s).
alter table public.crew_members add column if not exists address text;

-- Live updates: when a client opens an invoice (or accepts a quote) while Wrap is open, you see it right away.
-- Row-level security still applies, so each account only ever hears about its own invoices.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invoices') then
    alter publication supabase_realtime add table public.invoices;
  end if;
exception when undefined_object then null; -- no realtime publication on this database
end $$;
