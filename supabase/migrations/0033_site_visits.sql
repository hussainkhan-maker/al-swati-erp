-- The website's own visit counter (no cookies, nothing that identifies a person).
-- Every page of al-swaticontracting.com sends one small note when it opens, and one when a visitor presses WhatsApp,
-- call, email or the quote form. The "visit" edge function writes the notes here; only the owner (admin) can read them.
--   path     the page (no query string, so nothing a visitor typed is kept)
--   source   where this visit started: google, tiktok, youtube, instagram, whatsapp, direct … (the first page of the tab)
--   src      the tag on our own links (?src=tt-<video>, ?src=yt-<video>, ?src=ig-<post>) when the visit came through one
--   landing  the first page of the visit, so a WhatsApp press can be credited to the page that brought the visitor
--   target   for a press: wa / tel / mail / form (never the number typed or the pre-filled message)
create table if not exists public.site_visits (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('view', 'whatsapp', 'call', 'email', 'form')),
  path text not null check (length(path) <= 300),
  lang text check (lang in ('en', 'ar')),
  source text check (length(source) <= 60),
  src text check (length(src) <= 60),
  landing text check (length(landing) <= 300),
  ref text check (length(ref) <= 100),
  mobile boolean
);
create index if not exists site_visits_at on public.site_visits (at desc);
alter table public.site_visits enable row level security;
drop policy if exists site_visits_admin on public.site_visits;
create policy site_visits_admin on public.site_visits for select using (public.my_role() = 'admin');

-- Totals for the ERP card and the weekly report: views and presses by source, page and tag over the last N days.
create or replace function public.visit_stats(days int default 28)
returns jsonb language sql stable set search_path = public as $$
  with v as (select * from public.site_visits where at >= now() - make_interval(days => greatest(1, least(days, 400)))),
  lead as (select * from v where kind <> 'view')
  select jsonb_build_object(
    'days', days,
    'views', (select count(*) from v where kind = 'view'),
    'leads', (select count(*) from lead),
    'mobile_share', (select round(100.0 * count(*) filter (where mobile) / nullif(count(*), 0)) from v where kind = 'view'),
    'by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}') from (select kind, count(*) n from lead group by kind) x),
    'by_source', (select coalesce(jsonb_agg(x order by x.views desc), '[]') from (
        select coalesce(source, 'direct') source, count(*) filter (where kind = 'view') views, count(*) filter (where kind <> 'view') leads
        from v group by 1) x),
    'by_page', (select coalesce(jsonb_agg(x order by x.views desc), '[]') from (
        select path, count(*) filter (where kind = 'view') views, count(*) filter (where kind <> 'view') leads
        from v group by 1 order by 2 desc limit 25) x),
    'leads_by_landing', (select coalesce(jsonb_agg(x order by x.leads desc), '[]') from (
        select coalesce(landing, path) landing, count(*) leads from lead group by 1 order by 2 desc limit 15) x),
    'by_tag', (select coalesce(jsonb_agg(x order by x.views desc), '[]') from (
        select src tag, count(*) filter (where kind = 'view') views, count(*) filter (where kind <> 'view') leads
        from v where src is not null group by 1 order by 2 desc limit 50) x),
    'by_day', (select coalesce(jsonb_agg(x order by x.day), '[]') from (
        select (at at time zone 'Asia/Riyadh')::date as day, count(*) filter (where kind = 'view') views, count(*) filter (where kind <> 'view') leads
        from v group by 1) x)
  );
$$;
revoke all on function public.visit_stats(int) from public, anon;
grant execute on function public.visit_stats(int) to authenticated;
