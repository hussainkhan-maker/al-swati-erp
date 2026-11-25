-- 0032: The website & marketing agents team.
-- A Manager agent and specialist agents (Website Doctor, SEO, Projects, Content, Google Maps) run as scheduled Claude
-- tasks. Each run is written to agent_runs; the Manager hands out work in agent_tasks; anything only the owner can do
-- (a sign-in, an approval, a button on another site) goes to owner_actions with the page to open, and the ERP shows
-- it in AI agents → Website team. website_projects is the owner's form for a new project on the website
-- (photos + a few facts); the Projects agent turns each one into pages.

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent text not null check (agent in ('manager', 'website_doctor', 'seo', 'projects', 'content', 'maps')),
  status text not null default 'ok' check (status in ('running', 'ok', 'warn', 'action', 'failed')),
  summary text not null default '',          -- for the owner, simple Roman Urdu
  details jsonb not null default '{}',       -- what was checked and changed, numbers, links
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists agent_runs_by_agent on public.agent_runs (agent, started_at desc);

create table if not exists public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  agent text not null check (agent in ('manager', 'website_doctor', 'seo', 'projects', 'content', 'maps')),
  title text not null,
  details text not null default '',
  priority int not null default 2 check (priority between 1 and 3),   -- 1 urgent, 2 normal, 3 when free
  status text not null default 'open' check (status in ('open', 'doing', 'done', 'blocked', 'dropped')),
  result text,
  created_by text not null default 'manager',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_tasks_open on public.agent_tasks (agent, status) where status in ('open', 'doing', 'blocked');

create table if not exists public.owner_actions (
  id uuid primary key default gen_random_uuid(),
  agent text not null,
  title text not null,                       -- what to do, Roman Urdu
  why text not null default '',
  steps text not null default '',
  url text,                                  -- the page to open
  priority int not null default 2 check (priority between 1 and 3),
  status text not null default 'open' check (status in ('open', 'done', 'skipped')),
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists owner_actions_open on public.owner_actions (status, priority) where status = 'open';

create table if not exists public.website_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  district text not null,
  building text not null default 'villa' check (building in ('villa', 'villas', 'compound', 'commercial', 'tower', 'government')),
  material text not null default 'Natural stone',
  m2 numeric,
  ongoing boolean not null default true,
  year int not null default extract(year from now()),
  scope text not null default 'supply_install' check (scope in ('supply_install', 'install', 'supply')),
  fixing text[] not null default '{}',
  client text,
  show_client boolean not null default false,
  partner boolean not null default false,    -- also add the client to Trusted Partners on the home page
  notes text not null default '',
  photos text[] not null default '{}',       -- public URLs in blog storage (cases/uploads/…)
  status text not null default 'new' check (status in ('new', 'working', 'done', 'failed')),
  result jsonb not null default '{}',        -- the pages made
  error text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_runs enable row level security;
alter table public.agent_tasks enable row level security;
alter table public.owner_actions enable row level security;
alter table public.website_projects enable row level security;
drop policy if exists agent_runs_admin on public.agent_runs;
create policy agent_runs_admin on public.agent_runs for select using (public.my_role() = 'admin');
drop policy if exists agent_tasks_admin on public.agent_tasks;
create policy agent_tasks_admin on public.agent_tasks for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists owner_actions_admin on public.owner_actions;
create policy owner_actions_admin on public.owner_actions for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists website_projects_admin on public.website_projects;
create policy website_projects_admin on public.website_projects for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

select (select count(*) from information_schema.tables where table_schema = 'public'
        and table_name in ('agent_runs', 'agent_tasks', 'owner_actions', 'website_projects')) as tables_made;
