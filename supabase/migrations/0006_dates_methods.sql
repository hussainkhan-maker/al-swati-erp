-- When and how each payment was made, and the date the work was done (can be earlier than the day it is entered).
alter table public.txns add column if not exists paid_on date;
alter table public.txns add column if not exists method text;
alter table public.progress add column if not exists work_date date;
update public.txns set paid_on = created_at::date where paid_on is null;
update public.progress set work_date = created_at::date where work_date is null;
