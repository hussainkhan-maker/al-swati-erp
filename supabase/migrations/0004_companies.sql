-- Our own companies (bills and purchase VAT are in these names). Super-Admin keeps the list under AI agents → My preferences.
-- Supervisors and engineers may read only this one preference, so the company list shows in their purchase screen.
insert into public.preferences(key, value) values ('companies', '{"list": []}') on conflict do nothing;
create policy prefs_read_companies on public.preferences for select using (key = 'companies' and public.my_role() in ('supervisor','engineer'));
