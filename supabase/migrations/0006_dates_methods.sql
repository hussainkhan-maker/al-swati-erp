-- When and how each payment was made, the invoice number, and the date the work was done (can be earlier than the day it is entered).
alter table public.txns add column if not exists paid_on date;
alter table public.txns add column if not exists method text;
alter table public.txns add column if not exists invoice_no text;
alter table public.progress add column if not exists work_date date;

-- Fill them for entries already saved: the app kept "Method · date" (and "Invoice 123") in the note until these columns existed.
-- Entries are normally locked against edits, so the lock is lifted only for this one-time fill.
alter table public.txns disable trigger txns_before_update;
update public.txns set
  method = coalesce(method, substring(description from '(Cash|Bank transfer|Cheque|STC Pay / card|Other)')),
  paid_on = coalesce(paid_on, substring(description from '(\d{4}-\d{2}-\d{2})')::date, created_at::date),
  invoice_no = coalesce(invoice_no, substring(description from 'Invoice ([^ ·]+)'));
alter table public.txns enable trigger txns_before_update;
alter table public.progress disable trigger progress_before_update;
update public.progress set work_date = coalesce(work_date, substring(work from '(\d{4}-\d{2}-\d{2})')::date, created_at::date);
alter table public.progress enable trigger progress_before_update;
