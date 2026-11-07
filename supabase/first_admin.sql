-- Run ONCE in Supabase → SQL Editor, after creating your own user under Authentication → Users → "Add user".
-- Replace the email with yours. After this you add everyone else from the app (More → People).
insert into public.profiles (id, name, role, lang)
select id, 'Hussain', 'admin', 'en' from auth.users where email = 'hussainkhan@al-swaticontracting.com'
on conflict (id) do update set role = 'admin', active = true;
