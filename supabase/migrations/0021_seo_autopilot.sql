-- 0021: SEO autopilot. Google Search Console numbers come in every day, website leads and WhatsApp/call clicks are counted,
-- and the "seo" function writes a weekly report and blog drafts for the owner to approve. Everything it finds goes into the
-- main agent's morning briefing (preferences key "seo_state", items).

-- Search Console: one row per day, search phrase and page (Google's own numbers).
create table if not exists public.seo_rows (
  day date not null,
  query text not null,
  page text not null,
  clicks int not null default 0,
  impressions int not null default 0,
  position numeric(6,2),
  primary key (day, query, page)
);
create index if not exists seo_rows_query on public.seo_rows (query);

-- Search Console: the whole website per day (includes searches Google keeps private, so these totals are larger).
create table if not exists public.seo_days (
  day date primary key,
  clicks int not null default 0,
  impressions int not null default 0,
  position numeric(6,2)
);

-- Website: quote-form leads and clicks on WhatsApp / call / email, per page. No names here (the lead itself goes to Queries).
create table if not exists public.web_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('lead','whatsapp','call','email')),
  page text,
  lang text,
  ref text,                 -- where the visitor came from (google, bing, maps, direct…)
  utm text,
  ip_hash text              -- daily-salted fingerprint, only to stop spam floods
);
create index if not exists web_events_at on public.web_events (at desc);

-- Blog drafts written by the autopilot are marked, so it can stop when too many wait for the owner to read.
alter table public.blog_posts add column if not exists source text not null default 'manual';

alter table public.seo_rows enable row level security;
alter table public.seo_days enable row level security;
alter table public.web_events enable row level security;
drop policy if exists seo_rows_read on public.seo_rows;
create policy seo_rows_read on public.seo_rows for select using (public.my_role() = 'admin');
drop policy if exists seo_days_read on public.seo_days;
create policy seo_days_read on public.seo_days for select using (public.my_role() = 'admin');
drop policy if exists web_events_read on public.web_events;
create policy web_events_read on public.web_events for select using (public.my_role() = 'admin');
-- Writes come only from the server (service key in the "seo" function).

-- The server's clock: every morning 06:40 Riyadh. The function itself decides what is due (daily numbers, the weekly report,
-- one blog draft per day from the queue), so calling it more often is harmless. Uses the same public key as the other timers.
do $$ declare c text;
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'al-swati-seo';
  select command into c from cron.job where jobname = 'al-swati-autopilot';
  if c is null then raise exception 'Run 0020_server_timer.sql first'; end if;
  perform cron.schedule('al-swati-seo', '40 3 * * *',
    replace(replace(c, '/functions/v1/ai', '/functions/v1/seo'), '{"task":"autopilot"}', '{"action":"tick"}'));
end $$;

select jobname, schedule, active from cron.job where jobname like 'al-swati-%' order by jobname;
