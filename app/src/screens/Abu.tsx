// Abu's account: Arabic titles by default (Urdu or English if he chooses), English digits always,
// everything by Urdu voice, confirmed before saving.
import React from "react";
import { View } from "react-native";
import * as Speech from "expo-speech";
import { useFlows } from "../components/Flows";
import { active, pname, useData } from "../lib/data";
import { day, money, SAR } from "../lib/fmt";
import { Lang } from "../lib/i18n";
import { Btn, Card, Empty, H1, H2, Icon, Kpi, Photo, Pill, Row, Screen, T, Tile, useColors } from "../ui";

/** Pick the words for Abu's chosen language: Arabic, Urdu or English. */
export function useAbuWords() {
  const { lang } = useData();
  return (ar: string, ur: string, en: string) => (lang === "ur" ? ur : lang === "en" ? en : ar);
}

/** Three big buttons to switch the whole account's language. Digits stay English in every language. */
export function LanguageSwitch() {
  const { lang, setLang } = useData();
  const opts: [Lang, string][] = [["ar", "العربية"], ["ur", "اردو"], ["en", "English"]];
  return (
    <Row>
      {opts.map(([k, label]) => <Btn key={k} title={label} kind={lang === k ? "primary" : "default"} onPress={() => setLang(k)} style={{ flex: 1 }} />)}
    </Row>
  );
}

