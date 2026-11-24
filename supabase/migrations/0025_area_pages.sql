-- 0025: Riyadh district pages (Growth → District pages).
-- The owner picks a Riyadh district, the main stone and 2-3 photos of his work there; the AI writes an English page
-- (/stone-cladding-<district>-riyadh/) and a Saudi Arabic page (/ar/stone-cladding-<district>-riyadh/) as two linked drafts.
-- blog_posts.area holds what the website build needs for them: district names, its centre point (for the Service schema),
-- the main stone and the photos with their alt text. Publish puts both pages on al-swaticontracting.com and in sitemap.xml.
alter table public.blog_posts add column if not exists area jsonb;

-- The photos sit in the public "blog" storage under areas/ (they go on public web pages). The Super-Admin uploads them
-- from the ERP and may delete them; nobody else can write there.
drop policy if exists blog_area_photos_insert on storage.objects;
create policy blog_area_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'blog' and name like 'areas/%' and public.my_role() = 'admin');
drop policy if exists blog_area_photos_delete on storage.objects;
create policy blog_area_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'blog' and name like 'areas/%' and public.my_role() = 'admin');

select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'blog_posts' and column_name = 'area') as area_column,
       (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'blog_area_photos_%') as photo_rules;
