-- "Import to Wrap": an invoice someone sent you, added to your crew payouts as a bill to pay.
alter table public.crew_payouts add column if not exists due_date date;
alter table public.crew_payouts add column if not exists source_number text;  -- their invoice #
alter table public.crew_payouts add column if not exists source_token text;   -- the link they sent you (to view it again)
alter table public.crew_payouts add column if not exists source_key text;     -- fingerprint of their invoice (no ids of theirs); one import per invoice across Wrap
alter table public.crew_payouts add column if not exists source_version text; -- to notice when they change it
create unique index if not exists crew_payouts_source_key on public.crew_payouts (source_key) where source_key is not null;
