// "Process agents": code checks that run between each step. Red (bad) blocks saving; amber (warn) must be seen.
import { ARABIC_DIGITS, money, r2, splitIncome } from "./fmt";

export type Check = { s: "good" | "warn" | "bad"; text: string };
type T = (k: string) => string;

function typicalMax(txns: any[], type: string) {
  const xs = txns.filter((x) => x.type === type && x.status !== "cancelled").map((x) => Number(x.amount ?? x.total ?? x.gross) || 0).filter(Boolean).sort((a, b) => a - b);
  return xs.length < 4 ? Infinity : xs[Math.floor(xs.length / 2)] * 10;
}

export function entryChecks(t: T, o: any, ctx: { projects: any[]; txns: any[]; subs: string[]; ledger: any[]; raw: string }): Check[] {
  const c: Check[] = [], P = ctx.projects.find((p) => p.id === o.project_id);
  if (o.intent === "rate") { if (!o.material) c.push({ s: "bad", text: t("material") + " ?" }); }
  else c.push({ s: P ? "good" : "bad", text: P ? `${t("ck_proj")}: ${P.name}` : t("needProject") });
  c.push({ s: ARABIC_DIGITS.test(ctx.raw) ? "warn" : "good", text: t("ck_noAr") });

  if (o.intent === "progress") {
    if (!o.rows?.length) c.push({ s: "bad", text: t("qty") + " ?" });
    (o.rows || []).forEach((r: any) => {
      c.push({ s: r.qty > 0 ? "good" : "bad", text: `${r.sub_name || "?"}: ${Number.isFinite(r.qty) ? r.qty : "?"} ${r.unit}` });
      const known = ctx.subs.some((s) => s.toLowerCase() === String(r.sub_name).toLowerCase());
      c.push({ s: known ? "good" : "warn", text: known ? `${t("ck_sub")}: ${r.sub_name}` : `${t("ck_newSub")} (${r.sub_name})` });
    });
    c.push({ s: "good", text: `${t("ck_math")}: ${t("total")} ${money(r2((o.rows || []).reduce((s: number, r: any) => s + (r.qty || 0), 0)))}` });
    return c;
  }
  c.push({ s: o.amount > 0 ? "good" : "bad", text: t("ck_amt") });
  if (o.amount > typicalMax(ctx.txns, o.intent)) c.push({ s: "warn", text: t("ck_big") });
  if (o.intent === "income" && P && o.amount > 0) {
    const sp = splitIncome(o.amount, Number(P.fee_pct), o.loan || 0);
    c.push({ s: r2(sp.base + sp.vat) === sp.gross && sp.net >= 0 ? "good" : "bad", text: `${t("ck_math")}: ${money(sp.base)} + ${money(sp.vat)} = ${money(sp.gross)}` });
    if (o.loan > 0) { const L = ctx.ledger.find((l) => l.project_id === P.id); c.push({ s: o.loan <= (Number(L?.loan_balance) || 0) + 0.01 ? "good" : "warn", text: `${t("ck_loanBal")}: ${money(L?.loan_balance || 0)}` }); }
  }
  // Small expenses need no photo; bought material goes through the purchase invoice (photo required there).
  if (o.intent === "expense") c.push({ s: String(o.description || "").trim() ? "good" : "warn", text: "What the expense was for" });
  if (o.intent === "subpay") c.push({ s: ctx.subs.some((s) => s.toLowerCase() === String(o.sub_name || "").toLowerCase()) ? "good" : "bad", text: `${t("ck_sub")}: ${o.sub_name || "?"}` });
  return c;
}

export function purchaseChecks(t: T, x: any, ctx: { txns: any[]; pname: (id: string) => string }): Check[] {
  const c: Check[] = [];
  c.push({ s: x.photo ? "good" : "bad", text: t("ck_photo") });
  c.push({ s: x.total > 0 ? "good" : "bad", text: t("ck_amt") + (x.total > 0 ? ": " + money(x.total) : "") });
  const pct = r2(x.split.reduce((s: number, y: any) => s + y.pct, 0));
  c.push({ s: x.split.length && Math.abs(pct - 100) < 0.01 ? "good" : "bad", text: `${t("ck_split")} (${pct}%)` });
  x.split.forEach((y: any) => c.push({ s: "good", text: `${ctx.pname(y.project_id)}: ${money(r2((x.total || 0) * y.pct / 100))}` }));
  if (x.lines.length && Number.isFinite(x.subtotal)) {
    const ls = r2(x.lines.reduce((s: number, l: any) => s + (l.total || 0), 0));
    c.push({ s: Math.abs(ls - x.subtotal) <= 1 ? "good" : "warn", text: `${t("ck_sum")}: ${money(ls)} / ${money(x.subtotal)}` });
  }
  if (x.vat > 0) {
    if (Number.isFinite(x.subtotal) && x.subtotal > 0) {
      c.push({ s: Math.abs(r2(x.subtotal * 0.15) - x.vat) <= 1 ? "good" : "warn", text: `${t("ck_vat")}: ${money(x.subtotal)} × 15% = ${money(r2(x.subtotal * 0.15))}` });
      c.push({ s: Math.abs(r2(x.subtotal + x.vat) - x.total) <= 1 ? "good" : "warn", text: `${t("ck_math")}: ${money(x.subtotal)} + ${money(x.vat)} = ${money(r2(x.subtotal + x.vat))}` });
    }
    c.push({ s: x.company ? "good" : "bad", text: t("ck_company") });
  }
  if (x.total > typicalMax(ctx.txns, "purchase")) c.push({ s: "warn", text: t("ck_big") });
  return c;
}

