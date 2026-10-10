-- Run once in the Supabase SQL Editor (already included in 001_schema.sql for new setups).

-- Networks you've used Wrap from (stored only as a hash, kept 60 days), so opening a client link
-- yourself from one of them isn't counted as the client viewing it.
alter table public.profiles add column if not exists own_ips jsonb not null default '[]'::jsonb;
