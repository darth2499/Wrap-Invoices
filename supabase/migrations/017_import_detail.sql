-- "Import to Wrap": a copy of every line of the imported invoice (shown on the payout so it's easy to copy).
alter table public.crew_payouts add column if not exists source_detail jsonb;
