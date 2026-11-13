// Statements → checked PDF → the phone's own share sheet (WhatsApp 1, WhatsApp 2, email…).
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { COMPANY } from "../config";
import { Check } from "./checks";
import { active, pname } from "./data";
import { ARABIC_DIGITS, day, money, norm, num, r2, stamp } from "./fmt";
import { Lang } from "./i18n";

export type Doc = { title: string; cols: string[]; rows: any[][]; sum: [string, string][]; numCols: number[]; check?: { col: number; total: number } };
const esc = (v: any) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function buildStatement(d: Record<string, any[]>, role: string, lang: Lang, kind: string, target: string, projectId = ""): Doc | null {
  const H = (en: string, ar: string, ur: string) => (lang === "ar" ? ar : lang === "ur" ? ur : en);
  // Optional: only one project. Dates: the day it was paid / worked, else the day it was entered.
  const inP = (x: any) => !projectId || x.project_id === projectId || (x.split || []).some((q: any) => q.project_id === projectId);
  const dd = (x: any) => String(x.paid_on || x.work_date || "").slice(0, 10) || day(x.created_at);
  const txns = active(d.txns).filter(inP), prog = active(d.progress).filter(inP);
  const pTitle = projectId ? " · " + pname(d, projectId) : "";
  if (kind === "received") {
    // Every payment received from clients: when, how, gross, VAT, fee, loan deducted, in hand.
    const list = txns.filter((x) => x.type === "income").sort((a, b) => (dd(a) < dd(b) ? -1 : 1));
    const rows = list.map((x) => [dd(x), pname(d, x.project_id), [x.method, x.description].filter(Boolean).join(" · "), Number(x.gross) || 0, Number(x.vat) || 0, Number(x.fee) || 0, Number(x.loan) || 0, Number(x.net) || 0]);
    const S = (i: number) => r2(rows.reduce((s2, rr) => s2 + (rr[i] as number), 0));
    return { title: H("Payments received", "الدفعات المستلمة", "آئی ہوئی ادائیگیاں") + pTitle, cols: [H("Date", "التاريخ", "تاریخ"), H("Project", "المشروع", "پروجیکٹ"), H("How / note", "الطريقة", "طریقہ / نوٹ"), H("Received", "المستلم", "وصولی"), "VAT", H("Fee", "الرسوم", "فیس"), H("Loan cut", "خصم القرض", "قرض کٹوتی"), H("In hand", "الصافي", "ہاتھ میں")], rows, numCols: [3, 4, 5, 6, 7],
      sum: [[H("Times paid", "عدد الدفعات", "کتنی دفعہ"), String(rows.length)], [H("Received", "المستلم", "کل وصولی"), money(S(3))], [H("In hand", "الصافي", "ہاتھ میں"), money(S(7))]], check: { col: 7, total: S(7) } };
  }
  if (kind === "expenses" || kind === "purchases") {
    const small = kind === "expenses";
    const list = txns.filter((x) => x.type === (small ? "expense" : "purchase")).sort((a, b) => (dd(a) < dd(b) ? -1 : 1));
    const rows = small
      ? list.map((x) => [dd(x), pname(d, x.project_id), x.description || "", x.method || "", Number(x.amount) || 0])
      : list.map((x) => [dd(x), pname(d, x.project_id), x.supplier || "", x.invoice_no || "", x.vat_company || "", Number(x.vat_amount) || 0, Number(x.total) || 0]);
    const tc = small ? 4 : 6, tot = r2(rows.reduce((s2, rr) => s2 + (rr[tc] as number), 0));
    return small
      ? { title: H("Small expenses", "المصروفات الصغيرة", "چھوٹے خرچے") + pTitle, cols: [H("Date", "التاريخ", "تاریخ"), H("Project", "المشروع", "پروجیکٹ"), H("For", "البيان", "کس لیے"), H("Paid by", "طريقة الدفع", "طریقہ"), H("Amount", "المبلغ", "رقم")], rows, numCols: [4], sum: [[H("Total", "الإجمالي", "کل"), money(tot)]], check: { col: 4, total: tot } }
      : { title: H("Material purchases", "مشتريات المواد", "میٹیریل کی خریداری") + pTitle, cols: [H("Date", "التاريخ", "تاریخ"), H("Project", "المشروع", "پروجیکٹ"), H("Supplier", "المورد", "سپلائر"), H("Invoice", "الفاتورة", "انوائس"), H("VAT company", "شركة الضريبة", "VAT کمپنی"), H("VAT", "الضريبة", "VAT"), H("Total", "الإجمالي", "کل")], rows, numCols: [5, 6],
          sum: [[H("VAT", "الضريبة", "VAT"), money(r2(rows.reduce((s2, rr) => s2 + (rr[5] as number), 0)))], [H("Total", "الإجمالي", "کل"), money(tot)]], check: { col: 6, total: tot } };
  }
  if (kind === "sub") {
    const name = (d.sub_names || (d.subcontractors || []).map((s: any) => s.name)).find((s: string) => norm(s).includes(norm(target)) || norm(target).includes(norm(s))) || target;
    const pr = prog.filter((p) => norm(p.sub_name) === norm(name));
    if (role === "supervisor") {
      const rows = pr.map((p) => [day(p.created_at), pname(d, p.project_id), p.work || "", Number(p.qty)]);
      const tot = r2(rows.reduce((s, r) => s + (r[3] as number), 0));
      return { title: H("Subcontractor work", "عمل المقاول", "سب کنٹریکٹر کا کام") + " · " + name, cols: [H("Date", "التاريخ", "تاریخ"), H("Project", "المشروع", "پروجیکٹ"), H("Work", "العمل", "کام"), H("Qty", "الكمية", "مقدار")], rows, sum: [[H("Total work", "مجموع العمل", "کل کام"), money(tot)]], numCols: [3], check: { col: 3, total: tot } };
    }
    const pays = txns.filter((x) => x.type === "subpay" && norm(x.sub_name) === norm(name));
    // Work lines (m² × rate) and payment lines (date, how paid, note) in date order.
    const rows: any[][] = [
      ...pr.map((p) => { const rt = Number(p.rate) || 0; return [dd(p), pname(d, p.project_id), H("Work", "عمل", "کام") + (p.work ? " · " + p.work : ""), Number(p.qty), rt, r2(Number(p.qty) * rt), 0]; }),
      ...pays.map((x) => [dd(x), pname(d, x.project_id), H("Payment", "دفعة", "ادائیگی") + [x.method, x.description].filter(Boolean).map((v) => " · " + v).join(""), 0, 0, 0, Number(x.amount) || 0]),
    ].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const work = r2(rows.reduce((s, r) => s + (r[5] as number), 0)), paid = r2(rows.reduce((s, r) => s + (r[6] as number), 0)), qty = r2(rows.reduce((s, r) => s + (r[3] as number), 0));
    return { title: H("Subcontractor statement", "كشف حساب مقاول باطن", "سب کنٹریکٹر کا حساب") + " · " + name + pTitle,
      cols: [H("Date", "التاريخ", "تاریخ"), H("Project", "المشروع", "پروجیکٹ"), H("Work / payment", "العمل / الدفعة", "کام / ادائیگی"), "m²", H("Rate", "السعر", "ریٹ"), H("Earned", "المستحق", "کمائی"), H("Paid", "مدفوع", "ادا")], rows, numCols: [3, 4, 5, 6],
      sum: [[H("Total m²", "مجموع المتر", "کل m²"), money(qty)], [H("Earned", "المستحق", "کمائی"), money(work)], [H("Paid", "مدفوع", "ادا"), money(paid)], [H("Balance", "المتبقي", "باقی"), money(r2(work - paid))]], check: { col: 5, total: work } };
  }
  if (kind === "vat") {
    const rows = txns.filter((x) => x.type === "purchase" && Number(x.vat_amount) > 0).map((x) => [day(x.created_at), x.vat_company, x.supplier || "", Number(x.total), Number(x.vat_amount)]);
    const tot = r2(rows.reduce((s, r) => s + (r[4] as number), 0));
    return { title: H("Purchase VAT to recover", "ضريبة المشتريات المستردة", "واپس لینے والا VAT"), cols: [H("Date", "التاريخ", "تاریخ"), H("Company", "الشركة", "کمپنی"), H("Supplier", "المورد", "سپلائر"), H("Invoice", "الفاتورة", "رسید"), H("VAT", "الضريبة", "VAT")], rows, numCols: [3, 4],
      sum: [...(d.vat_by_company || []).map((c: any) => [c.company, money(c.vat)] as [string, string]), [H("Total", "الإجمالي", "کل"), money(tot)]], check: { col: 4, total: tot } };
  }
  if (kind === "supplier") {
    const rows = txns.filter((x) => x.type === "purchase" && norm(x.supplier).includes(norm(target))).map((x) => [day(x.created_at), pname(d, x.project_id), (x.lines || []).map((l: any) => l.name).join(", "), Number(x.vat_amount) || 0, Number(x.total)]);
    const tot = r2(rows.reduce((s, r) => s + (r[4] as number), 0));
    return { title: H("Supplier statement", "كشف حساب مورد", "سپلائر کا حساب") + " · " + target, cols: [H("Date", "التاريخ", "تاریخ"), H("Project", "المشروع", "پروجیکٹ"), H("Items", "البنود", "آئٹمز"), H("VAT", "الضريبة", "VAT"), H("Total", "الإجمالي", "کل")], rows, numCols: [3, 4], sum: [[H("Total purchases", "مجموع المشتريات", "کل خریداری"), money(tot)]], check: { col: 4, total: tot } };
  }
  if (kind === "material") {
    const rows: any[][] = [];
    txns.filter((x) => x.type === "purchase").forEach((x) => (x.lines || []).filter((l: any) => norm(l.name).includes(norm(target))).forEach((l: any) => rows.push([day(x.created_at), pname(d, x.project_id), x.supplier || "", l.name, Number(l.qty) || 0, Number(l.total) || 0])));
    const tot = r2(rows.reduce((s, r) => s + r[5], 0));
    return { title: H("Material statement", "كشف المواد", "میٹیریل کا حساب") + " · " + target, cols: [H("Date", "التاريخ", "تاریخ"), H("Project", "المشروع", "پروجیکٹ"), H("Supplier", "المورد", "سپلائر"), H("Item", "المادة", "آئٹم"), H("Qty", "الكمية", "مقدار"), H("Total", "الإجمالي", "کل")], rows, numCols: [4, 5], sum: [[H("Total", "الإجمالي", "کل"), money(tot)]], check: { col: 5, total: tot } };
  }
  // project
  const P = (d.projects || []).find((p) => p.id === target) || (target ? (d.projects || []).find((p) => norm(p.name).includes(norm(target))) : null);
  if (!P) return null;
  if (role === "supervisor") {
    const rows = prog.filter((x) => x.project_id === P.id).map((x) => [day(x.created_at), x.sub_name, x.work || "", Number(x.qty)]);
    const tot = r2(rows.reduce((s, r) => s + (r[3] as number), 0));
    return { title: H("Installation", "التركيب", "انسٹالیشن") + " · " + P.name, cols: ["تاریخ", "سب کنٹریکٹر", "کام", "مقدار"], rows, numCols: [3], sum: [["کل انسٹالیشن", money(tot)]], check: { col: 3, total: tot } };
  }
  const L = (d.project_ledger || []).find((l: any) => l.project_id === P.id) || {};
  const TL: Record<string, string> = { income: H("Payment in (in hand)", "دفعة (صافي)", "وصولی"), loan: H("Loan from company", "قرض من الشركة", "قرض"), purchase: H("Purchase (ex VAT)", "مشتريات بدون ضريبة", "خریداری"), expense: H("Expense", "مصروف", "خرچہ"), subpay: H("Subcontractor payment", "دفعة مقاول", "سب کنٹریکٹر ادائیگی") };
  const rows: any[][] = [];
  txns.forEach((x) => {
    const sh = (x.split || []).length ? ((x.split.find((s: any) => s.project_id === P.id)?.pct || 0) / 100) : x.project_id === P.id ? 1 : 0;
    if (!sh) return;
    const amt = x.type === "income" ? Number(x.net) : x.type === "purchase" ? Number(x.total) - Number(x.vat_amount || 0) : Number(x.amount);
    rows.push([dd(x), TL[x.type], x.description || x.supplier || x.sub_name || x.company || "", r2((["purchase", "expense", "subpay"].includes(x.type) ? -1 : 1) * amt * sh)]);
  });
  rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const tot = r2(rows.reduce((s, r) => s + r[3], 0));
  return { title: H("Project statement", "كشف حساب مشروع", "پروجیکٹ کا حساب") + " · " + P.name, cols: [H("Date", "التاريخ", "تاریخ"), H("Entry", "البند", "اندراج"), H("Details", "التفاصيل", "تفصیل"), H("Amount", "المبلغ", "رقم")], rows, numCols: [3],
    sum: [...projectWork(d, P.id, H), [H("Received (gross)", "المستلم", "کل وصولی"), money(L.gross)], [H("VAT", "الضريبة", "VAT"), money(L.vat)], [H("Service fee", "رسوم الخدمة", "سروس فیس"), money(L.fee)], [H("Loan balance", "رصيد القرض", "قرض باقی"), money(L.loan_balance)], [H("Subcontract work", "عمل المقاولين", "سب کنٹریکٹ کام"), money(L.sub_work)], [H("Net cash movement", "صافي الحركة", "خالص"), money(tot)], [H("Profit (estimate)", "الربح التقديري", "منافع (اندازہ)"), money(L.profit)]],
    check: { col: 3, total: tot } };
}