export function Home({ go }: { go: (k: string) => void }) {
  const { d, profile, lang } = useData(); const flows = useFlows(); const W = useAbuWords();
  const month = new Date().toISOString().slice(0, 7);
  const spent = active(d.txns).filter((x: any) => ["purchase", "expense"].includes(x.type) && String(x.created_at).startsWith(month)).reduce((s: number, x: any) => s + Number(x.total ?? x.amount ?? 0), 0);
  const vat = (d.vat_by_company || []).reduce((s: number, x: any) => s + Number(x.vat), 0);
  const review = (d.quotes || []).filter((q: any) => q.owner === "abu" && q.status === "Abu Review").length;
  return (
    <Screen>
      <H1>{W("مرحباً", "السلام علیکم", "Hello")} {profile.name}</H1>
      <LanguageSwitch />
      <Kpi hero label={W("مصروفات هذا الشهر", "اس مہینے کے خرچے", "Spent this month")} value={SAR(spent)} />
      <Btn big kind="primary" icon={<Icon name="mic" color="#fff" />} title={W("🔊 استمع لتقرير اليوم", "🔊 آج کی رپورٹ سنیں", "🔊 Listen to today's report")} onPress={() => {
        // Made by the app from the numbers (no AI, no cost) and read aloud in Abu's language.
        const today = new Date().toISOString().slice(0, 10), week = Date.now() - 7 * 864e5;
        const t = active(d.txns).filter((x: any) => String(x.created_at).startsWith(today));
        const sum = (types: string[]) => Math.round(t.filter((x: any) => types.includes(x.type)).reduce((s: number, x: any) => s + Number(x.total ?? x.amount ?? x.gross ?? 0), 0));
        const m2 = Math.round(active(d.progress || []).filter((p: any) => Date.parse(p.created_at) > week).reduce((s: number, p: any) => s + Number(p.qty || p.sqm || 0), 0));
        const parts = [
          W(`اليوم دخل ${sum(["income"])} ريال، وصرفنا ${sum(["purchase", "expense", "subpay"])} ريال.`, `آج ${sum(["income"])} ریال آئے، اور ${sum(["purchase", "expense", "subpay"])} ریال خرچ ہوئے۔`, `Today ${sum(["income"])} riyals came in and ${sum(["purchase", "expense", "subpay"])} riyals went out.`),
          W(`مصروفات هذا الشهر ${Math.round(spent)} ريال.`, `اس مہینے کا خرچہ ${Math.round(spent)} ریال ہے۔`, `This month's spending is ${Math.round(spent)} riyals.`),
          W(`هذا الأسبوع تم تركيب ${m2} متر مربع.`, `اس ہفتے ${m2} مربع میٹر کام ہوا۔`, `This week ${m2} square meters were installed.`),
          review ? W(`لديك ${review} عرض سعر للمراجعة.`, `آپ کے پاس ${review} کوٹیشن دیکھنے کے لیے ہیں۔`, `You have ${review} quotations to review.`) : "",
        ].filter(Boolean).join(" ");
        Speech.stop(); Speech.speak(parts, { language: lang === "ar" ? "ar-SA" : lang === "en" ? "en-US" : "ur-PK", rate: 0.9 });
      }} />
      <Tile accent icon="mic" title={W("اضغط وتكلم", "دبائیں اور بولیں", "Tap and speak")} sub={W("تكلم بالأردو · سأتأكد معك قبل الحفظ", "اردو میں بولیں · محفوظ کرنے سے پہلے میں پوچھوں گا", "Speak in Urdu · I confirm before saving")} onPress={() => flows("speak")} />
      <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 12 }}>
        <Tile icon="receipt" title={W("فاتورة شراء", "خریداری کی رسید", "Purchase invoice")} sub={W("صورة + مشروع + ضريبة", "تصویر + پروجیکٹ + VAT", "Photo + project + VAT")} onPress={() => flows("purchase")} />
        <Tile icon="doc" title={W("طلب مواد", "میٹیریل ریکویزیشن", "Material request")} sub="PDF" onPress={() => flows("speak", { text: "میٹیریل ریکویزیشن: " })} />
        <Tile icon="log" title={W("كشف حساب", "حساب", "Statement")} sub={W("مشروع · مقاول · مورد", "پروجیکٹ · سب کنٹریکٹر · سپلائر", "Project · subcontractor · supplier")} onPress={() => flows("statement")} />
        <Tile icon="pct" title={W("ضريبة مستردة", "واپس لینے والا VAT", "VAT to recover")} sub={SAR(vat)} onPress={() => go("vat")} />
        <Tile icon="spark" title={W("اسأل مساعدك", "مددگار سے پوچھیں", "Ask your assistant")} sub={W("عن أي مشروع أو حساب", "کسی بھی پروجیکٹ یا حساب کے بارے میں", "About any project or account")} onPress={() => flows("ask")} />
        <Tile icon="truck" title={W("الموردون", "سپلائرز", "Suppliers")} sub={W("اطلب أسعار", "ریٹ منگوائیں", "Ask for prices")} onPress={() => go("suppliers")} />
      </View>
      {review > 0 && <Card onPress={() => go("quotes")}><Row><T bold style={{ flex: 1 }}>{W("عروض الأسعار", "کوٹیشنز", "Quotations")}</T><Pill kind="warn" text={`${review} ${W("للمراجعة", "دیکھنے کے لیے", "to review")}`} /></Row></Card>}
      <Card>
        <T bold>{W("كيف أستعمل التطبيق؟", "ایپ کیسے چلائیں؟", "How to use the app")}</T>
        <T>1. {W("اضغط الزر الأخضر الكبير وتكلم بالأردو كما تتكلم مع الناس.", "بڑا سبز بٹن دبائیں اور اردو میں ویسے ہی بولیں جیسے لوگوں سے بات کرتے ہیں۔", "Press the big green button and speak in Urdu, the way you talk to people.")}</T>
        <T>2. {W("اضغط «افهم». سأقرأ لك ما فهمت بصوت.", "«سمجھو» دبائیں۔ میں سنا دوں گا کہ میں نے کیا سمجھا۔", "Press “Understand”. I read back what I understood.")}</T>
        <T>3. {W("إذا كان صحيحاً اضغط «نعم، احفظ». إذا لا، تكلم مرة أخرى.", "صحیح ہو تو «ہاں، محفوظ کریں»۔ غلط ہو تو دوبارہ بولیں۔", "If it is right, press “Yes, save”. If not, speak again.")}</T>
        <T>4. {W("للفاتورة: صوّر الفاتورة، اختر المشروع، واختر الشركة التي دُفعت الضريبة باسمها.", "رسید کے لیے: تصویر لیں، پروجیکٹ چنیں، اور وہ کمپنی چنیں جس کے نام پر VAT دیا۔", "For an invoice: take the photo, pick the project, and pick the company the VAT was paid under.")}</T>
      </Card>
      <H2>{W("المشاريع", "پروجیکٹس", "Projects")}</H2>
      {(d.project_ledger || []).map((l: any) => (
        <Card key={l.project_id} onPress={() => flows("statement", { kind: "project", target: l.name })}>
          <Row><View style={{ flex: 1 }}><T bold>{l.name}</T><T muted size={13}>{l.company || ""}</T></View><T bold>{SAR(Number(l.cost) + Number(l.sub_paid))}</T></Row>
        </Card>))}
    </Screen>
  );
}

