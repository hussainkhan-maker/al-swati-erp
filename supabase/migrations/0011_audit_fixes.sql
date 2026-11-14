-- Fixes from the independent audit (14 Nov 2026).

-- 1. Work done under a NEW subcontractor name never brings its own rate (only Super-Admin sets rates).
create or replace function public.progress_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  new.created_by := auth.uid();
  new.status := 'active';
  new.sub_name := trim(new.sub_name);
  select * into s from public.subcontractors where lower(name) = lower(new.sub_name);
  if not found then
    insert into public.subcontractors(name, rate, unit) values (new.sub_name, 0, new.unit);
    new.rate := null;
    new.flags := new.flags || jsonb_build_array('New subcontractor: rate not set yet');
  else
    new.sub_name := s.name;
    new.rate := nullif(s.rate, 0);
  end if;
  return new;
end $$;

-- 2. Only Super-Admin sets a service fee, also when a project is first created.
create or replace function public.projects_fee_insert() returns trigger
language plpgsql as $$
begin
  if public.my_role() is distinct from 'admin' and auth.uid() is not null then new.fee_pct := 0; end if;
  return new;
end $$;
drop trigger if exists projects_fee_insert on public.projects;
create trigger projects_fee_insert before insert on public.projects for each row execute function public.projects_fee_insert();

-- 3. Purchase VAT must be between 0 and the invoice total.
do $$ begin
  alter table public.txns add constraint txns_vat_range
    check (type <> 'purchase' or (coalesce(vat_amount, 0) >= 0 and coalesce(vat_amount, 0) <= coalesce(total, 0))) not valid;
exception when duplicate_object then null; end $$;

-- 4. One project per quotation (stops a double click from opening two projects).
do $$ begin
  create unique index if not exists projects_quote_unique on public.projects(quote_id) where quote_id is not null;
exception when unique_violation then raise notice 'two projects already share a quotation: index not made'; end $$;

-- 5. Money entries can carry the id made on the phone, so a retry after a lost reply never saves twice.
--    (Nothing to change in the table: id is a uuid primary key with a default; the app now sends its own.)

-- 6. Query and RFI numbers: next number after the highest one this year (count+1 repeated numbers after a delete).
create or replace function public.inquiries_ref() returns trigger language plpgsql as $$
declare yr text := to_char(now() at time zone 'Asia/Riyadh', 'YYYY');
begin
  if new.ref is null then
    new.ref := 'Q-' || yr || '-' || lpad((select coalesce(max(substring(ref from '(\d+)$')::int), 0) + 1 from public.inquiries where ref like 'Q-' || yr || '-%')::text, 4, '0');
  end if;
  return new;
end $$;
create or replace function public.rfis_ref() returns trigger language plpgsql as $$
declare yr text := to_char(now() at time zone 'Asia/Riyadh', 'YYYY');
begin
  if new.ref is null then
    new.ref := 'RFI-' || yr || '-' || lpad((select coalesce(max(substring(ref from '(\d+)$')::int), 0) + 1 from public.rfis where ref like 'RFI-' || yr || '-%')::text, 3, '0');
  end if;
  new.updated_at := now();
  return new;
end $$;

-- 7. "Installed m²" counts only square-metre work (skirting in rft / lm and pieces are not m²).
do $$
declare v text;
begin
  v := pg_get_viewdef('public.project_ledger'::regclass, true);
  if position('sum(progress.qty) AS qty' in v) = 0 then raise notice 'project_ledger: pattern not found, unchanged'; return; end if;
  v := replace(v, 'sum(progress.qty) AS qty', 'sum(CASE WHEN lower(COALESCE(progress.unit, ''sqm'')) = ANY (ARRAY[''sqm'', ''m2'', ''m²'', ''م2'', ''م²'']) THEN progress.qty ELSE 0 END) AS qty');
  execute 'create or replace view public.project_ledger with (security_invoker = true) as ' || v;
end $$;

select
  (select count(*) from pg_trigger where tgname = 'projects_fee_insert') as fee_trigger,
  (select count(*) from pg_constraint where conname = 'txns_vat_range') as vat_check,
  (select count(*) from pg_indexes where indexname = 'projects_quote_unique') as one_project_per_quote,
  position('m²' in pg_get_viewdef('public.project_ledger'::regclass, true)) > 0 as installed_m2_only;
