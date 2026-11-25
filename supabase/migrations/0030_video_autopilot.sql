-- 0030: Videos on autopilot (Growth → Videos).
-- Twice a week Claude makes the pictures and clips with Higgsfield and writes a plan here (status "rendering"). The "Video"
-- workflow on GitHub turns the plan into the MP4 and puts it in the private "videos" storage (status "review"). The owner watches
-- it and presses Approve: the "video" function uploads it to YouTube, scheduled for the next slot (Sunday or Wednesday, 7 pm
-- Riyadh; status "scheduled", then "posted"). TikTok lets only apps it has approved post, so the owner posts there himself
-- (download and caption in Growth → Videos) until TikTok approves the app.
alter table public.video_ideas drop constraint if exists video_ideas_status_check;
alter table public.video_ideas add constraint video_ideas_status_check
  check (status in ('idea', 'generating', 'rendering', 'review', 'approved', 'scheduled', 'made', 'posted', 'skipped', 'failed'));
alter table public.video_ideas
  add column if not exists plan jsonb,                  -- the shots: background picture or clip + text style (video/render.py)
  add column if not exists video_path text,             -- the MP4 in the private "videos" storage
  add column if not exists video_seconds numeric,
  add column if not exists render_started timestamptz,
  add column if not exists render_tries int not null default 0,
  add column if not exists render_error text,
  add column if not exists review_note text,            -- the owner's note when he asks for a new version
  add column if not exists credits numeric,             -- Higgsfield credits spent on this video
  add column if not exists approved_at timestamptz,
  add column if not exists publish_at timestamptz,      -- when YouTube makes it public
  add column if not exists youtube_id text,
  add column if not exists youtube_error text;
create index if not exists video_ideas_status on public.video_ideas (status);

-- The owner's own "Connect YouTube" (upload only). Like google_link: no app user can read or change it, only the server.
create table if not exists public.youtube_link (
  id int primary key default 1 check (id = 1),
  account text, channel_id text, channel_title text,
  refresh_token text,
  pkce text, pkce_expires timestamptz,
  connected_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.youtube_link enable row level security;
revoke all on public.youtube_link from anon, authenticated;

-- Finished videos. Private: the app gets a link for one hour from the "video" function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', false, 209715200, array['video/mp4'])
on conflict (id) do nothing;

select (select count(*) from information_schema.columns where table_name = 'video_ideas' and column_name in ('plan', 'video_path', 'publish_at', 'youtube_id')) as new_columns,
       (select count(*) from storage.buckets where id = 'videos') as videos_bucket,
       has_table_privilege('authenticated', 'public.youtube_link', 'select') as app_users_can_read_youtube_link;
