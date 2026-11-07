-- Al-Swati Stone ERP — database schema
-- Money math, receipt rules and role limits live HERE, so no phone can bypass them.

create extension if not exists pgcrypto;

-- ───────────────────────── people & roles ─────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null check (role in ('admin','abu','engineer','supervisor')),
  phone text,
  lang text not null default 'en' check (lang in ('en','ar','ur')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

-- ───────────────────────── projects ─────────────────────────
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client text,
  company text,                       -- company the project is taken under
  fee_pct numeric(5,2) not null default 0 check (fee_pct between 0 and 20),
  status text not null default 'active' check (status in ('active','closed')),
  quote_id uuid,
  scope jsonb not null default '[]',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid references public.projects(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  primary key (project_id, user_id)
);

create or replace function public.is_member(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.project_members where project_id = p and user_id = auth.uid())
$$;

create table public.subcontractors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  rate numeric(12,2) not null default 0,
  unit text not null default 'sqm',
  created_at timestamptz not null default now()
);

-- ───────────────────────── money entries ─────────────────────────
-- type: income (client payment), loan (from company), purchase (invoice), expense, subpay (to subcontractor)
create table public.txns (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('income','loan','purchase','expense','subpay')),
  project_id uuid not null references public.projects(id),
  split jsonb not null default '[]',          -- [{project_id, pct}] for shared purchases
  amount numeric(14,2),                        -- loan / expense / subpay amount
  -- income (filled by trigger from gross)
  gross numeric(14,2), base numeric(14,2), vat numeric(14,2), fee numeric(14,2), fee_pct numeric(5,2), loan numeric(14,2) default 0, net numeric(14,2),
  company text,
  -- purchase
  supplier text, lines jsonb not null default '[]', subtotal numeric(14,2), vat_amount numeric(14,2) default 0, vat_company text, total numeric(14,2),
  sub_name text, description text,
  receipt_path text,
  flags jsonb not null default '[]',           -- warnings the user accepted
  heard text,                                  -- what was spoken, kept as proof
  status text not null default 'active' check (status in ('active','cancelled')),
  cancel_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.txns (project_id);
create index on public.txns (created_by, created_at desc);

-- ───────────────────────── site progress ─────────────────────────
create table public.progress (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  sub_name text not null,
  qty numeric(12,2) not null check (qty > 0),
  unit text not null default 'sqm',
  work text,
  rate numeric(12,2),                          -- snapshot of the subcontractor rate (trigger)
  flags jsonb not null default '[]',
  heard text,
  status text not null default 'active' check (status in ('active','cancelled')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.progress (project_id);

-- ───────────────────────── materials & prices ─────────────────────────
create table public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  aliases text[] not null default '{}',
  category text,
  size text,
  unit text,
  photo_path text,
  created_at timestamptz not null default now()
);
create table public.prices (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  price numeric(12,2) not null check (price > 0),
  kind text not null check (kind in ('cost','sell','estimate')),
  source text,                                 -- invoice | abu | quote | manual | ai-estimate
  supplier text, low numeric(12,2), high numeric(12,2), note text,
  txn_id uuid, quote_id uuid, photo_path text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.prices (item_id, created_at desc);

-- ───────────────────────── quotations ─────────────────────────
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  client text,
  owner text not null default 'admin' check (owner in ('admin','abu')),
  status text not null default 'Draft' check (status in ('Draft','Abu Review','Sent to Client','Approved','Lost')),
  lines jsonb not null default '[]',           -- [{desc, qty, unit, rate}]
  history jsonb not null default '[]',
  lost_reason text,
  project_id uuid,
  rfq jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── documents (drawings) ─────────────────────────
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  doc_no text not null,
  rev text not null default 'Rev 0',
  state text not null default 'Pending' check (state in ('Pending','Approved','Approved with Comments','Rejected')),
  file_path text not null,
  name text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- ───────────────────────── live location (06:00–18:00 Riyadh only) ─────────────────────────
create table public.locations (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  lat double precision not null, lng double precision not null, accuracy real,
  at timestamptz not null default now()
);
create index on public.locations (user_id, at desc);

-- ───────────────────────── audit log ─────────────────────────
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  table_name text not null,
  op text not null,
  row_id text,
  old jsonb, new jsonb
);
create index on public.audit_log (at desc);
