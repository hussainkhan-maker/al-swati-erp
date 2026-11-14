-- 0007: delete draft quotations, RFIs with follow-up, blog posts (SEO) and consent-based outreach.

-- Super-Admin may delete a quotation only while it is a draft or lost, and not approved & locked.
drop policy if exists quotes_delete on public.quotes;
create policy quotes_delete on public.quotes for delete
  using (public.my_role() = 'admin' and status in ('Draft','Lost') and (rfq is null or rfq->'lock' is null or rfq->'lock' = 'null'::jsonb));

-- ───────── RFIs: questions to the consultant when BOQ, drawings and specs do not agree ─────────
create table if not exists public.rfis (
  id uuid primary key default gen_random_uuid(),
  ref text unique,                                   -- RFI-2026-001
  quote_id uuid references public.quotes(id) on delete set null,
  inquiry_id uuid references public.inquiries(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  to_name text, to_email text, to_phone text,
  subject text not null,
  questions jsonb not null default '[]',             -- [{q, ref (BOQ item / drawing), line (quotation line index), answer}]
  letter text,                                       -- the RFI text that was sent
  status text not null default 'Draft' check (status in ('Draft','Sent','Answered','Applied','Closed')),
  due_date date,
  sent_at timestamptz,
  follow_ups jsonb not null default '[]',            -- [{at, text}]
  answer text,                                       -- consultant's reply as received
  answered_at timestamptz,
  changes jsonb,                                     -- what the AI proposed from the answer, and what was applied
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace function public.rfis_ref() returns trigger language plpgsql as $$
begin
  if new.ref is null then
    new.ref := 'RFI-' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY') || '-' ||
      lpad((select count(*) + 1 from public.rfis where created_at >= date_trunc('year', now()))::text, 3, '0');
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists rfis_ref on public.rfis;
create trigger rfis_ref before insert or update on public.rfis for each row execute function public.rfis_ref();

-- ───────── Blog posts for the website (SEO). Only posts the owner publishes are visible to the public. ─────────
create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  lang text not null default 'en' check (lang in ('en','ar')),
  title text not null,
  meta_description text,
  keywords text[] not null default '{}',
  body text not null default '',                     -- markdown
  status text not null default 'Draft' check (status in ('Draft','Published','Archived')),
  published_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────── Outreach: people the owner already knows or who gave their contact. Sent one by one from his own email. ─────────
create table if not exists public.outreach_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  role text,                                          -- Project Manager, Construction Manager, Consultant, Developer…
  city text,                                          -- Riyadh, Al-Hassa, Dammam…
  email text, phone text,
  source text not null,                               -- where the contact came from (met on site, business card, referral, replied to us…)
  status text not null default 'New' check (status in ('New','Emailed','Replied','Meeting','Not interested','Opted out')),
  emails jsonb not null default '[]',                 -- [{at, subject, body, kind: first|follow-up}]
  last_contact timestamptz,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists outreach_email_unique on public.outreach_contacts (lower(email)) where email is not null and email <> '';

alter table public.rfis enable row level security;
alter table public.blog_posts enable row level security;
alter table public.outreach_contacts enable row level security;
drop policy if exists rfis_all on public.rfis;
create policy rfis_all on public.rfis for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists blog_admin on public.blog_posts;
create policy blog_admin on public.blog_posts for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists blog_public on public.blog_posts;
create policy blog_public on public.blog_posts for select to anon, authenticated using (status = 'Published');
drop policy if exists outreach_all on public.outreach_contacts;
create policy outreach_all on public.outreach_contacts for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

do $$ declare t text;
begin
  foreach t in array array['rfis','blog_posts','outreach_contacts'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit()', t);
  end loop;
end $$;

-- The company's public contact card (shown on the public blog page) can be read by anyone; other preferences stay private.
drop policy if exists prefs_public on public.preferences;
create policy prefs_public on public.preferences for select to anon, authenticated using (key = 'company_profile');
