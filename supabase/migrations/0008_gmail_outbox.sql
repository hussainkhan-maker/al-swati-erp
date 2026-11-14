-- 0008: replies the owner approves in the app become drafts in his own Gmail (the Gmail script picks them up).
create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid references public.inquiries(id) on delete set null,
  gmail_id text,                                     -- the client's email in Gmail: the draft is made as a reply in that thread
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'Pending' check (status in ('Pending','Drafted','Failed','Cancelled')),
  error text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  drafted_at timestamptz
);
alter table public.email_outbox enable row level security;
drop policy if exists outbox_all on public.email_outbox;
create policy outbox_all on public.email_outbox for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop trigger if exists audit_email_outbox on public.email_outbox;
create trigger audit_email_outbox after insert or update or delete on public.email_outbox for each row execute function public.audit();
