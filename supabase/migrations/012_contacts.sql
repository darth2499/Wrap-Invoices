-- Run once in the Supabase SQL Editor (already included in 001_schema.sql for new setups).

-- A contact person for each client (the client name stays the company). Emails greet the first name.
alter table public.clients add column if not exists contact_first text;
alter table public.clients add column if not exists contact_last text;

-- Ready-made logo (circle, square, ring, bar, stack), drawn from your name: no upload needed.
alter table public.profiles add column if not exists logo_preset text;
