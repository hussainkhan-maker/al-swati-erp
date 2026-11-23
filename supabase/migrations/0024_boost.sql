-- 0024: "Boost to Top 3" (Growth → Blog (SEO) → Close to page 1).
-- The AI rewrites a page that is close to Google's top 3 for one search and saves it as a Draft. Publishing it:
--   • an upgrade of a hand-made website page (target_path) takes that page's place at the same address; the website build keeps
--     the original in tools/originals/ and puts it back when the upgrade is unpublished
--   • an upgrade of a published ERP post (revision_of) is copied into that post (same address) and the draft row goes away
alter table public.blog_posts add column if not exists target_path text;
alter table public.blog_posts add column if not exists revision_of uuid references public.blog_posts(id) on delete cascade;
alter table public.blog_posts add column if not exists boost_query text;
create unique index if not exists blog_posts_one_live_upgrade on public.blog_posts (target_path) where status = 'Published' and target_path is not null;

select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'blog_posts' and column_name in ('target_path', 'revision_of', 'boost_query')) as new_columns;
