-- 0031: Blog pictures made with Higgsfield, one exact picture for each topic.
-- Every morning Claude (a scheduled task with the Higgsfield connector) makes a picture for each new draft and for each post
-- where the owner asked for a new one (status "wanted", with his note of what it should show): it writes the Higgsfield link
-- here (status "ready"). The "Video" workflow on GitHub turns it into a 1600x900 JPEG in the public "blog" storage and puts
-- it on the post and its other-language twin (status "done"). District pages and case studies keep the owner's real photos.
alter table public.blog_posts
  add column if not exists picture_status text check (picture_status in ('wanted', 'ready', 'done', 'failed')),
  add column if not exists picture_src text,        -- the Higgsfield picture, until it is saved in "blog" storage
  add column if not exists picture_alt_en text,
  add column if not exists picture_alt_ar text,
  add column if not exists picture_note text,       -- the owner's note: what the new picture should show
  add column if not exists picture_error text,
  add column if not exists picture_at timestamptz;
create index if not exists blog_posts_picture on public.blog_posts (picture_status) where picture_status is not null;

select count(*) filter (where column_name like 'picture_%') as picture_columns
from information_schema.columns where table_schema = 'public' and table_name = 'blog_posts';