/** Work on one project: total m² of all subcontractors, then each one's m², earned (m² × rate) and paid. */
function projectWork(d: Record<string, any[]>, pid: string, H: (en: string, ar: string, ur: string) => string): [string, string][] {
  const pr = active(d.progress).filter((p) => p.project_id === pid), pays = active(d.txns).filter((x) => x.type === "subpay" && x.project_id === pid);
  const names = Array.from(new Set([...pr.map((p) => p.sub_name), ...pays.map((x) => x.sub_name)].filter(Boolean)));
  const out: [string, string][] = [[H("Total m² done (all subcontractors)", "مجموع المتر المنفذ", "کل m² (سب سب کنٹریکٹر)"), money(r2(pr.reduce((s, p) => s + Number(p.qty || 0), 0)))]];
  names.forEach((n) => {
    const mine = pr.filter((p) => norm(p.sub_name) === norm(n));
    const m2 = r2(mine.reduce((s, p) => s + Number(p.qty || 0), 0)), earned = r2(mine.reduce((s, p) => s + Number(p.qty || 0) * Number(p.rate || 0), 0));
    const paid = r2(pays.filter((x) => norm(x.sub_name) === norm(n)).reduce((s, x) => s + Number(x.amount || 0), 0));
    out.push([n, `${money(m2)} m² · ${H("earned", "مستحق", "کمائی")} ${money(earned)} · ${H("paid", "مدفوع", "ادا")} ${money(paid)} · ${H("balance", "متبقي", "باقی")} ${money(r2(earned - paid))}`]);
  });
  return out;
}

