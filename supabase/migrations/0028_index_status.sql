-- 0028: instant indexing. After the website publishes new or changed pages, the "Blog from the ERP" build asks the seo
-- function to tell IndexNow (Bing, Yandex and the other IndexNow search engines) and to resubmit the sitemap to Google
-- Search Console. Growth shows the result next to each published post: "Indexed ping sent", and Google's own status from
-- URL Inspection, with a "Re-ping Google" button. One row per public address. Only the server writes it.
create table if not exists public.index_status (
  url text primary key,
  indexnow_at timestamptz,       -- last IndexNow submission
  indexnow_code int,             -- IndexNow's answer: 200 or 202 = received
  indexnow_by text,              -- 'build' (the website build after Publish) or 'erp' (Re-ping Google)
  sitemap_at timestamptz,        -- last sitemap resubmit to Google Search Console
  sitemap_code int,              -- Google's answer: 200 or 204 = received, 403 = the Google sign-in has no write permission yet
  google_state text,             -- URL Inspection, e.g. "Submitted and indexed" or "Discovered - currently not indexed"
  google_verdict text,           -- PASS, NEUTRAL or FAIL
  google_crawled_at timestamptz, -- Google's last crawl of the page
  google_checked_at timestamptz,
  google_error text,
  updated_at timestamptz not null default now()
);
alter table public.index_status enable row level security;
revoke all on public.index_status from anon;
drop policy if exists index_status_read on public.index_status;
create policy index_status_read on public.index_status for select using (public.my_role() = 'admin');

select (select count(*) from pg_policies where tablename = 'index_status') as rules,
       has_table_privilege('anon', 'public.index_status', 'select') as anon_can_read;
