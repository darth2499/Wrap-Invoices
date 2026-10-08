-- Run once in the Supabase SQL Editor (already included in 001_schema.sql for new setups).

-- Shoot dates picked on each invoice line (shown on the Calendar), and history that doesn't pile up.
alter table public.invoice_lines add column if not exists dates jsonb;

create or replace function public.save_invoice(inv jsonb, lines jsonb, summary text default null)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := coalesce((inv->>'id')::uuid, gen_random_uuid());
  old record;
  snap jsonb;
  l jsonb;
  pos int := 0;
  merged boolean := false;
begin
  select * into old from public.invoices where id = v_id;

  -- Rapid edits (within 10 minutes of the last saved version) are merged into that version,
  -- so toggling things back and forth doesn't pile up history.
  if found and old.status <> 'draft' and exists (
    select 1 from public.invoice_revisions r where r.invoice_id = v_id and r.created_at > now() - interval '10 minutes'
  ) then
    update public.invoice_events set detail = coalesce(summary, detail), created_at = now()
    where id = (select id from public.invoice_events where invoice_id = v_id and type = 'edited' order by created_at desc limit 1);
    merged := true;
  elsif found and old.status <> 'draft' then
    select jsonb_build_object(
      'invoice', to_jsonb(old),
      'lines', coalesce((select jsonb_agg(to_jsonb(x) order by x.position) from public.invoice_lines x where x.invoice_id = v_id), '[]'::jsonb))
    into snap;
    insert into public.invoice_revisions (invoice_id, version, snapshot, summary)
    values (v_id, old.version, snap, summary);
    insert into public.invoice_events (invoice_id, type, detail)
    values (v_id, 'edited', coalesce(summary, 'Invoice updated (version ' || (old.version + 1) || ')'));
  end if;

  if found then
    update public.invoices set
      number = inv->>'number',
      client_id = nullif(inv->>'client_id','')::uuid,
      project_id = nullif(inv->>'project_id','')::uuid,
      issue_date = coalesce(nullif(inv->>'issue_date','')::date, current_date),
      due_date = nullif(inv->>'due_date','')::date,
      terms = inv->>'terms',
      notes = inv->>'notes',
      mode = coalesce(inv->>'mode','basic'),
      jobs = inv->'jobs',
      discount_type = coalesce(inv->>'discount_type','amount'),
      discount_value = coalesce((inv->>'discount_value')::numeric, 0),
      deposit_percent = nullif(inv->>'deposit_percent','')::numeric,
      subtotal = coalesce((inv->>'subtotal')::numeric, 0),
      discount_total = coalesce((inv->>'discount_total')::numeric, 0),
      tax_total = coalesce((inv->>'tax_total')::numeric, 0),
      total = coalesce((inv->>'total')::numeric, 0),
      auto_remind = coalesce((inv->>'auto_remind')::boolean, auto_remind),
      version = case when old.status <> 'draft' and not merged then old.version + 1 else old.version end
    where id = v_id;
  else
    insert into public.invoices (id, kind, number, client_id, project_id, status, issue_date, due_date, terms, notes,
      mode, jobs, discount_type, discount_value, deposit_percent, subtotal, discount_total, tax_total, total, auto_remind, quote_id)
    values (v_id, coalesce(inv->>'kind','invoice'), inv->>'number', nullif(inv->>'client_id','')::uuid,
      nullif(inv->>'project_id','')::uuid, 'draft', coalesce(nullif(inv->>'issue_date','')::date, current_date),
      nullif(inv->>'due_date','')::date, inv->>'terms', inv->>'notes', coalesce(inv->>'mode','basic'), inv->'jobs',
      coalesce(inv->>'discount_type','amount'), coalesce((inv->>'discount_value')::numeric, 0),
      nullif(inv->>'deposit_percent','')::numeric, coalesce((inv->>'subtotal')::numeric, 0),
      coalesce((inv->>'discount_total')::numeric, 0), coalesce((inv->>'tax_total')::numeric, 0),
      coalesce((inv->>'total')::numeric, 0), coalesce((inv->>'auto_remind')::boolean, false),
      nullif(inv->>'quote_id','')::uuid);
    insert into public.invoice_events (invoice_id, type, detail) values (v_id, 'created', null);
  end if;

  delete from public.invoice_lines where invoice_id = v_id;
  for l in select * from jsonb_array_elements(coalesce(lines, '[]'::jsonb)) loop
    insert into public.invoice_lines (invoice_id, position, kind, item, description, note, qty, rate, amount, tax_rate, day_type, receipt_id, dates)
    values (v_id, pos, coalesce(l->>'kind','labor'), coalesce(l->>'item',''), l->>'description', l->>'note',
      coalesce((l->>'qty')::numeric, 1), coalesce((l->>'rate')::numeric, 0), coalesce((l->>'amount')::numeric, 0),
      coalesce((l->>'tax_rate')::numeric, 0), l->>'day_type', nullif(l->>'receipt_id','')::uuid,
      case when jsonb_typeof(l->'dates') = 'array' then l->'dates' else null end);
    pos := pos + 1;
  end loop;

  perform public.refresh_invoice_status(v_id);
  return v_id;
end $$;

-- Keep at most 10 earlier versions and 30 history events per invoice.
create or replace function public.trim_invoice_history() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if tg_table_name = 'invoice_revisions' then
    delete from public.invoice_revisions
    where invoice_id = new.invoice_id
      and id not in (select id from public.invoice_revisions where invoice_id = new.invoice_id order by version desc, created_at desc limit 10);
  else
    delete from public.invoice_events
    where invoice_id = new.invoice_id
      and id not in (select id from public.invoice_events where invoice_id = new.invoice_id order by created_at desc limit 30);
  end if;
  return null;
end $$;