/** Quotation as a document: lines, subtotal, VAT 15%, total, validity and terms. */
export function quotationDoc(q: any, lang: Lang, terms: any = {}): Doc {
  const H = (en: string, ar: string, ur: string) => (lang === "ar" ? ar : lang === "ur" ? ur : en);
  const rows = (q.lines || []).map((l: any, i: number) => [String(i + 1), l.desc, Number(l.qty) || 0, l.unit || "", Number(l.rate) || 0, r2((Number(l.qty) || 0) * (Number(l.rate) || 0))]);
  const sub = r2(rows.reduce((s: number, r: any[]) => s + r[5], 0)), vat = r2(sub * 0.15);
  return {
    title: H("Quotation", "عرض سعر", "کوٹیشن") + " · " + q.title + (q.client ? " · " + q.client : ""),
    cols: ["#", H("Description", "الوصف", "تفصیل"), H("Qty", "الكمية", "مقدار"), H("Unit", "الوحدة", "یونٹ"), H("Rate (SAR)", "السعر", "ریٹ"), H("Amount (SAR)", "المبلغ", "رقم")],
    rows, numCols: [2, 4, 5],
    sum: [[H("Subtotal", "المجموع", "میزان"), money(sub)], [H("VAT 15%", "ضريبة 15%", "VAT 15%"), money(vat)], [H("Total", "الإجمالي", "کل"), money(r2(sub + vat))],
      [H("Valid for", "صالح لمدة", "مدت"), `${terms.validity_days ?? 15} ${H("days", "يوم", "دن")}`], [H("Payment", "الدفع", "ادائیگی"), terms.payment ?? ""], ...(terms.guarantee ? [[H("Guarantee", "الضمان", "گارنٹی"), terms.guarantee] as [string, string]] : []), [H("Notes", "ملاحظات", "نوٹ"), terms.notes ?? ""]],
    check: { col: 5, total: sub },
  };
}

