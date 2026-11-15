-- 0022: every blog post gets a picture and an Arabic twin.
-- When the owner presses Publish on a post, the "blog-media" function makes a picture for its topic (AI) and writes the
-- Arabic version (clear Arabic the way Saudi companies write), and both go public together. twin_id links the two languages,
-- so the website can show "اقرأ بالعربية" / "Read in English" and Google can pair them (hreflang).
alter table public.blog_posts add column if not exists image_url text;
alter table public.blog_posts add column if not exists image_alt text;
alter table public.blog_posts add column if not exists twin_id uuid references public.blog_posts(id) on delete set null;

-- Pictures are public (they sit on public web pages). Only the server (service key) puts them there.
insert into storage.buckets (id, name, public)
values ('blog', 'blog', true)
on conflict (id) do update set public = true;

select (select count(*) from information_schema.columns where table_name = 'blog_posts' and column_name in ('image_url', 'image_alt', 'twin_id')) as new_columns,
       (select public from storage.buckets where id = 'blog') as pictures_public;
