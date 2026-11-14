-- 0015: a starting password must be replaced before any data opens; sessions end after 7 days; supervisors see no fee or client.

-- 1. "Choose your own password" is enforced by the database, not only by the app.
alter table public.profiles add column if not exists must_change boolean not null default false;

-- Nobody but Super-Admin (or the server) can clear their own must_change flag.
create or replace function public.profiles_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and public.my_role() is distinct from 'admin' then new.must_change := old.must_change; end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles for each row execute function public.profiles_guard();

-- 2. my_role(): active, own password already chosen, and signed in within the last 7 days
--    (the sign-in time comes from the login token itself, so an old stolen session stops working).
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles
  where id = auth.uid() and active and not must_change
    and (case when jsonb_typeof(auth.jwt() -> 'amr' -> 0 -> 'timestamp') = 'number'
              then (auth.jwt() -> 'amr' -> 0 ->> 'timestamp')::bigint > extract(epoch from now())::bigint - 7 * 86400
              else true end)
$$;

-- People who still have a starting password (not Super-Admin) must choose their own at the next opening.
update public.profiles p set must_change = true
from auth.users u
where u.id = p.id and p.role <> 'admin' and coalesce(u.raw_user_meta_data ->> 'temp_password', 'false') = 'true';

-- 3. Supervisors get project names and company only (no service fee, client or scope with rates).
drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select using (public.my_role() in ('admin','abu'));
create or replace function public.sup_projects() returns table(id uuid, name text, company text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, name, company, created_at from public.projects
  where public.my_role() = 'supervisor' and public.is_member(id) order by created_at desc
$$;
revoke execute on function public.sup_projects() from public, anon;
grant execute on function public.sup_projects() to authenticated;

select
  (select count(*) from information_schema.columns where table_name = 'profiles' and column_name = 'must_change') as must_change_col,
  position('7 * 86400' in pg_get_functiondef('public.my_role'::regproc)) > 0 as seven_day_rule,
  (select count(*) from public.profiles where must_change) as people_who_must_choose,
  has_function_privilege('anon', 'public.sup_projects()', 'execute') as anon_can_read;
