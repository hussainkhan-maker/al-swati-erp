-- 0019: private place for the weekly data backups (made by the server; only Super-Admin gets a download link, for 10 minutes).
insert into storage.buckets (id, name, public) values ('backups', 'backups', false) on conflict (id) do nothing;
-- No storage policies on purpose: app users cannot list or read this bucket directly.
select (select count(*) from storage.buckets where id = 'backups' and not public) as private_backup_bucket,
       (select count(*) from pg_policies where schemaname = 'storage' and (qual ilike '%backups%' or with_check ilike '%backups%')) as client_rules_on_it;
