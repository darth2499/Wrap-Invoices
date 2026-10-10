-- Only if you ran the earlier 013_public_page.sql: removes that database function again, so signed-out
-- visitors have no direct database access at all (client links go only through the "public" server function).
drop function if exists public.public_invoice(text, uuid, boolean);
