-- Each subcontractor works on one or more projects. The link is made by hand (Projects screen) and also
-- automatically whenever progress or a payment is saved for that subcontractor on a project.
alter table public.subcontractors add column if not exists projects uuid[] not null default '{}';

create or replace function public.link_sub_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sub_name is not null and new.project_id is not null then
    update public.subcontractors set projects = array_append(projects, new.project_id)
    where lower(name) = lower(new.sub_name) and not (new.project_id = any(projects));
  end if;
  return null;
end $$;

drop trigger if exists progress_link_sub on public.progress;
create trigger progress_link_sub after insert on public.progress for each row execute function public.link_sub_project();
drop trigger if exists txns_link_sub on public.txns;
create trigger txns_link_sub after insert on public.txns for each row when (new.type = 'subpay') execute function public.link_sub_project();

-- Link the work and payments already saved.
update public.subcontractors s set projects = coalesce((
  select array_agg(distinct x.pid) from (
    select project_id as pid from public.progress where lower(sub_name) = lower(s.name)
    union select project_id from public.txns where type = 'subpay' and lower(sub_name) = lower(s.name)) x), '{}');
