-- 0020: the server's own clock. GitHub's 30-minute timer really runs about once an hour, so the database itself now calls
-- the functions on time: Outlook every 30 minutes, the query autopilot 5 minutes later, and the weekly backup check once a day.
-- __ANON_KEY__ is replaced with the app's public (anon) key when this is run (the same key the app ships with; not a secret).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname in ('al-swati-outlook', 'al-swati-autopilot', 'al-swati-backup');

select cron.schedule('al-swati-outlook', '*/30 * * * *', $job$
  select net.http_post(
    url := 'https://keweaoogdnxietvyerhj.supabase.co/functions/v1/inbound-query',
    headers := jsonb_build_object('content-type', 'application/json', 'Authorization', 'Bearer __ANON_KEY__', 'apikey', '__ANON_KEY__'),
    body := '{"action":"outlook_pull"}'::jsonb, timeout_milliseconds := 150000)
$job$);

select cron.schedule('al-swati-autopilot', '5,35 * * * *', $job$
  select net.http_post(
    url := 'https://keweaoogdnxietvyerhj.supabase.co/functions/v1/ai',
    headers := jsonb_build_object('content-type', 'application/json', 'Authorization', 'Bearer __ANON_KEY__', 'apikey', '__ANON_KEY__'),
    body := '{"task":"autopilot"}'::jsonb, timeout_milliseconds := 150000)
$job$);

select cron.schedule('al-swati-backup', '20 0 * * *', $job$
  select net.http_post(
    url := 'https://keweaoogdnxietvyerhj.supabase.co/functions/v1/inbound-query',
    headers := jsonb_build_object('content-type', 'application/json', 'Authorization', 'Bearer __ANON_KEY__', 'apikey', '__ANON_KEY__'),
    body := '{"action":"backup"}'::jsonb, timeout_milliseconds := 150000)
$job$);

select jobname, schedule, active from cron.job where jobname like 'al-swati-%' order by jobname;
