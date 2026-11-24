-- 0026: SEO case studies from projects, and the spelling "Al-Ahsa".
-- Projects → a project → "Publish as SEO Case Study": the owner confirms once what the public page may say about the job
-- (district, building, stone, fixing system, year, site photos, notes, client name allowed) and it is kept here.
-- The m² come from the project's "Work done" entries. The pages are blog_posts with area.type = 'case'.
alter table public.projects add column if not exists site jsonb;

-- Site photos for case studies sit in the public "blog" storage under cases/ (they go on public web pages).
drop policy if exists blog_case_photos_insert on storage.objects;
create policy blog_case_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'blog' and name like 'cases/%' and public.my_role() = 'admin');
drop policy if exists blog_case_photos_delete on storage.objects;
create policy blog_case_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'blog' and name like 'cases/%' and public.my_role() = 'admin');

-- "Al-Hassa" → "Al-Ahsa" in the company profile and in the posts that used it
update public.preferences set value = jsonb_set(value, '{cities}', to_jsonb(replace(value->>'cities', 'Al-Hassa', 'Al-Ahsa'))), updated_at = now()
  where key = 'company_profile' and value->>'cities' like '%Al-Hassa%';
update public.blog_posts set title = replace(title, 'Al-Hassa', 'Al-Ahsa'), meta_description = replace(meta_description, 'Al-Hassa', 'Al-Ahsa'),
  body = replace(body, 'Al-Hassa', 'Al-Ahsa'), updated_at = now()
  where coalesce(title, '') || coalesce(meta_description, '') || body like '%Al-Hassa%';

select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'site') as site_column,
       (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'blog_case_photos_%') as photo_rules,
       (select value->>'cities' from public.preferences where key = 'company_profile') as cities,
       (select count(*) from public.blog_posts where body like '%Al-Hassa%') as posts_left;
