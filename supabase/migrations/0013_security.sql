-- Security audit fixes (14 Nov 2026).

-- 1. A switched-off person loses access to their sites at once (is_member also needs an active profile).
create or replace function public.is_member(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() is not null
     and exists(select 1 from public.project_members where project_id = p and user_id = auth.uid())
$$;

-- 2. Database functions are not callable by strangers.
--    find_or_create_item is only used inside the purchase rule (runs as owner), so nobody needs to call it directly.
revoke execute on function public.find_or_create_item(text, text, text) from public, anon, authenticated;
create or replace function public.sub_names() returns setof text
language sql stable security definer set search_path = public as $$
  select name from public.subcontractors where public.my_role() is not null order by name
$$;
revoke execute on function public.sub_names() from public, anon;
revoke execute on function public.sup_progress() from public, anon;
grant execute on function public.sub_names() to authenticated;
grant execute on function public.sup_progress() to authenticated;

-- 3. AI use is counted per person, for the daily limit.
alter table public.ai_usage add column if not exists user_id uuid;
create index if not exists ai_usage_user_at on public.ai_usage (user_id, at desc);

select
  position('my_role() is not null' in pg_get_functiondef('public.is_member'::regproc)) > 0 as member_needs_active,
  has_function_privilege('anon', 'public.sub_names()', 'execute') as anon_can_list_subs,
  has_function_privilege('anon', 'public.find_or_create_item(text,text,text)', 'execute') as anon_can_add_items,
  (select count(*) from information_schema.columns where table_name = 'ai_usage' and column_name = 'user_id') as ai_user_col;
