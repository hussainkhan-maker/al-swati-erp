-- 0027: the website's instant cost calculator (/stone-cladding-cost-calculator/ and the homepage section).
-- Each page view where a visitor uses the calculator counts once as kind 'estimate' (no names); an estimate the visitor
-- sends with name and mobile goes into Queries like the quote form (kind 'lead').
alter table public.web_events drop constraint if exists web_events_kind_check;
alter table public.web_events add constraint web_events_kind_check check (kind in ('lead','whatsapp','call','email','estimate'));

-- The price table the AI writes from now also has limestone and the fixing-system extras the calculator uses.
update public.preferences set value = jsonb_set(value, '{price_table}', to_jsonb('Natural Riyadh stone 250–350, Imported limestone 350–550, Marble 500–700, Granite 300–500, Porcelain 250–400 (SAR per m², supply and installation with mechanical Up-Down fixing). C-Channel rail +50 and undercut anchors +100 SAR per m². Commercial towers +10%, interior feature walls +15%.'::text)), updated_at = now()
  where key = 'company_profile' and value->>'price_table' = 'Natural Riyadh stone 250–350, Marble 500–700, Granite 300–500, Porcelain 250–400 (SAR per m², supply and installation with mechanical fixing)';

select (select pg_get_constraintdef(oid) from pg_constraint where conname = 'web_events_kind_check') as kinds,
       (select value->>'price_table' from public.preferences where key = 'company_profile') as price_table;
