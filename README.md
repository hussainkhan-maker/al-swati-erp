# AL-Swati: asal app (Android + iPhone)

Ek hi code se **Android** aur **iPhone** dono ki app banti hai. Data, login, photos aur AI apne server par chalte hain, claude.ai par nahi.

| Hissa | Kya hai | Kahan hai |
|---|---|---|
| Phone app | Expo / React Native | `app/` |
| Database, login, photos | Supabase (Postgres) | `supabase/migrations/` |
| AI (Claude) | Supabase Edge Functions; API key server par rehti hai | `supabase/functions/ai` |
| Email se queries | Gmail script → `inbound-query` function | `gmail/GmailToERP.gs` |
| Har subah ka report | `daily-report` function + schedule | `supabase/functions/daily-report` |
| Tests | Paisay aur roles ke qawaid ke tests | `supabase/tests/` |

## Is version mein kya hai

- **4 accounts:** Super-Admin (English), Abu (Arabic titles, English digits, Urdu awaaz), Engineer, aur Supervisor (Urdu, Arabic ya English).
- **Login:** email par 6-digit code aata hai, aur har baar app kholne par fingerprint ya Face ID.
- **Awaaz:** phone ka apna mic (Urdu ur-PK). App jo samjhi wo wapas bol kar sunati hai, phir "haan" dabane par hi save hota hai.
- **Har qadam par code ke checks.** Laal check save rok deta hai. Paisay ka hisaab (VAT 15%, service fee VAT ke baad wali raqam par, qarz ki katauti) **database khud karta hai**, isliye koi phone ise badal nahi sakta.
- **Receipt ki photo lazmi:** AI receipt parhta hai, phir project ka split aur VAT wali company chuni jati hai. Har kharidari ka VAT us company ke khaate mein jama hota hai, aur har item ki qeemat khud price list mein chali jati hai.
- **Progress:** supervisor bole "Abbas 40, Sohail 30, Uzair 50", to project, har subcontractor ka khaata aur engineer ka account, teeno update ho jaate hain. Supervisor ko rates aur paisa nahi dikhte.
- **Statements:** project, subcontractor, supplier, material aur VAT ki PDF. Pehle checks hote hain, phir phone ka share sheet khulta hai (WhatsApp 1, WhatsApp 2, email).
- **Email se queries:** AI har query **do alag models** se parhta hai, phir 6 gates chalte hain. Laal gate ho to quotation nahi banti.
- **Suppliers:** directory, AI har supplier ki zabaan mein rate maangne ka message likhta hai, aap WhatsApp ya email se khud bhejte hain, aur app jawab ka hisaab rakhti hai.
- **Quotations:** Abu ki quotation unke account mein live dikhti hai. Approve karne par project khud khul jata hai.
- **Query organizer:** email ki har query ki files (BOQ, drawing, spec, khat) alag alag chhant kar har ek ka khulasa likhta hai. Spec ke points aur drawing ki miqdar alag dikhti hai.
- **Drawing takeoff:** DXF drawing mein band shapes ka area har layer ke hisaab se m² mein nikalta hai aur BOQ se milata hai. 3% se zyada farq ho to consultant ke liye sawal ban jata hai. DWG ke liye client se PDF ya DXF maangein.
- **Supplier finder:** material aur sheher likhein, AI web par Saudi suppliers dhoondta hai (phone, WhatsApp, email, website, CR). Wo "approval ke liye" list mein aate hain, aap check karke approve karte hain.
- **Advisor:** quotation par "AI advice" dabayein. Wo aapki cost, aapke margin aur pichhli jeeti/haari quotations dekh kar har line ka rate aur wajah batata hai. Aap "Use" dabayein tabhi rate badalta hai.
- **Meri pasand (AI agents screen):** target margin, kam se kam margin, rate kis par round ho, quotation kitne din valid, payment terms. Advisor aur checks inhi par chalte hain.
- **Quotation PDF aur bhejna:** subtotal, VAT 15%, total, validity aur terms ke saath PDF. Cost se neeche koi line ho to PDF nahi banti. Phir WhatsApp 1, WhatsApp 2 ya email.
- **AI agents screen, har account ka apna assistant, subah 7 baje main agent ka report, audit log.**
- **Offline:** internet na ho to entry phone mein mehfooz rehti hai aur internet aane par khud upload ho jati hai.
- **Location:** sirf subah 6 se shaam 6 tak.

---

## Setup: qadam ba qadam (taqreeban 1–2 ghante, ek hi baar)

### 1. Supabase (database aur login)

1. https://supabase.com par account banayein, phir **New project** banayein. Region ke liye qareeb wala chunein, jaise **Middle East** ya **Frankfurt**.
2. **SQL Editor** mein ye files **is tarteeb se** chalayein:
   `supabase/migrations/0001_schema.sql` → `0002_rules.sql` → `0003_queries_suppliers_agents.sql`
3. **Authentication → Users → Add user** mein apna email daalein. Phir SQL Editor mein `supabase/first_admin.sql` chalayein (email apna likhein).
4. **Authentication → Email Templates → Magic Link** mein message ke andar `{{ .Token }}` daal dein, taake email mein 6-digit code jaye. Misal: `Your code: {{ .Token }}`
5. **Authentication → Providers → Email** mein "Allow new users to sign up" **band** kar dein. Is se koi bahar wala khud account nahi bana sakta.
6. **Project Settings → API** se `Project URL` aur `anon public` key copy kar lein.

