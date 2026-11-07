-- Al-Swati Stone ERP — business rules (triggers), ledgers (views), access rules (RLS), storage, realtime.

-- ═════════════════════════ 1. money rules on entries ═════════════════════════
create or replace function public.txns_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record; s jsonb; pct_sum numeric := 0; r text := public.my_role();
begin
  new.created_by := auth.uid();
  new.status := 'active';
  if r is null then raise exception 'Your account is not active.'; end if;

  if new.type = 'income' then
    if coalesce(new.gross, 0) <= 0 then raise exception 'Income needs the total amount received (above zero).'; end if;
    select fee_pct, company into p from public.projects where id = new.project_id;
    new.fee_pct := p.fee_pct;
    new.company := coalesce(nullif(new.company, ''), p.company);
    new.loan := round(coalesce(new.loan, 0), 2);
    if new.loan < 0 then raise exception 'Loan deduction cannot be negative.'; end if;
    -- VAT is 15% inside the total; the service fee is charged on the amount AFTER VAT.
    new.gross := round(new.gross, 2);
    new.base := round(new.gross / 1.15, 2);
    new.vat := new.gross - new.base;
    new.fee := round(new.base * new.fee_pct / 100, 2);
    new.net := new.gross - new.vat - new.fee - new.loan;
    new.amount := new.gross;
    if new.net < 0 then raise exception 'The loan deduction is bigger than the money left after VAT and fee.'; end if;
  end if;

  if new.type in ('loan','expense','subpay') and coalesce(new.amount, 0) <= 0 then
    raise exception 'Amount must be above zero.';
  end if;

  if new.type in ('purchase','expense') and coalesce(new.receipt_path, '') = '' then
    raise exception 'A receipt photo is required.';
  end if;

  if new.type = 'purchase' then
    if coalesce(new.total, 0) <= 0 then raise exception 'Invoice total must be above zero.'; end if;
    new.vat_amount := round(coalesce(new.vat_amount, 0), 2);
    if new.vat_amount > 0 and coalesce(new.vat_company, '') = '' then
      raise exception 'Choose the company the VAT was paid under.';
    end if;
    if new.vat_amount = 0 then new.vat_company := null; end if;
    if new.subtotal is null then new.subtotal := new.total - new.vat_amount; end if;
  end if;

  if jsonb_array_length(new.split) > 0 then
    for s in select * from jsonb_array_elements(new.split) loop
      pct_sum := pct_sum + (s->>'pct')::numeric;
      if not exists (select 1 from public.projects where id = (s->>'project_id')::uuid) then
        raise exception 'A project in the split does not exist.';
      end if;
      if r = 'supervisor' and not public.is_member((s->>'project_id')::uuid) then
        raise exception 'You can only record for your own sites.';
      end if;
    end loop;
    if abs(pct_sum - 100) > 0.01 then raise exception 'The split must add up to 100%% (now %).', pct_sum; end if;
    new.project_id := ((new.split->0)->>'project_id')::uuid;
  end if;

  if new.type = 'subpay' and not exists (select 1 from public.subcontractors where lower(name) = lower(new.sub_name)) then
    raise exception 'Subcontractor % is not on the list.', new.sub_name;
  end if;
  return new;
end $$;
create trigger txns_before_insert before insert on public.txns for each row execute function public.txns_before_insert();

-- Entries are never edited or deleted: they can only be cancelled, with a reason.
create or replace function public.txns_before_update() returns trigger
language plpgsql as $$
begin
  if old.status = 'cancelled' then raise exception 'This entry is already cancelled.'; end if;
  if (to_jsonb(new) - 'status' - 'cancel_reason') <> (to_jsonb(old) - 'status' - 'cancel_reason') then
    raise exception 'Money entries cannot be edited. Cancel it and record it again.';
  end if;
  if new.status = 'cancelled' and coalesce(new.cancel_reason, '') = '' then
    raise exception 'Write a reason for cancelling.';
  end if;
  return new;
end $$;
create trigger txns_before_update before update on public.txns for each row execute function public.txns_before_update();

