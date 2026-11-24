-- 0029: Videos for TikTok, YouTube Shorts and Instagram Reels (Growth → Videos). The "seo" function writes 2 ideas a week while
-- fewer than 4 wait, and more when the owner presses "Write 3 new ideas": script, text on screen in Arabic and English, voice-over,
-- TikTok caption, YouTube title, description and tags. The owner posts every video himself (TikTok lets only approved apps post),
-- then saves the links here. One row per video.
create table if not exists public.video_ideas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source text not null default 'weekly',      -- 'weekly' (server clock), 'manual' (button), 'made' (a finished video added by hand)
  status text not null default 'idea' check (status in ('idea', 'made', 'posted', 'skipped')),
  kind text not null default '3d' check (kind in ('3d', 'site', 'tips')),
  keyword text,                                -- the search it aims at
  why text,                                    -- one line in Roman Urdu
  title_ar text, title_en text, hook_ar text, hook_en text,
  scenes jsonb not null default '[]'::jsonb,   -- [{sec, visual, ar, en}]
  voice_ar text, voice_en text,
  shots text,                                  -- for videos filmed on site: what to film with the phone
  tiktok_caption text, youtube_title text, youtube_description text, youtube_tags text, hashtags text,
  video_file text,                             -- name of the finished file, when there is one
  tiktok_url text, youtube_url text, posted_at timestamptz
);
create index if not exists video_ideas_created on public.video_ideas (created_at desc);
alter table public.video_ideas enable row level security;
revoke all on public.video_ideas from anon;
drop policy if exists video_ideas_read on public.video_ideas;
create policy video_ideas_read on public.video_ideas for select using (public.my_role() = 'admin');
drop policy if exists video_ideas_edit on public.video_ideas;
create policy video_ideas_edit on public.video_ideas for update using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
-- New ideas come only from the server (service key in the "seo" function).

-- The first video, already made: the Up-Down system in 3D and a villa facade going up (32 seconds, Arabic and English).
insert into public.video_ideas (source, status, kind, keyword, why, title_ar, title_en, hook_ar, hook_en, scenes, video_file,
  tiktok_caption, youtube_title, youtube_description, youtube_tags, hashtags)
select 'made', 'made', '3d', 'تركيب حجر ميكانيكي',
  'Pehli video: Up-Down system aur villa ka facade 3D mein. File: al-swati-3d-up-down-fixing-v2.mp4 (Claude ne chat mein bheji).',
  'كيف يُركّب الحجر بدون أسمنت؟', 'How is stone fixed without cement? The Up-Down system',
  'كيف يُركّب الحجر بدون أسمنت؟', 'How is stone fixed without cement?',
  '[{"sec":"0-3","visual":"Polished marble close-up, light moving over the veins","ar":"كيف يُركّب الحجر بدون أسمنت؟","en":"How is stone fixed without cement?"},
    {"sec":"3-6","visual":"Anchor turns into the wall","ar":"مرساة هيلتي أو فيشر في الجدار","en":"A Hilti or Fischer anchor goes into the wall"},
    {"sec":"6-8","visual":"Stainless-steel angle drops on, nut tightens","ar":"زاوية ستانلس ستيل على المرساة","en":"A stainless-steel angle bolts onto it"},
    {"sec":"8-11","visual":"Upper panel drops onto the blade by its kerf","ar":"اللوح ينزل على الزاوية عبر مجرى في حافته","en":"The panel drops onto the angle by a kerf in its edge"},
    {"sec":"11-13","visual":"The gap behind the stone glows","ar":"لا أسمنت خلف الحجر، فقط فراغ","en":"No mortar behind the stone, just a gap"},
    {"sec":"13-22","visual":"Modern villa, panels fly in row by row, night lights come on","ar":"صفًا بعد صف من الأسفل إلى الأعلى","en":"Row by row, from the bottom up"},
    {"sec":"22-28","visual":"Three benefits","ar":"ليش التثبيت الميكانيكي؟","en":"Why mechanical fixing?"},
    {"sec":"28-32","visual":"Logo, website, phone","ar":"السواطي للمقاولات","en":"AL-Swati Contracting"}]'::jsonb,
  'al-swati-3d-up-down-fixing-v2.mp4',
  E'كيف يُركّب الحجر بدون أسمنت؟ 🤔\nالتثبيت الميكانيكي خطوة بخطوة: مرساة هيلتي أو فيشر، زاوية ستانلس ستيل، واللوح يركب على الزاوية. بدون أسمنت خلف الحجر = بدون بقع بيضاء، وكل لوح يتحرك بحرية مع حرارة الرياض.\nHow is stone fixed without cement? Mechanical stone cladding, step by step.\n📍 الرياض | واتساب: 0511826313\n\n#تركيب_حجر #تركيب_حجر_ميكانيكي #واجهات_حجر #واجهات_فلل #الرياض #مقاولات #stonecladding #riyadh',
  'كيف يُركّب الحجر بدون أسمنت؟ تركيب حجر ميكانيكي في الرياض | Mechanical Stone Cladding',
  E'التثبيت الميكانيكي للحجر خطوة بخطوة: مرساة هيلتي أو فيشر في الجدار، زاوية ستانلس ستيل 304 أو 316، واللوح ينزل على الزاوية عبر مجرى في حافته. لا أسمنت خلف الحجر، فلا بقع بيضاء، وكل لوح يتحرك بحرية مع حرارة الرياض.\n\nشركة السواطي للمقاولات: تركيب حجر ميكانيكي في الرياض منذ 1994، بفريق عمل مباشر وضمان مكتوب لا يقل عن 5 سنوات.\n🌐 https://al-swaticontracting.com\n📞 واتساب: +966 51 182 6313\n\nMechanical stone cladding, step by step: Hilti or Fischer anchor, stainless-steel angle, and a kerf in the panel edge. No mortar behind the stone. AL-Swati Contracting, Riyadh, since 1994.\n(3D illustration)\n\n#shorts #تركيب_حجر #الرياض',
  'تركيب حجر, تركيب حجر ميكانيكي, واجهات حجر, حجر الرياض, تركيب رخام, واجهات فلل الرياض, stone cladding riyadh, mechanical stone cladding, facade cladding saudi arabia',
  '#تركيب_حجر #تركيب_حجر_ميكانيكي #واجهات_حجر #واجهات_فلل #الرياض #مقاولات #stonecladding #riyadh'
where not exists (select 1 from public.video_ideas where video_file = 'al-swati-3d-up-down-fixing-v2.mp4');

select (select count(*) from public.video_ideas) as videos,
       (select count(*) from pg_policies where tablename = 'video_ideas') as rules,
       has_table_privilege('anon', 'public.video_ideas', 'select') as anon_can_read;
