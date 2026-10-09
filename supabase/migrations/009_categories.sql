-- Run once in the Supabase SQL Editor (already included in 001_schema.sql for new setups).

-- ---------- your own expense categories ----------
alter table public.profiles add column if not exists custom_categories jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists hidden_categories jsonb not null default '[]'::jsonb;