### 2. AI ki key aur functions

1. https://console.anthropic.com par account banayein, billing set karein aur **API key** banayein.
2. Apne computer par Supabase CLI install karein, phir ye chalayein:
   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... INTAKE_SECRET=koi-lamba-password CRON_SECRET=doosra-lamba-password
   npx supabase functions deploy ai
   npx supabase functions deploy invite-user
   npx supabase functions deploy inbound-query --no-verify-jwt
   npx supabase functions deploy daily-report --no-verify-jwt
   ```
   Agar AI model ka naam badalna ho to `AI_MODEL` aur `AI_MODEL_STRONG` secrets set karein. Default `claude-sonnet-5-5` aur `claude-opus-5-5` hain.

### 3. Gmail se queries

1. RFQ wala Gmail khol kar https://script.google.com par **New project** banayein aur `gmail/GmailToERP.gs` paste karein.
2. Upar `ERP_URL` mein apna project ref likhein, aur `INTAKE_SECRET` wahi rakhein jo qadam 2 mein set kiya tha.
3. **setup** function ek baar chalayein aur ijazat dein.
4. Gmail mein ek **filter** banayein jo client queries ko label **RFQ** de. Misal: website form wali emails, ya jin mein "BOQ", "RFQ" ya "عرض سعر" likha ho.

Ab har 5 minute baad nayi queries apne Excel, PDF aur drawings ke saath app ke **Queries** tab mein aa jayengi.

### 4. Subah 7 baje ka report

Supabase → **Database → Extensions** mein `pg_cron` aur `pg_net` on karein. Phir `0003` file ke aakhir mein jo `cron.schedule(...)` wali lines comment mein hain, unme project ref aur `CRON_SECRET` bhar kar chalayein.

### 5. Phone app banana (GitHub Actions, Expo account ki zaroorat nahi)

1. `app/src/config.ts` mein `SUPABASE_URL` aur `SUPABASE_ANON_KEY` daalein (qadam 1.6 se).
2. GitHub par code push hote hi **Actions → Android APK** khud chalta hai (10–15 minute).
3. Mukammal hone par **Releases** mein `AL-Swati.apk` milti hai. Phone par link kholein, download karein, "Install" dabayein (pehli baar "Unknown apps ki ijazat" maangega).
4. Har nayi tabdeeli push karne par nayi APK ban jati hai. Purani app ke upar install karein, data mehfooz rehta hai.
5. **iPhone** ke liye Apple Developer account chahiye ($99 saal). Phir `.github/workflows/build-apps.yml` (EAS) se iPhone build TestFlight par jata hai: GitHub Secrets mein `EXPO_TOKEN` daal kar **Actions → Build apps → Run workflow**.
6. **Play Store** (ikhtiyari): Google Play account $25 ek baar. Background location ki wajah se Play Store ek form maangega. Wahan likhein: *"Supervisors ki site par mojoodgi sirf 06:00–18:00 company ko dikhti hai."*

### 6. Pehla login

App kholein, apna email daalein aur code se login karein. Phir **More → People** mein Abu, engineers aur supervisors ko unke email aur sites ke saath add karein. **More → Projects** mein company aur service fee bharein, **More → Suppliers** mein apne suppliers daalein.

---

## Demo ki tarah check karna (har release se pehle)

Asal data se chhote imtihaan karein jinke jawab aapko pehle se pata hain:

- [ ] **Paisa:** 115,000 aaye aur fee 3% ho to "In hand" mein 97,000 aana chahiye. 10 purani payments haath se bhi gin kar milayein.
- [ ] **Awaaz:** Abu 20 entries bolein, site ke shor mein bhi. Koi ghalat number "haan" ke baghair save nahi hona chahiye.
- [ ] **Receipt:** 10 asal invoices ki photo lein. Raqam, VAT aur supplier sahi parhe jayein, aur bina photo save na ho.
- [ ] **Supervisor:** uske phone par doosri site, rates ya paisa nazar na aaye.
- [ ] **Queries:** 3 purani queries dobara chalayein. AI ka breakdown aapki purani quotation se milayein.
- [ ] **Offline:** airplane mode mein entry karein, phir internet kholein. Entry pahunch jani chahiye.
- [ ] **PDF:** WhatsApp 1 aur WhatsApp 2 dono mein jaye, aur logo aur details sahi hon.

Database ke qawaid ka test: koi bhi developer `supabase/tests/01_rules_test.sql` chala sakta hai. Usme har "expect ERROR" wali line ka ERROR aana chahiye.

## Abhi kya baaqi hai

- **Company ka logo aur details:** `app/src/config.ts` mein `COMPANY` bharein (logo ko chhoti PNG data URI ki shakal mein).
- **ZATCA e-invoicing:** accountant ki company karti hai, app sirf record rakhti hai.
- **Vendor calling bot (Vapi / Retell), weather alert, fuel auditor:** agla marhala.
- **CR check:** abhi supplier ka CR haath se check hota hai (✓ ka nishan). Wathq API ka contract milne par ye khud ho jayega.
- **Mukhtalif Gmail accounts:** har Gmail par wahi script lagayein.

Kharcha: Supabase free se shuru hota hai, lekin asal kaam ke liye Pro plan lein, kyunki free project kuch din istemaal na ho to ruk jata hai. Claude API ka bill istemaal ke hisaab se aata hai, is liye console.anthropic.com par mahine ki limit set kar dein. Expo build ka free tier hai. Apple $99 saal, Google Play $25 ek baar.
