-- Run once in the Supabase SQL Editor (already included in 001_schema.sql for new setups).

-- ---------- client links only exist once an invoice is sent ----------
-- Drafts have no link at all. Sending (email or "Copy link") creates one; "Turn off link" removes it.
alter table public.invoices alter column share_token drop not null;
alter table public.invoices alter column share_token drop default;
update public.invoices set share_token = null where status = 'draft' and share_token is not null;

-- Creates the client link for one of your invoices (or returns the existing one).
create or replace function public.share_link(p_invoice uuid) returns text
language sql volatile security invoker set search_path = public as $$
  update public.invoices set share_token = coalesce(share_token, public.new_token())
  where id = p_invoice and owner_id = auth.uid()
  returning share_token
$$;
revoke execute on function public.share_link(uuid) from public, anon;
grant execute on function public.share_link(uuid) to authenticated;

-- ---------- lock-down: signed-out visitors can't touch any table or function directly ----------
-- (Client links go through the "public" server function, which checks the secret link itself.)
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon;
