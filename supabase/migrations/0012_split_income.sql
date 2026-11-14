-- A split entry takes its project from the split BEFORE any money rule runs.
-- Income is always for one project (each project has its own service fee), so income cannot be split.
do $$
declare f text;
  anchor text := 'if r is null then raise exception ''Your account is not active.''; end if;';
begin
  f := pg_get_functiondef('public.txns_before_insert'::regproc);
  if position('Income is recorded for one project at a time' in f) > 0 then raise notice 'already done'; return; end if;
  if position(anchor in f) = 0 then raise exception 'txns_before_insert: anchor not found, nothing changed'; end if;
  f := replace(f, anchor, anchor || '
  if jsonb_array_length(coalesce(new.split, ''[]''::jsonb)) > 0 then
    if new.type = ''income'' then raise exception ''Income is recorded for one project at a time (no split).''; end if;
    new.project_id := ((new.split->0)->>''project_id'')::uuid;
  end if;');
  execute f;
end $$;
select position('Income is recorded for one project at a time' in pg_get_functiondef('public.txns_before_insert'::regproc)) > 0 as split_rule_on;
