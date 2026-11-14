-- Engineers see sites, m² and drawings, never money: no rates, prices, quotations, service fee, profit or staff phone numbers.

-- 1. Take engineers out of the tables that hold money or personal data.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (id = auth.uid() or public.my_role() in ('admin','abu'));
drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select using (public.my_role() in ('admin','abu') or public.is_member(id));
drop policy if exists members_read on public.project_members;
create policy members_read on public.project_members for select using (public.my_role() in ('admin','abu') or user_id = auth.uid());
drop policy if exists subs_read on public.subcontractors;
create policy subs_read on public.subcontractors for select using (public.my_role() in ('admin','abu'));
drop policy if exists progress_read on public.progress;
create policy progress_read on public.progress for select using (public.my_role() in ('admin','abu'));
drop policy if exists quotes_read on public.quotes;
create policy quotes_read on public.quotes for select using (public.my_role() = 'admin' or (public.my_role() = 'abu' and owner = 'abu'));

-- 2. What engineers DO get: project names and site progress, without any money column.
create or replace function public.eng_projects() returns table(id uuid, name text, client text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, name, client, created_at from public.projects
  where public.my_role() in ('engineer','admin') order by created_at desc
$$;
create or replace function public.eng_progress() returns table(id uuid, project_id uuid, sub_name text, qty numeric, unit text, work text, status text, created_by uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, project_id, sub_name, qty, unit, work, status, created_by, created_at from public.progress
  where public.my_role() in ('engineer','admin') and status = 'active' order by created_at desc limit 5000
$$;
revoke execute on function public.eng_projects(), public.eng_progress() from public, anon;
grant execute on function public.eng_projects(), public.eng_progress() to authenticated;

select
  (select count(*) from pg_policies where schemaname = 'public' and qual like '%engineer%' and tablename in ('profiles','projects','project_members','subcontractors','progress','quotes')) as engineer_money_rules_left,
  has_function_privilege('anon', 'public.eng_progress()', 'execute') as anon_can_read;
