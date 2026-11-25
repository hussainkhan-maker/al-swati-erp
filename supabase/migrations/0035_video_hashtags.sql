-- Hashtag bank for the videos (25 Nov 2026).
-- The video autopilot takes every video's hashtags from this list instead of choosing them by guess;
-- the weekly Growth agent keeps it up to date from data: Google searches in Saudi Arabia (OpenSEO),
-- what overperforming Saudi stone/facade videos use (vidIQ), and our own videos' views per hashtag.
create table if not exists public.video_hashtags (
  tag text primary key check (tag ~ '^#[^\s#]+$'),
  grp text not null check (grp in ('fixed','search','topic','market','english')),
  topic text not null default 'general',          -- general, angles, mechanical, marble, porcelain, limestone, granite, villas
  source text not null default 'google' check (source in ('google','competitor','tiktok','ours')),
  volume int,                                      -- Google searches a month in Saudi Arabia (OpenSEO), when measured
  status text not null default 'active' check (status in ('active','test','removed')),
  uses int not null default 0,                     -- how many of our posted videos carried it
  avg_views int,                                   -- average views (TikTok + YouTube) of those videos
  note text,
  updated_at timestamptz not null default now()
);

alter table public.video_hashtags enable row level security;
drop policy if exists video_hashtags_admin on public.video_hashtags;
create policy video_hashtags_admin on public.video_hashtags for select using (public.my_role() = 'admin');

insert into public.video_hashtags (tag, grp, topic, source, volume, note) values
  ('#الرياض',                 'fixed',   'general',    'ours',       null, 'every video: the city'),
  ('#تركيب_حجر',              'fixed',   'general',    'google',     140,  'every video: the service'),
  ('#السواتي',                'fixed',   'general',    'ours',       null, 'every video: our name'),
  ('#حجر_الرياض',             'search',  'general',    'google',     2400, 'the biggest stone search in Saudi Arabia'),
  ('#واجهات_فلل',             'search',  'villas',     'google',     720,  null),
  ('#حجر_طبيعي',              'search',  'general',    'google',     720,  'also used by competitors'),
  ('#الحجر_الجيري',           'search',  'limestone',  'google',     590,  null),
  ('#واجهات_حجر',             'search',  'general',    'google',     480,  null),
  ('#حجر_الرياض_للواجهات',    'search',  'general',    'google',     480,  null),
  ('#واجهات_فلل_مودرن',       'search',  'villas',     'google',     480,  null),
  ('#ترافرتين',               'search',  'marble',     'google',     390,  null),
  ('#واجهات_منازل',           'search',  'villas',     'google',     390,  null),
  ('#تركيب_رخام',             'search',  'marble',     'google',     210,  null),
  ('#واجهات_حجر_الرياض',      'search',  'general',    'google',     210,  null),
  ('#زوايا_تركيب_الحجر',      'topic',   'angles',     'google',     170,  'Up-Down angles'),
  ('#تركيب_حجر_ميكانيكي',     'topic',   'mechanical', 'google',     110,  'any fixing system video'),
  ('#تركيب_حجر_واجهات',       'topic',   'mechanical', 'google',     110,  null),
  ('#تركيب_الرخام_ميكانيكي',  'topic',   'marble',     'google',     90,   null),
  ('#رخام_واجهات',            'topic',   'marble',     'google',     90,   null),
  ('#حجر_نساح',               'topic',   'limestone',  'google',     90,   'white Riyadh stone'),
  ('#واجهات_بورسلان',         'topic',   'porcelain',  'google',     40,   null),
  ('#جرانيت_واجهات',          'topic',   'granite',    'google',     20,   null),
  ('#واجهات_خارجية',          'market',  'general',    'competitor', 90,   'used by Saudi facade TikToks that overperform'),
  ('#السعودية',               'market',  'general',    'tiktok',     null, 'on most Saudi home-improvement TikToks that overperform'),
  ('#stonecladding',          'english', 'general',    'google',     210,  '"stone cladding" in Saudi Arabia'),
  ('#riyadh',                 'english', 'general',    'ours',       null, null)
on conflict (tag) do nothing;
