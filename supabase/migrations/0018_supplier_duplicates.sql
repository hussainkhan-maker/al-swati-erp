-- 0018: one supplier per name + phone.
-- On 7 Nov 2026 "Salem Ahmed" was saved 16 times in one second. The owner approved (14 Nov) removing the extra copies:
-- for each name + phone the newest, most complete row is kept, and only copies that nothing points to are removed.
with ranked as (
  select id, row_number() over (
           partition by lower(btrim(name)), coalesce(regexp_replace(phone, '\D', '', 'g'), '')
           order by coalesce(array_length(categories, 1), 0) desc, length(coalesce(notes, '')) desc, created_at desc) as rn
  from public.suppliers
)
delete from public.suppliers s
using ranked r
where s.id = r.id and r.rn > 1
  and not exists (select 1 from public.supplier_requests q where q.supplier_id = s.id);

-- From now on the database itself refuses a second copy (a double tap, a retry after a lost reply, or the AI finding one again).
create unique index if not exists suppliers_one_per_name_phone
  on public.suppliers (lower(btrim(name)), coalesce(regexp_replace(phone, '\D', '', 'g'), ''));

select (select count(*) from public.suppliers) as suppliers_left,
       (select count(*) from public.suppliers where name ilike 'salem ahmed%') as salem_ahmed_rows,
       (select count(*) from pg_indexes where indexname = 'suppliers_one_per_name_phone') as duplicate_guard;
