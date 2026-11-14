-- Small expenses (fuel, food, tools) are saved without a receipt photo.
-- Only purchase invoices (bought material) still need the photo.
do $$
declare f text;
begin
  select pg_get_functiondef(p.oid) into f from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosrc like '%A receipt photo is required.%' limit 1;
  if f is null then raise notice 'rule not found'; return; end if;
  f := replace(f, $x$new.type in ('purchase','expense') and coalesce(new.receipt_path$x$, $x$new.type = 'purchase' and coalesce(new.receipt_path$x$);
  execute f;
end $$;
select count(*) as still_strict from pg_proc where prosrc like '%(''purchase'',''expense'') and coalesce(new.receipt_path%';