-- Every purchase line with a price goes into the price list automatically.
create or replace function public.find_or_create_item(n text, u text, photo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare iid uuid;
begin
  select id into iid from public.items
   where lower(name) = lower(trim(n)) or exists (select 1 from unnest(aliases) a where lower(a) = lower(trim(n)))
   limit 1;
  if iid is null then
    insert into public.items(name, unit, photo_path) values (trim(n), u, photo) returning id into iid;
  end if;
  return iid;
end $$;

create or replace function public.txns_capture_prices() returns trigger
language plpgsql security definer set search_path = public as $$
declare l jsonb;
begin
  if new.type = 'purchase' then
    for l in select * from jsonb_array_elements(new.lines) loop
      if coalesce((l->>'price')::numeric, 0) > 0 and coalesce(l->>'name', '') <> '' then
        insert into public.prices(item_id, price, kind, source, supplier, txn_id, photo_path, created_by)
        values (public.find_or_create_item(l->>'name', l->>'unit', new.receipt_path), (l->>'price')::numeric, 'cost', 'invoice', new.supplier, new.id, new.receipt_path, new.created_by);
      end if;
    end loop;
  end if;
  return null;
end $$;
create trigger txns_capture_prices after insert on public.txns for each row execute function public.txns_capture_prices();

-- ═════════════════════════ 2. progress & subcontractors ═════════════════════════
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
    new.flags := new.flags || jsonb_build_array('New subcontractor: rate not set yet');
  else
    new.sub_name := s.name;
    new.rate := nullif(s.rate, 0);
  end if;
  return new;
end $$;
create trigger progress_before_insert before insert on public.progress for each row execute function public.progress_before_insert();

create or replace function public.progress_before_update() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'status' - 'rate') <> (to_jsonb(old) - 'status' - 'rate') then
    raise exception 'Progress cannot be edited. Cancel it and report again.';
  end if;
  return new;
end $$;
create trigger progress_before_update before update on public.progress for each row execute function public.progress_before_update();

-- When a rate is first set, work already reported without a rate takes it.
create or replace function public.subs_rate_backfill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.rate > 0 and new.rate is distinct from old.rate then
    update public.progress set rate = new.rate where lower(sub_name) = lower(new.name) and rate is null;
  end if;
  return null;
end $$;
create trigger subs_rate_backfill after update on public.subcontractors for each row execute function public.subs_rate_backfill();

-- ═════════════════════════ 3. projects & quotations ═════════════════════════
create or replace function public.projects_fee_guard() returns trigger
language plpgsql as $$
begin
  if new.fee_pct is distinct from old.fee_pct and public.my_role() <> 'admin' then
    raise exception 'Only Super-Admin can change the service fee.';
  end if;
  return new;
end $$;
create trigger projects_fee_guard before update on public.projects for each row execute function public.projects_fee_guard();

create or replace function public.quotes_before_update() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if public.my_role() = 'abu' then
    if not (old.status = 'Abu Review' and new.status = 'Draft')
       or (to_jsonb(new) - 'status' - 'history' - 'updated_at') <> (to_jsonb(old) - 'status' - 'history' - 'updated_at') then
      raise exception 'Abu can only approve a quotation sent to him for review.';
    end if;
  end if;
  return new;
end $$;
create trigger quotes_before_update before update on public.quotes for each row execute function public.quotes_before_update();

-- ═════════════════════════ 4. location hours ═════════════════════════
create or replace function public.locations_hours() returns trigger
language plpgsql as $$
declare h int := extract(hour from (now() at time zone 'Asia/Riyadh'));
begin
  new.user_id := auth.uid();
  new.at := now();
  if h < 6 or h >= 18 then raise exception 'Location is only recorded from 06:00 to 18:00.'; end if;
  return new;
end $$;
create trigger locations_hours before insert on public.locations for each row execute function public.locations_hours();

