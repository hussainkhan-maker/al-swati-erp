-- 0016: invoices the project's company (e.g. Hindcco) raises for our work, so part payments and promised dates are tracked.
-- A payment received is linked to an invoice through txns.invoice_no; what is still to come = invoice amount − payments.
create table if not exists public.company_invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  invoice_no text not null,
  amount numeric(14,2) not null check (amount > 0),
  issued_on date not null default current_date,
  due_on date,
  note text,
  status text not null default 'open' check (status in ('open', 'cancelled')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (project_id, invoice_no)
);
alter table public.company_invoices enable row level security;
drop policy if exists invoices_read on public.company_invoices;
create policy invoices_read on public.company_invoices for select using (public.my_role() in ('admin', 'abu'));
drop policy if exists invoices_insert on public.company_invoices;
create policy invoices_insert on public.company_invoices for insert with check (public.my_role() in ('admin', 'abu'));
drop policy if exists invoices_update on public.company_invoices;
create policy invoices_update on public.company_invoices for update using (public.my_role() = 'admin');
drop trigger if exists audit_company_invoices on public.company_invoices;
create trigger audit_company_invoices after insert or update or delete on public.company_invoices for each row execute function public.audit();
do $$ begin alter publication supabase_realtime add table public.company_invoices; exception when others then null; end $$;

select (select count(*) from pg_policies where tablename = 'company_invoices') as rules,
       has_table_privilege('anon', 'public.company_invoices', 'select') as anon_table_grant;
