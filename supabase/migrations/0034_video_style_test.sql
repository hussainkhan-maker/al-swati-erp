-- The video style test (Growth → Videos): every topic is made twice, once "realistic" (photo-real pictures and clips) and once
-- "animated" (a 3D explainer look), and the numbers decide which style to make more of.
--   style     realistic | animated (null for videos made before the test)
--   pair_id   the same id on both versions of one topic
--   stats     the posted video's numbers, saved each week by the Growth agent:
--             {"tiktok": {"views","likes","comments","shares","at"}, "youtube": {"views","likes","comments","avg_view_pct","at"}}
--   stats_at  when the numbers were last read
alter table public.video_ideas add column if not exists style text check (style in ('realistic', 'animated'));
alter table public.video_ideas add column if not exists pair_id uuid;
alter table public.video_ideas add column if not exists stats jsonb;
alter table public.video_ideas add column if not exists stats_at timestamptz;
create index if not exists video_ideas_pair on public.video_ideas (pair_id) where pair_id is not null;

-- The weekly Growth agent (all numbers in one place, the style test, next week's decisions) writes runs and takes tasks too.
alter table public.agent_runs drop constraint if exists agent_runs_agent_check;
alter table public.agent_runs add constraint agent_runs_agent_check check (agent in ('manager', 'website_doctor', 'seo', 'projects', 'content', 'maps', 'growth'));
alter table public.agent_tasks drop constraint if exists agent_tasks_agent_check;
alter table public.agent_tasks add constraint agent_tasks_agent_check check (agent in ('manager', 'website_doctor', 'seo', 'projects', 'content', 'maps', 'growth'));