-- ═════════════════════════ 5. audit log on every table ═════════════════════════
create or replace function public.audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log(user_id, table_name, op, row_id, old, new)
  values (auth.uid(), tg_table_name, tg_op,
          coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id'),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;
do $$ declare t text;
begin
  foreach t in array array['profiles','projects','project_members','subcontractors','txns','progress','items','prices','quotes','documents'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit()', t);
  end loop;
end $$;

-- ═════════════════════════ 6. ledgers (computed by the database) ═════════════════════════
create or replace view public.project_ledger with (security_invoker = true) as
with shares as (
  select t.*, coalesce((s.e->>'project_id')::uuid, t.project_id) as pid,
         coalesce((s.e->>'pct')::numeric, 100) / 100 as sh
  from public.txns t
  left join lateral jsonb_array_elements(t.split) as s(e) on true
  where t.status = 'active'
), m as (
  select pid,
    sum(case when type = 'income' then gross * sh else 0 end) as gross,
    sum(case when type = 'income' then vat * sh else 0 end) as vat,
    sum(case when type = 'income' then fee * sh else 0 end) as fee,
    sum(case when type = 'income' then net * sh else 0 end) as net,
    sum(case when type = 'income' then coalesce(loan, 0) * sh else 0 end) as loan_deducted,
    sum(case when type = 'loan' then amount * sh else 0 end) as loan_in,
    sum(case when type = 'purchase' then (total - coalesce(vat_amount, 0)) * sh when type = 'expense' then amount * sh else 0 end) as cost,
    sum(case when type = 'purchase' then coalesce(vat_amount, 0) * sh else 0 end) as purchase_vat,
    sum(case when type = 'subpay' then amount * sh else 0 end) as sub_paid
  from shares group by pid
), w as (
  select project_id as pid, sum(qty * coalesce(rate, 0)) as sub_work, sum(qty) as qty
  from public.progress where status = 'active' group by project_id
)
select p.id as project_id, p.name, p.company, p.fee_pct, p.status,
  round(coalesce(m.gross, 0), 2) as gross, round(coalesce(m.vat, 0), 2) as vat, round(coalesce(m.fee, 0), 2) as fee,
  round(coalesce(m.net, 0), 2) as net, round(coalesce(m.cost, 0), 2) as cost, round(coalesce(m.purchase_vat, 0), 2) as purchase_vat,
  round(coalesce(w.sub_work, 0), 2) as sub_work, round(coalesce(m.sub_paid, 0), 2) as sub_paid, round(coalesce(w.qty, 0), 2) as installed,
  round(coalesce(m.loan_in, 0) - coalesce(m.loan_deducted, 0), 2) as loan_balance,
  round(coalesce(w.sub_work, 0) - coalesce(m.sub_paid, 0), 2) as sub_due,
  round(coalesce(m.net, 0) + coalesce(m.loan_deducted, 0) - coalesce(m.cost, 0) - coalesce(w.sub_work, 0), 2) as profit
from public.projects p left join m on m.pid = p.id left join w on w.pid = p.id;

create or replace view public.vat_by_company with (security_invoker = true) as
select vat_company as company, round(sum(vat_amount), 2) as vat, count(*) as invoices
from public.txns where type = 'purchase' and status = 'active' and vat_amount > 0
group by vat_company;

create or replace view public.sub_ledger with (security_invoker = true) as
select s.id, s.name, s.rate, s.unit,
  coalesce((select sum(qty) from public.progress p where lower(p.sub_name) = lower(s.name) and p.status = 'active'), 0) as qty,
  coalesce((select sum(qty * coalesce(rate, 0)) from public.progress p where lower(p.sub_name) = lower(s.name) and p.status = 'active'), 0) as earned,
  coalesce((select sum(amount) from public.txns t where t.type = 'subpay' and lower(t.sub_name) = lower(s.name) and t.status = 'active'), 0) as paid
from public.subcontractors s;

-- Supervisors see names and meters, never rates or money.
create or replace function public.sub_names() returns setof text
language sql stable security definer set search_path = public as $$ select name from public.subcontractors order by name $$;

create or replace function public.sup_progress() returns table(id uuid, project_id uuid, sub_name text, qty numeric, unit text, work text, created_by uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, project_id, sub_name, qty, unit, work, created_by, created_at from public.progress
  where status = 'active' and public.is_member(project_id) order by created_at desc limit 2000
$$;

-- ═════════════════════════ 7. who may read and write what ═════════════════════════
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.subcontractors enable row level security;
alter table public.txns enable row level security;
alter table public.progress enable row level security;
alter table public.items enable row level security;
alter table public.prices enable row level security;
alter table public.quotes enable row level security;
alter table public.documents enable row level security;
alter table public.locations enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_read on public.profiles for select using (id = auth.uid() or public.my_role() in ('admin','abu','engineer'));
create policy profiles_admin on public.profiles for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy profiles_own_lang on public.profiles for update using (id = auth.uid()) with check (id = auth.uid() and role = public.my_role() and active);

create policy projects_read on public.projects for select using (public.my_role() in ('admin','abu','engineer') or public.is_member(id));
create policy projects_insert on public.projects for insert with check (public.my_role() in ('admin','abu'));
create policy projects_update on public.projects for update using (public.my_role() = 'admin');

create policy members_read on public.project_members for select using (public.my_role() in ('admin','abu','engineer') or user_id = auth.uid());
create policy members_admin on public.project_members for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy subs_read on public.subcontractors for select using (public.my_role() in ('admin','abu','engineer'));
create policy subs_write on public.subcontractors for insert with check (public.my_role() in ('admin','abu'));
create policy subs_update on public.subcontractors for update using (public.my_role() in ('admin','abu'));

create policy txns_read on public.txns for select using (public.my_role() in ('admin','abu') or (public.my_role() = 'supervisor' and created_by = auth.uid()));
create policy txns_insert on public.txns for insert with check (
  public.my_role() in ('admin','abu')
  or (public.my_role() = 'supervisor' and type in ('purchase','expense') and public.is_member(project_id)));
create policy txns_cancel on public.txns for update using (public.my_role() = 'admin');

create policy progress_read on public.progress for select using (public.my_role() in ('admin','abu','engineer'));
create policy progress_insert on public.progress for insert with check (
  public.my_role() in ('admin','abu','engineer') or (public.my_role() = 'supervisor' and public.is_member(project_id)));
create policy progress_update on public.progress for update using (public.my_role() = 'admin');

create policy items_read on public.items for select using (public.my_role() in ('admin','abu'));
create policy items_write on public.items for insert with check (public.my_role() in ('admin','abu'));
create policy items_update on public.items for update using (public.my_role() = 'admin');
create policy prices_read on public.prices for select using (public.my_role() in ('admin','abu'));
create policy prices_write on public.prices for insert with check (public.my_role() in ('admin','abu'));

create policy quotes_read on public.quotes for select using (public.my_role() in ('admin','engineer') or (public.my_role() = 'abu' and owner = 'abu'));
create policy quotes_insert on public.quotes for insert with check (public.my_role() = 'admin');
create policy quotes_update on public.quotes for update using (public.my_role() = 'admin' or (public.my_role() = 'abu' and owner = 'abu'));

create policy docs_read on public.documents for select using (public.my_role() in ('admin','abu','engineer') or (public.my_role() = 'supervisor' and public.is_member(project_id)));
create policy docs_write on public.documents for insert with check (public.my_role() in ('admin','engineer'));
create policy docs_update on public.documents for update using (public.my_role() in ('admin','engineer'));

create policy loc_insert on public.locations for insert with check (public.my_role() in ('supervisor','engineer'));
create policy loc_read on public.locations for select using (public.my_role() = 'admin' or user_id = auth.uid());

create policy audit_read on public.audit_log for select using (public.my_role() = 'admin');

-- ═════════════════════════ 8. photo & file storage ═════════════════════════
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false), ('documents', 'documents', false)
on conflict (id) do nothing;

create policy receipts_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (public.my_role() in ('admin','abu') or (storage.foldername(name))[1] = auth.uid()::text));
create policy documents_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.my_role() in ('admin','engineer'));
create policy documents_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (public.my_role() in ('admin','abu','engineer')
         or (public.my_role() = 'supervisor' and public.is_member(((storage.foldername(name))[1])::uuid))));

-- ═════════════════════════ 9. live updates to the phones ═════════════════════════
alter publication supabase_realtime add table public.projects, public.project_members, public.subcontractors, public.txns,
  public.progress, public.items, public.prices, public.quotes, public.documents;
