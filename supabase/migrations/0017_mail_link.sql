-- 0017: the owner's Outlook (Microsoft 365) mailbox, linked once with Microsoft's own sign-in.
-- Holds the renewable sign-in token, so NO app user can read or change it: only the server (service role) uses it.
create table if not exists public.mail_link (
  id int primary key default 1 check (id = 1),
  provider text not null default 'outlook',
  account text,
  refresh_token text,
  device_code text,
  device_expires timestamptz,
  watermark timestamptz,          -- newest inbox email already looked at
  pull_started timestamptz,       -- one pull at a time
  last_pull timestamptz,
  last_error text,
  checked int not null default 0, -- emails looked at so far
  taken int not null default 0,   -- of those, client queries brought into the app
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.mail_link enable row level security;
revoke all on public.mail_link from anon, authenticated;

select (select count(*) from pg_policies where tablename = 'mail_link') as rules,
       has_table_privilege('authenticated', 'public.mail_link', 'select') as app_users_can_read,
       has_table_privilege('anon', 'public.mail_link', 'select') as public_can_read;
