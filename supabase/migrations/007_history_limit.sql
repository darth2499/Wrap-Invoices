-- Run once in the Supabase SQL Editor (already included in 001_schema.sql for new setups).

-- ---------- keep invoice history from growing forever ----------
-- Each invoice keeps its 20 most recent earlier versions and 60 most recent history events.
create or replace function public.trim_invoice_history() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if tg_table_name = 'invoice_revisions' then
    delete from public.invoice_revisions
    where invoice_id = new.invoice_id
      and id not in (select id from public.invoice_revisions where invoice_id = new.invoice_id order by version desc, created_at desc limit 20);
  else
    delete from public.invoice_events
    where invoice_id = new.invoice_id
      and id not in (select id from public.invoice_events where invoice_id = new.invoice_id order by created_at desc limit 60);
  end if;
  return null;
end $$;
drop trigger if exists revisions_trim on public.invoice_revisions;
create trigger revisions_trim after insert on public.invoice_revisions for each row execute function public.trim_invoice_history();
drop trigger if exists events_trim on public.invoice_events;
create trigger events_trim after insert on public.invoice_events for each row execute function public.trim_invoice_history();
