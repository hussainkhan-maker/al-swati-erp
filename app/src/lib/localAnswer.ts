// Zero-token answers: common money / m² questions are answered straight from the numbers the app already has.
// The AI is only called when the question is not one of these (saves tokens and is always exact).
import { money, norm } from "./fmt";

const has = (q: string, re: RegExp) => re.test(q);
const RX = {
  m2: /\bm2\b|m²|sqm|meter|metre|میٹر|مربع|متر|\bkaam\b|کام|done|installed|تركيب|انجاز/,
  cost: /kharch|خرچ|expense|cost|spent|مصروف|مصاريف|صرف|تكلف/,
  profit: /profit|munaf|منافع|ربح|faida|فائد/,
  received: /receiv|\baaya|\baa?ye\b|وصول|استلم|income|آیا|آئے|دخل/,
  owe: /owe|dena|dene|pes[ea]|paise|دینے|دینا|baqi|باقی|balance|\bdue\b|مستحق|متبقي|باقي|lena|لینا|پیسے/,
  vat: /\bvat\b|ضريبة|ضريبه|tax|ٹیکس/,
  all: /\ball\b|total|\bsab\b|سب|کل|جميع|اجمالي|مجموع/,
};

/** Returns a ready answer, or null when the question needs the AI. */
export function localAnswer(d: any, question: string, lang: string): { text: string; project?: any } | null {
  const q = norm(question);
  const W = (en: string, ar: string, ur: string) => (lang === "ar" ? ar : lang === "ur" ? ur : en);
  const L = (d.project_ledger || []) as any[], S = (d.sub_ledger || []) as any[];
  if (!L.length && !S.length) return null; // this role does not hold money data
  const words = (n: string) => norm(n).split(/\s+/).filter((w) => w.length >= 4);
  const proj = L.find((p) => q.includes(norm(p.name))) || L.find((p) => { const w = words(p.name); return w.length && w.every((x) => q.includes(x)); }) || L.find((p) => words(p.name).some((x) => x.length >= 5 && q.includes(x)));
  const sub = S.find((s) => s.name && norm(s.name).length >= 3 && new RegExp(`(^|\\s)${norm(s.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(q));
  const SAR = (n: any) => `${money(Number(n) || 0)} SAR`;

  if (sub && (has(q, RX.owe) || has(q, RX.m2) || /paid|diye|دیے|دفع|kitna|کتنا|كم/.test(q))) {
    const due = Number(sub.earned) - Number(sub.paid);
    return { text: W(`${sub.name}: ${money(sub.qty)} m² done, earned ${SAR(sub.earned)}, paid ${SAR(sub.paid)}, still to pay ${SAR(due)}.`,
      `${sub.name}: أنجز ${money(sub.qty)} م²، استحق ${SAR(sub.earned)}، دُفع له ${SAR(sub.paid)}، الباقي له ${SAR(due)}.`,
      `${sub.name}: ${money(sub.qty)} مربع میٹر کام، بنے ${SAR(sub.earned)}، دیے ${SAR(sub.paid)}، باقی دینے ہیں ${SAR(due)}۔`) };
  }
  const one = (p: any) => {
    if (has(q, RX.m2)) return W(`${p.name}: ${money(p.installed)} m² done.`, `${p.name}: تم تركيب ${money(p.installed)} م².`, `${p.name}: ${money(p.installed)} مربع میٹر کام ہو چکا۔`);
    if (has(q, RX.profit)) return W(`${p.name}: profit estimate ${SAR(p.profit)}.`, `${p.name}: الربح التقديري ${SAR(p.profit)}.`, `${p.name}: اندازاً منافع ${SAR(p.profit)}۔`);
    if (has(q, RX.cost)) return W(`${p.name}: costs ${SAR(p.cost)} (before VAT), subcontractors paid ${SAR(p.sub_paid)}.`, `${p.name}: المصاريف ${SAR(p.cost)} (قبل الضريبة)، ودُفع للمقاولين ${SAR(p.sub_paid)}.`, `${p.name}: خرچہ ${SAR(p.cost)} (VAT کے بغیر)، سب کنٹریکٹرز کو دیے ${SAR(p.sub_paid)}۔`);
    if (has(q, RX.received)) return W(`${p.name}: received from the client ${SAR(p.gross)}, in hand after fee ${SAR(p.net)}.`, `${p.name}: استلمنا من العميل ${SAR(p.gross)}، الصافي ${SAR(p.net)}.`, `${p.name}: کلائنٹ سے آئے ${SAR(p.gross)}، فیس کے بعد ہاتھ میں ${SAR(p.net)}۔`);
    if (has(q, RX.owe)) return W(`${p.name}: subcontractors are still owed ${SAR(p.sub_due)}.`, `${p.name}: الباقي للمقاولين ${SAR(p.sub_due)}.`, `${p.name}: سب کنٹریکٹرز کے ابھی ${SAR(p.sub_due)} باقی ہیں۔`);
    return null;
  };
  if (proj) { const t = one(proj); return t ? { text: t, project: proj } : null; }
  if (has(q, RX.vat) && (d.vat_by_company || []).length) {
    const v = d.vat_by_company as any[];
    return { text: W("VAT to recover: ", "الضريبة المستردة: ", "واپس لینے والا VAT: ") + v.map((x) => `${x.company}: ${SAR(x.vat)}`).join(" · ") };
  }
  if (has(q, RX.all)) {
    const sum = (k: string) => L.reduce((s, p) => s + (Number(p[k]) || 0), 0);
    if (has(q, RX.m2)) return { text: W(`All projects: ${money(sum("installed"))} m² done.`, `كل المشاريع: ${money(sum("installed"))} م².`, `تمام پروجیکٹس: ${money(sum("installed"))} مربع میٹر۔`) };
    if (has(q, RX.cost)) return { text: W(`All projects: costs ${SAR(sum("cost"))}.`, `كل المشاريع: المصاريف ${SAR(sum("cost"))}.`, `تمام پروجیکٹس: خرچہ ${SAR(sum("cost"))}۔`) };
    if (has(q, RX.profit)) return { text: W(`All projects: profit estimate ${SAR(sum("profit"))}.`, `كل المشاريع: الربح ${SAR(sum("profit"))}.`, `تمام پروجیکٹس: منافع ${SAR(sum("profit"))}۔`) };
    if (has(q, RX.owe)) return { text: W(`All projects: subcontractors still owed ${SAR(sum("sub_due"))}.`, `كل المشاريع: الباقي للمقاولين ${SAR(sum("sub_due"))}.`, `تمام پروجیکٹس: سب کنٹریکٹرز کے باقی ${SAR(sum("sub_due"))}۔`) };
  }
  return null;
}

/** Project the question is about (to send the AI only that project's entries). */
export function mentionedProject(d: any, question: string) {
  const q = norm(question);
  return (d.projects || []).find((p: any) => q.includes(norm(p.name))) || null;
}