// ── query (RFQ) gates ──
const SCOPE: [string, RegExp][] = [["skirting", /skirting|نعل|وزرة/i], ["adhesive / mortar", /adhesive|mortar|لاصق|مونة/i], ["grout", /grout|ترويب/i], ["screed / levelling", /screed|level|تسوية/i], ["wastage %", /wast|هالك/i], ["threshold / step nosing", /threshold|nosing|عتبة/i], ["expansion joints", /expansion|movement joint|فاصل/i], ["polishing / sealing", /polish|seal|جلي|تلميع/i], ["protection", /protect|حماية/i], ["transport / crane", /transport|crane|نقل|رافعة/i]];
const STONE = /floor|tile|porcelain|marble|granite|stone|cladding|paving|بلاط|رخام|جرانيت|بورسلان|حجر|تكسية/i;
const CLAD = /cladding|facade|واجه|تكسية/i;
export type Gate = { n: number; name: string; s: Check["s"]; d: string[] };
export function rfqGates(text: string, a: any, b: any, hasPrice: (desc: string) => boolean): Gate[] {
  const A = a.lines || [], B = b.lines || [], G: Gate[] = [];
  G.push({ n: 1, name: "Intake", s: "good", d: [`${text.length} characters read`] });
  const diffs: string[] = [];
  A.forEach((l: any, i: number) => { const m = B.find((x: any) => x.ref && x.ref === l.ref) || B[i]; if (!m) diffs.push(`${l.ref || i + 1}: the second reading missed this line`); else if (Number(m.qty) !== Number(l.qty) || String(m.unit) !== String(l.unit)) diffs.push(`${l.ref || i + 1}: ${l.qty} ${l.unit} vs ${m.qty} ${m.unit}`); });
  if (B.length > A.length) diffs.push(`the second reading found ${B.length - A.length} more line(s)`);
  G.push({ n: 2, name: "Read twice, two ways", s: diffs.length ? "bad" : "good", d: diffs.length ? diffs : [`Both readings agree on ${A.length} lines`] });
  const m: string[] = [];
  A.forEach((l: any, i: number) => { if (!(Number(l.qty) > 0)) m.push(`${l.ref || i + 1}: quantity missing`); if (!["sqm", "rft", "lm", "no", "ton", "ls"].includes(String(l.unit).toLowerCase())) m.push(`${l.ref || i + 1}: unit "${l.unit}" is not standard`); });
  const refs = A.map((l: any) => l.ref).filter(Boolean); const dup = refs.filter((x: any, i: number) => refs.indexOf(x) !== i);
  if (dup.length) m.push("Duplicate item numbers: " + [...new Set(dup)].join(", "));
  G.push({ n: 3, name: "Code check: quantities and units", s: m.length ? "bad" : "good", d: m.length ? m : ["All quantities are numbers above zero; units are standard"] });
  const all = A.map((l: any) => l.desc).join(" \n ") + " " + text, miss: string[] = [];
  if (STONE.test(all)) SCOPE.forEach(([n, re]) => { if (!re.test(all)) miss.push(n); });
  if (CLAD.test(all) && !/anchor|bracket|مرابط|scaffold|سقالة/i.test(all)) miss.push("anchors / brackets / scaffolding for cladding");
  G.push({ n: 4, name: "Hidden-cost checklist", s: miss.length ? "warn" : "good", d: miss.length ? miss.map((x) => `Not in the BOQ: ${x}. Client's, or do you price it?`) : ["Every usual stone and flooring item is mentioned"] });
  G.push({ n: 5, name: "Questions for the consultant (RFI)", s: (a.rfis || []).length ? "warn" : "good", d: (a.rfis || []).length ? a.rfis : ["None found"] });
  const un = A.filter((l: any) => !hasPrice(l.desc)).map((l: any) => "No price on file: " + String(l.desc).slice(0, 60));
  G.push({ n: 6, name: "Price list coverage", s: un.length ? "warn" : "good", d: un.length ? un : ["Every line has a price on file"] });
  return G;
}

