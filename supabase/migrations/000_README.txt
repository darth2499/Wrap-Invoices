Run these in the Supabase SQL Editor, in this order:
  1. 001_schema.sql          (creates everything)
  2. 003_first_admin.sql     (edit your email first — lets you sign in)
  3. 002_daily_reminders.sql (after the edge functions are deployed; fill in the placeholders)
  4. 004_fix_reset.sql      (only if you set up before Oct 8, 2026 — already included in 001)
  5. 005_storage_limit.sql  (only if you set up before Oct 8, 2026 — already included in 001)
  6. 006_links_on_send.sql  (only if you set up before Oct 8, 2026 — already included in 001)
  7. 007_history_limit.sql  (only if you set up before Oct 8, 2026 — already included in 001)
