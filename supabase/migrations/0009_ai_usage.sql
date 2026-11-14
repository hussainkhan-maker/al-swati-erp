-- 0009: every AI call's tokens, per task and model, so the owner can see and cut the AI bill.
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  task text, model text,
  input_tokens int not null default 0, output_tokens int not null default 0,
  cache_read int not null default 0, cache_write int not null default 0,
  files int not null default 0
);
create index if not exists ai_usage_at on public.ai_usage (at desc);
alter table public.ai_usage enable row level security;
drop policy if exists ai_usage_read on public.ai_usage;
create policy ai_usage_read on public.ai_usage for select using (public.my_role() = 'admin');
