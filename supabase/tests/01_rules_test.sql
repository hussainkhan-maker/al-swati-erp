-- Behaviour tests for the money rules and role limits. Run on a scratch database after the migrations.
\set ON_ERROR_STOP 0
insert into auth.users values ('00000000-0000-0000-0000-00000000000a','admin@x'),('00000000-0000-0000-0000-00000000000b','abu@x'),('00000000-0000-0000-0000-00000000000c','sup@x'),('00000000-0000-0000-0000-00000000000e','eng@x');
insert into public.profiles(id,name,role) values ('00000000-0000-0000-0000-00000000000a','Owner','admin'),('00000000-0000-0000-0000-00000000000b','Abu','abu'),('00000000-0000-0000-0000-00000000000c','Imran','supervisor'),('00000000-0000-0000-0000-00000000000e','Eng','engineer');
create or replace function pg_temp.as_(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
\echo '--- admin creates two projects'
set role authenticated; select pg_temp.as_('00000000-0000-0000-0000-00000000000a');
insert into projects(id,name,company,fee_pct) values ('10000000-0000-0000-0000-000000000001','Malqa','Company A',3),('10000000-0000-0000-0000-000000000002','Narjis','Company B',2.5);
insert into project_members values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000c');
\echo '--- income 115000: expect base 100000, vat 15000, fee 3000, net 97000'
insert into txns(type,project_id,gross) values ('income','10000000-0000-0000-0000-000000000001',115000) returning base,vat,fee,net,company;
\echo '--- income with loan bigger than what is left: expect ERROR'
insert into txns(type,project_id,gross,loan) values ('income','10000000-0000-0000-0000-000000000001',1000,5000);
\echo '--- abu: loan 50000 for Narjis'
select pg_temp.as_('00000000-0000-0000-0000-00000000000b');
insert into txns(type,project_id,amount) values ('loan','10000000-0000-0000-0000-000000000002',50000) returning type, amount;
\echo '--- purchase without receipt: expect ERROR'
insert into txns(type,project_id,total) values ('purchase','10000000-0000-0000-0000-000000000001',4140);
\echo '--- purchase with VAT but no company: expect ERROR'
insert into txns(type,project_id,total,vat_amount,receipt_path) values ('purchase','10000000-0000-0000-0000-000000000001',4140,540,'b/r1.jpg');
\echo '--- split adding to 90%: expect ERROR'
insert into txns(type,project_id,total,receipt_path,split) values ('purchase','10000000-0000-0000-0000-000000000001',100,'b/r.jpg','[{"project_id":"10000000-0000-0000-0000-000000000001","pct":50},{"project_id":"10000000-0000-0000-0000-000000000002","pct":40}]');
\echo '--- good purchase 60/40 with a priced line: expect OK and a price + item created'
insert into txns(type,project_id,total,subtotal,vat_amount,vat_company,receipt_path,supplier,lines,split) values ('purchase','10000000-0000-0000-0000-000000000001',4140,3600,540,'Company A','b/r2.jpg','Cement Co','[{"name":"Cement bag","qty":200,"unit":"bag","price":18}]','[{"project_id":"10000000-0000-0000-0000-000000000001","pct":60},{"project_id":"10000000-0000-0000-0000-000000000002","pct":40}]') returning type,total,vat_company;
select i.name, p.price, p.kind, p.source from prices p join items i on i.id=p.item_id;
\echo '--- abu changes the fee: expect ERROR'
update projects set fee_pct = 5 where name='Malqa';
\echo '--- supervisor records income: expect ERROR (policy)'
select pg_temp.as_('00000000-0000-0000-0000-00000000000c');
insert into txns(type,project_id,gross) values ('income','10000000-0000-0000-0000-000000000001',1000);
\echo '--- supervisor expense on a site he is not on: expect ERROR'
insert into txns(type,project_id,amount,receipt_path) values ('expense','10000000-0000-0000-0000-000000000002',200,'c/x.jpg');
\echo '--- supervisor expense on his site: expect OK'
insert into txns(type,project_id,amount,receipt_path,description) values ('expense','10000000-0000-0000-0000-000000000001',200,'c/x.jpg','water') returning type, amount;
\echo '--- supervisor progress, Uzair is new: expect OK, flag, sub created'
insert into progress(project_id,sub_name,qty,work) values ('10000000-0000-0000-0000-000000000001','Uzair',50,'flooring');
\echo '--- what the supervisor can see: own txns only (1), projects (1), progress table (0), sup_progress (1), sub_names'
select count(*) as my_txns from txns; select name from projects; select count(*) as progress_rows from progress; select sub_name, qty from sup_progress(); select * from sub_names();
\echo '--- supervisor tries to read the ledger: expect zero money'
select name, net from project_ledger;
\echo '--- admin sets Uzair rate 25: the earlier report takes it'
select pg_temp.as_('00000000-0000-0000-0000-00000000000a');
update subcontractors set rate = 25 where name='Uzair';
select sub_name, qty, rate from progress;
\echo '--- admin edits an amount: expect ERROR; cancels without reason: expect ERROR; with reason: OK'
update txns set amount = 1 where type='loan';
update txns set status='cancelled' where type='expense';
update txns set status='cancelled', cancel_reason='entered twice' where type='expense' returning status, cancel_reason;
\echo '--- ledger (Malqa: net 97000, cost 2160, sub_work 1250 → profit 93590; Narjis: loan 50000, cost 1440)'
select name, gross, vat, fee, net, cost, purchase_vat, sub_work, loan_balance, profit from project_ledger order by name;
select * from vat_by_company;
\echo '--- abu edits a quotation line: expect ERROR; approves review: OK'
insert into quotes(id,title,owner,status,lines) values ('20000000-0000-0000-0000-000000000001','Lobby','abu','Abu Review','[{"desc":"Crema","qty":450,"unit":"sqm","rate":175}]');
select pg_temp.as_('00000000-0000-0000-0000-00000000000b');
update quotes set lines='[]' where id='20000000-0000-0000-0000-000000000001';
update quotes set status='Draft', history='["ok"]' where id='20000000-0000-0000-0000-000000000001' returning status;
\echo '--- engineer reads txns: expect 0'
select pg_temp.as_('00000000-0000-0000-0000-00000000000e');
select count(*) as eng_sees_txns from txns;
reset role;
\echo '--- audit log rows'
select table_name, op, count(*) from audit_log group by 1,2 order by 1,2;