export function Money() {
  const { d } = useData(); const flows = useFlows(); const c = useColors(); const W = useAbuWords();
  const TYPE: Record<string, string> = { income: W("دفعة", "وصولی", "Income"), loan: W("قرض", "قرض", "Loan"), purchase: W("شراء", "خریداری", "Purchase"), expense: W("مصروف", "خرچہ", "Expense"), subpay: W("دفعة مقاول", "سب کنٹریکٹر ادائیگی", "Sub payment") };
  return (
    <Screen>
      <H1>{W("الحسابات", "حسابات", "Accounts")}</H1>
      <Row wrap>
        <Btn big kind="primary" icon={<Icon name="mic" color={c.accentInk} />} title={W("تكلم", "بولیں", "Speak")} onPress={() => flows("speak")} style={{ flex: 1 }} />
        <Btn big icon={<Icon name="receipt" />} title={W("فاتورة", "رسید", "Invoice")} onPress={() => flows("purchase")} style={{ flex: 1 }} />
      </Row>
      <T muted>{W("قل مثلاً:", "مثلاً بولیں:", "For example:")} «ملقا کے لیے کمپنی سے 115000 آئے» · «عزیر کو 2000 دیے» · «نرجس کے لیے 50000 قرض لیا»</T>
      {(d.txns || []).length ? d.txns.map((x: any) => (
        <Card key={x.id} style={x.status === "cancelled" ? { opacity: 0.5 } : undefined}>
          <Row>
            {x.receipt_path ? <Photo path={x.receipt_path} /> : null}
            <View style={{ flex: 1, gap: 2 }}>
              <Row wrap><Pill kind={x.type === "income" ? "good" : x.type === "loan" ? "acc" : "plain"} text={TYPE[x.type]} />{x.status === "cancelled" && <Pill kind="bad" text={W("ملغى", "منسوخ", "Cancelled")} />}</Row>
              <T bold>{(x.split || []).length > 1 ? x.split.map((s: any) => `${pname(d, s.project_id)} ${s.pct}%`).join(" · ") : pname(d, x.project_id)}</T>
              <T muted size={13}>{[x.supplier, x.description, x.sub_name, x.vat_company && `VAT → ${x.vat_company}`].filter(Boolean).join(" · ")} · {day(x.created_at)}</T>
              {x.type === "income" && <T size={13} muted>VAT {money(x.vat)} · {W("رسوم", "فیس", "fee")} {money(x.fee)} → {W("الصافي", "ہاتھ میں", "in hand")} {money(x.net)}</T>}
            </View>
            <T bold>{money(x.gross ?? x.total ?? x.amount)}</T>
          </Row>
        </Card>)) : <Empty text={W("لا توجد قيود بعد. اضغط «تكلم».", "ابھی کوئی اندراج نہیں۔ «بولیں» دبائیں۔", "No entries yet. Press “Speak”.")} />}
    </Screen>
  );
}

export function Vat() {
  const { d } = useData(); const flows = useFlows(); const c = useColors(); const W = useAbuWords();
  const g = d.vat_by_company || [], tot = g.reduce((s: number, x: any) => s + Number(x.vat), 0);
  const rows = active(d.txns).filter((x: any) => x.type === "purchase" && Number(x.vat_amount) > 0);
  return (
    <Screen>
      <H1>{W("ضريبة مستردة", "واپس لینے والا VAT", "VAT to recover")}</H1>
      <Kpi hero label={W("إجمالي الضريبة المدفوعة لنستردها", "خریداری پر دیا گیا کل VAT", "Total VAT paid on purchases")} value={SAR(tot)} />
      {g.length ? g.map((x: any) => <Card key={x.company}><Row><View style={{ flex: 1 }}><T bold>{x.company}</T><T muted size={13}>{x.invoices} {W("فاتورة", "رسیدیں", "invoices")}</T></View><T bold>{SAR(x.vat)}</T></Row></Card>)
        : <Empty text={W("لا توجد ضريبة بعد. عند كل فاتورة سأسألك: هل دفعت ضريبة؟ باسم أي شركة؟", "ابھی کوئی VAT نہیں۔ ہر رسید پر میں پوچھوں گا: VAT دیا؟ کس کمپنی کے نام؟", "No VAT yet. On every invoice I will ask: did you pay VAT, and under which company?")} />}
      <H2>{W("الفواتير", "رسیدیں", "Invoices")}</H2>
      {rows.slice(0, 50).map((x: any) => <Card key={x.id}><Row><Photo path={x.receipt_path} /><View style={{ flex: 1 }}><T bold>{x.supplier || "—"}</T><T muted size={13}>{x.vat_company} · {day(x.created_at)}</T></View><T bold>{money(x.vat_amount)}</T></Row></Card>)}
      <Btn big kind="primary" icon={<Icon name="share" color={c.accentInk} />} title={W("كشف PDF للضريبة", "VAT کی PDF", "VAT statement PDF")} onPress={() => flows("statement", { kind: "vat" })} />
    </Screen>
  );
}