export function docHTML(doc: Doc, lang: Lang, by: string) {
  const dir = lang === "en" ? "ltr" : "rtl";
  const logo = COMPANY.logoDataUri ? `<img src="${COMPANY.logoDataUri}" style="height:48px">` : `<div style="width:90px;height:44px;border:1px dashed #999;font-size:10px;color:#777;display:flex;align-items:center;justify-content:center">[LOGO]</div>`;
  return `<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><style>
  body{font-family:-apple-system,Roboto,"Noto Sans Arabic","Noto Naskh Arabic",Arial,sans-serif;color:#111;margin:28px;font-size:12px}
  table{border-collapse:collapse;width:100%}th,td{padding:6px 8px;border-bottom:1px solid #ddd;text-align:${dir === "rtl" ? "right" : "left"}}
  th{background:#EEF1EF;font-size:11px}td.n,th.n{text-align:${dir === "rtl" ? "left" : "right"};white-space:nowrap;font-variant-numeric:tabular-nums}
  .wm{position:fixed;top:40%;left:10%;font-size:60px;color:rgba(14,107,92,.06);transform:rotate(-25deg)}
  tr{page-break-inside:avoid}</style></head><body><div class="wm">${esc(COMPANY.name)}</div>
  <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #0E6B5C;padding-bottom:8px;margin-bottom:12px">
   <div><b style="font-size:16px">${esc(doc.title)}</b><div style="font-size:11px;color:#555">${esc(lang === "ar" ? COMPANY.nameAr : COMPANY.name)} · ${esc(COMPANY.details)} · ${day(Date.now())}</div></div>${logo}</div>
  <table><thead><tr>${doc.cols.map((c, i) => `<th class="${doc.numCols.includes(i) ? "n" : ""}">${esc(c)}</th>`).join("")}</tr></thead>
  <tbody>${doc.rows.map((r) => `<tr>${r.map((v, i) => `<td class="${doc.numCols.includes(i) ? "n" : ""}" data-c="${i}">${doc.numCols.includes(i) ? money(v) : esc(v)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${doc.cols.length}">—</td></tr>`}</tbody></table>
  <table style="margin-top:12px;width:60%">${doc.sum.map((s) => `<tr><td>${esc(s[0])}</td><td class="n"><b>${esc(s[1])}</b></td></tr>`).join("")}</table>
  <div style="margin-top:16px;font-size:9px;color:#888">${esc(by)} · ${stamp(Date.now())} · AL-Swati</div></body></html>`;
}

/** Checks the document before it is made, then re-reads the finished HTML and re-adds the checked column. */
export function pdfChecks(t: (k: string) => string, doc: Doc, html: string): Check[] {
  const c: Check[] = [];
  c.push({ s: ARABIC_DIGITS.test(html) ? "bad" : "good", text: t("ck_noAr") });
  c.push({ s: doc.rows.some((r) => doc.numCols.some((i) => !Number.isFinite(Number(r[i])))) ? "bad" : "good", text: t("ck_numbers") });
  c.push({ s: doc.rows.every((r) => r.length === doc.cols.length) ? "good" : "bad", text: t("ck_table") });
  if (doc.check) {
    const re = new RegExp(`<td class="n" data-c="${doc.check.col}">([^<]*)</td>`, "g");
    let m, back = 0; while ((m = re.exec(html))) back += num(String(m[1]).replace("−", "-"));
    back = r2(back);
    c.push({ s: Math.abs(back - doc.check.total) < 0.01 ? "good" : "bad", text: `${t("ck_math")}: ${money(back)} = ${money(doc.check.total)}` });
  }
  if (!COMPANY.logoDataUri || COMPANY.name.startsWith("[")) c.push({ s: "warn", text: t("ck_logo") });
  return c;
}

export async function makeAndShare(doc: Doc, html: string) {
  // Laptop: the browser print window opens; choose "Save as PDF", then attach it to WhatsApp Web or email.
  if (Platform.OS === "web") { await Print.printAsync({ html }); return ""; }
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: doc.title });
  return uri;
}
