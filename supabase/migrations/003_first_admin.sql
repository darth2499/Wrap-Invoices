-- Put the Google email you'll sign in with here, then run.
-- You become the admin and can invite others from Settings → People.
insert into public.invites (email, is_admin) values ('YOUR-EMAIL@gmail.com', true)
on conflict (email) do update set is_admin = true;
