-- Run once in the Supabase SQL Editor (already included in 001_schema.sql for new setups).

-- Client links open faster: the page reads the invoice straight from the database in one call, instead of
-- waiting for an edge function to start up. Only someone with the link's long random token gets anything,
-- and only what the client page shows. Links to files (logo, receipts) still come from the edge function,
-- loaded at the same time.
-- p_viewer: whose Wrap sign-in is on this browser (if any) — your own visits don't count as the client's.
create or replace function public.public_invoice(p_token text, p_viewer uuid default null, p_preview boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  inv public.invoices;
  p jsonb;
  biz jsonb;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{48,64}$' then return null; end if;
  select * into inv from public.invoices where share_token = p_token;
  if not found then return null; end if;

  select to_jsonb(x) into p from public.profiles x where x.id = inv.owner_id;
  biz := jsonb_build_object(
    'business_name', p->'business_name', 'business_email', p->'business_email', 'address', p->'address',
    'phone', p->'phone', 'website', p->'website', 'template', p->'template', 'accent', p->'accent',
    'payment_instructions', p->'payment_instructions', 'footer_note', p->'footer_note',
    'logo_mode', coalesce(p->'logo_mode', '"logo"'::jsonb), 'logo_preset', p->'logo_preset',
    'has_logo', (p->>'logo_key') is not null);

  if inv.status = 'void' then
    return jsonb_build_object('business', biz, 'kind', inv.kind, 'number', inv.number, 'state', 'void');
  end if;
  if inv.status = 'paid' then
    return jsonb_build_object('business', biz, 'kind', inv.kind, 'number', inv.number, 'state', 'paid', 'total', inv.total);
  end if;

  if not p_preview and (p_viewer is null or p_viewer <> inv.owner_id) then
    update public.invoices set first_viewed_at = coalesce(first_viewed_at, now()), last_viewed_at = now(),
      view_count = coalesce(view_count, 0) + 1 where id = inv.id;
    -- Only log a "viewed" event once per hour so the history stays readable.
    if inv.last_viewed_at is null or inv.last_viewed_at < now() - interval '1 hour' then
      insert into public.invoice_events (owner_id, invoice_id, type, detail) values (inv.owner_id, inv.id, 'viewed', null);
    end if;
  end if;

  return jsonb_build_object(
    'business', biz, 'kind', inv.kind, 'number', inv.number, 'state', 'open',
    'invoice', jsonb_build_object(
      'number', inv.number, 'kind', inv.kind, 'status', inv.status, 'issue_date', inv.issue_date, 'due_date', inv.due_date,
      'terms', inv.terms, 'notes', inv.notes, 'subtotal', inv.subtotal, 'discount_total', inv.discount_total,
      'tax_total', inv.tax_total, 'total', inv.total, 'deposit_percent', inv.deposit_percent, 'version', inv.version,
      'updated_at', inv.updated_at),
    'client', (select jsonb_build_object('name', c.name, 'email', c.email, 'address', c.address) from public.clients c where c.id = inv.client_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('item', l.item, 'description', l.description, 'note', l.note, 'qty', l.qty,
        'rate', l.rate, 'amount', l.amount, 'tax_rate', l.tax_rate, 'kind', l.kind, 'receipt_id', l.receipt_id, 'extras', l.extras) order by l.position)
      from public.invoice_lines l where l.invoice_id = inv.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('paid_on', y.paid_on, 'amount', y.amount, 'method', y.method) order by y.paid_on)
      from public.payments y where y.invoice_id = inv.id), '[]'::jsonb),
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'vendor', r.vendor, 'date', r.receipt_date, 'total', r.total,
        'billable', r.billable, 'mime', r.mime, 'has_file', r.file_key is not null) order by r.receipt_date)
      from public.receipts r where r.invoice_id = inv.id), '[]'::jsonb));
end $$;

revoke all on function public.public_invoice(text, uuid, boolean) from public;
grant execute on function public.public_invoice(text, uuid, boolean) to anon, authenticated;
