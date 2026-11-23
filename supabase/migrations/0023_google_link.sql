-- 0023: the owner's own "Sign in with Google" for Search Console (read-only). The company's Google account blocks
-- service-account keys, so the SEO autopilot reads Search Console with the owner's sign-in instead.
-- Holds the renewable sign-in, so NO app user can read or change it: only the server (service role) uses it.
create table if not exists public.google_link (
  id int primary key default 1 check (id = 1),
  account text,
  refresh_token text,
  pkce text,                 -- the sign-in in progress (state + verifier), for 15 minutes
  pkce_expires timestamptz,
  connected_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.google_link enable row level security;
revoke all on public.google_link from anon, authenticated;

select (select count(*) from pg_policies where tablename = 'google_link') as rules,
       has_table_privilege('authenticated', 'public.google_link', 'select') as app_users_can_read;
