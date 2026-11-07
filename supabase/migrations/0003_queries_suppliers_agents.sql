-- Client queries from email / website, supplier directory and price requests, and the agents' daily reports.

create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  ref text unique,                                   -- Q-2026-0142
  source text not null default 'email' check (source in ('email','website','whatsapp','manual')),
  from_name text, from_email text, subject text,
  body text,                                         -- email text + Excel/CSV converted to text
  attachments jsonb not null default '[]',           -- [{path, name, type}]
  dedupe_key text unique,                            -- same RFQ arriving twice counts once
  status text not null default 'New' check (status in ('New','Under Review','RFI Sent','Priced','Sent','Won','Lost')),
  deadline date,
  reading jsonb,                                     -- AI double reading {a, b}
  quote_id uuid,
  created_at timestamptz not null default now()
);

create or replace function public.inquiries_ref() returns trigger language plpgsql as $$
begin
  if new.ref is null then
    new.ref := 'Q-' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY') || '-' ||
      lpad((select count(*) + 1 from public.inquiries where created_at >= date_trunc('year', now()))::text, 4, '0');
  end if;
  return new;
end $$;
create trigger inquiries_ref before insert on public.inquiries for each row execute function public.inquiries_ref();

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  cr_no text,                                        -- Saudi commercial registration
  cr_verified boolean not null default false,
  phone text, whatsapp text, email text,
  categories text[] not null default '{}',           -- Marble, Granite, Porcelain, Civil, Fixing…
  lang text not null default 'ar' check (lang in ('ar','en','ur')),
  notes text,
  website text,
  source text not null default 'manual',          -- manual | ai-search (found by the supplier finder, waiting for approval)
  approved boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.supplier_requests (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  inquiry_id uuid references public.inquiries(id) on delete set null,
  quote_id uuid,
  items jsonb not null default '[]',                 -- [{desc, qty, unit}]
  message text,
  channel text check (channel in ('whatsapp','email','call')),
  status text not null default 'Draft' check (status in ('Draft','Sent','Replied','No reply')),
  reply_note text,
  sent_at timestamptz, replied_at timestamptz,
  rating smallint check (rating between 1 and 5),    -- after delivery: on time & quality
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.agent_reports (
  id uuid primary key default gen_random_uuid(),
  for_role text not null default 'admin',
  summary text not null,
  items jsonb not null default '[]',                 -- [{level:'bad'|'warn', text}]
  created_at timestamptz not null default now()
);

-- Owner's preferences the advisor learns from and the checks use (target margin, minimum margin, rounding…)
create table public.preferences (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.preferences(key, value) values
  ('margin', '{"target": 20, "minimum": 12, "round_to": 5}'),
  ('quote_terms', '{"validity_days": 15, "payment": "As agreed", "notes": "Prices exclude VAT unless stated. Supply and installation as per BOQ."}')
on conflict do nothing;

alter table public.preferences enable row level security;
create policy prefs_read on public.preferences for select using (public.my_role() in ('admin','abu'));
create policy prefs_write on public.preferences for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

alter table public.inquiries enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_requests enable row level security;
alter table public.agent_reports enable row level security;

create policy inq_all on public.inquiries for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy sup_read on public.suppliers for select using (public.my_role() in ('admin','abu'));
create policy sup_write on public.suppliers for insert with check (public.my_role() in ('admin','abu'));
create policy sup_update on public.suppliers for update using (public.my_role() in ('admin','abu'));
create policy sreq_read on public.supplier_requests for select using (public.my_role() in ('admin','abu'));
create policy sreq_write on public.supplier_requests for insert with check (public.my_role() in ('admin','abu'));
create policy sreq_update on public.supplier_requests for update using (public.my_role() in ('admin','abu'));
create policy rep_read on public.agent_reports for select using (public.my_role() = for_role or public.my_role() = 'admin');

insert into storage.buckets (id, name, public) values ('inbox', 'inbox', false) on conflict (id) do nothing;
create policy inbox_read on storage.objects for select to authenticated using (bucket_id = 'inbox' and public.my_role() = 'admin');

do $$ declare t text;
begin
  foreach t in array array['inquiries','suppliers','supplier_requests'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit()', t);
  end loop;
end $$;
alter publication supabase_realtime add table public.inquiries, public.suppliers, public.supplier_requests, public.agent_reports;

-- Morning report by the main agent at 07:00 Riyadh (04:00 UTC). Needs the pg_cron and pg_net extensions (Database → Extensions).
-- Replace PROJECT_REF and CRON_SECRET, then run once:
-- select cron.schedule('daily-agent-report', '0 4 * * *', $$
--   select net.http_post(url := 'https://PROJECT_REF.supabase.co/functions/v1/daily-report',
--     headers := '{"Content-Type":"application/json","x-cron-secret":"CRON_SECRET"}'::jsonb, body := '{}'::jsonb) $$);