// ───────── quotation safety: all maths and limits are done here in code, never by the AI ─────────
export const QUOTE_DEFAULTS = { waste: 12, minMargin: 15 };
const NATURAL_STONE = /stone|marble|granite|travertine|limestone|riyadh|حجر|رخام|جرانيت|ترافرتين/i;
/** One quotation line: client is billed the NET quantity; material is bought with waste on top. */
export function lineCalc(l: any) {
  const net = Number(l.qty) || 0, waste = l.waste === "" || l.waste == null ? QUOTE_DEFAULTS.waste : Number(l.waste);
  const cost = Number(l.cost) || 0, install = Number(l.install) || 0, rate = Number(l.rate) || 0;
  const unitCost = r2(cost * (1 + waste / 100) + install);           // what one billed m² really costs us
  const margin = rate > 0 ? r2(((rate - unitCost) / rate) * 100) : null;
  return { net, waste, cost, install, rate, unitCost, margin, buy: r2(net * (1 + waste / 100)), sell: r2(net * rate), costTotal: r2(net * unitCost) };
}
export function quoteTotals(lines: any[]) {
  const c = (lines || []).map(lineCalc), sell = r2(c.reduce((s, x) => s + x.sell, 0)), cost = r2(c.reduce((s, x) => s + x.costTotal, 0));
  return { sell, cost, profit: r2(sell - cost), margin: sell > 0 ? r2(((sell - cost) / sell) * 100) : 0, vat: r2(sell * 0.15) };
}
/** Hard rules before a quotation can be approved and locked. */
export function quoteGuards(q: any, minMargin = QUOTE_DEFAULTS.minMargin): Check[] {
  const out: Check[] = [], lines = q.lines || [];
  if (!lines.length) out.push({ s: "bad", text: "No lines" });
  lines.forEach((l: any, i: number) => {
    const x = lineCalc(l), n = `Line ${i + 1} (${String(l.desc || "").slice(0, 40)})`;
    if (!(x.net > 0)) out.push({ s: "bad", text: `${n}: quantity missing` });
    if (!(x.rate > 0)) out.push({ s: "bad", text: `${n}: selling rate missing` });
    if (!(x.cost > 0) && !(x.install > 0)) out.push({ s: "bad", text: `${n}: enter the material cost and/or installation cost` });
    if (!(x.waste >= 0 && x.waste <= 30)) out.push({ s: "bad", text: `${n}: waste ${x.waste}% is not between 0 and 30` });
    else if (NATURAL_STONE.test(l.desc || "") && x.waste < 10) out.push({ s: "warn", text: `${n}: stone waste only ${x.waste}% (normally 10–15%)` });
    if (x.margin != null && x.margin < minMargin) out.push({ s: "bad", text: `${n}: margin ${x.margin}% is below your minimum ${minMargin}%` });
    const th = String(l.desc || "").match(/(\d+(?:\.\d+)?)\s*(mm|cm)\b/i);
    if (th && NATURAL_STONE.test(l.desc || "")) { const mm = Number(th[1]) * (th[2].toLowerCase() === "cm" ? 10 : 1); if (mm < 15 || mm > 50) out.push({ s: "bad", text: `${n}: thickness ${mm} mm looks wrong for stone` }); }
    const sz = String(l.desc || "").match(/(\d{2,3})\s*[x×*]\s*(\d{2,3})/);
    if (sz && [Number(sz[1]), Number(sz[2])].some((v) => v > 320 || v % 5 !== 0)) out.push({ s: "warn", text: `${n}: size ${sz[1]}×${sz[2]} is not a usual slab/tile size` });
  });
  const t = quoteTotals(lines);
  if (t.sell > 0 && t.margin < minMargin) out.push({ s: "bad", text: `Whole quotation margin ${t.margin}% is below your minimum ${minMargin}%` });
  const au = q.rfq?.audit;
  if (!au) out.push({ s: "warn", text: "Second AI check not run yet" });
  else if (au.stale) out.push({ s: "warn", text: "Lines changed after the second AI check (RFI answer) — run it again" });
  if (au) { const high = (au.lines || []).filter((a: any) => a.level === "high" && !(au.ack || []).includes(a.i)); if (high.length) out.push({ s: "bad", text: `AI auditor flagged ${high.length} line(s): fix them or tick “checked”` }); }
  return out;
}
