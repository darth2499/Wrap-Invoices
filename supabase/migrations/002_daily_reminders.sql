-- =====================================================================
-- Wrap — daily automatic reminders
-- Run AFTER the edge functions are deployed. Replace the two placeholders first:
--   YOUR-PROJECT-REF   → the id in your Supabase URL (https://YOUR-PROJECT-REF.supabase.co)
--   YOUR-CRON-SECRET   → the same random text you saved as the CRON_SECRET secret
-- Runs every day at 17:00 UTC (10 AM Pacific in summer, 9 AM in winter).
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('wrap-reminders') where exists (select 1 from cron.job where jobname = 'wrap-reminders');

select cron.schedule(
  'wrap-reminders',
  '0 17 * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/reminders',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "YOUR-CRON-SECRET"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
