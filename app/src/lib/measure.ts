// One place for a measurement line's arithmetic and for the subcontractor's measurement paper, so the live sheet, the
// saved sheet and the PDF can never disagree. A line is one place he measured: count × length × width − deduction.
import { money, num, r2 } from "./fmt";

const n0 = (v: any) => { const x = num(v); return Number.isFinite(x) ? x : 0; };
/** How many identical pieces the line stands for ("5 columns 4 by 2"). One when he gave no count. */
export const mQty = (l: any) => { const q = n0(l?.qty); return q > 0 ? q : 1; };
/** A deduction entry: a door, a window or any opening he calls "khasam". It is its own entry, never part of another line,
 *  and it is taken off the total. He gives it as length × width, or as square metres straight away (m2). */
export const mIsDed = (l: any) => !!l?.ded;
const sized = (l: any) => n0(l?.l) > 0 && n0(l?.w) > 0;
/** Length × width; or, when he gave the area itself ("12 square metres"), that area. */
const size = (l: any) => r2(sized(l) ? mQty(l) * n0(l.l) * n0(l.w) : mQty(l) * n0(l?.m2));
export const mSized = sized;
export const mGross = size;
/** What the line adds to the total: work adds, a deduction takes away. */
export const mArea = (l: any) => (mIsDed(l) ? -size(l) : r2(Math.max(0, size(l) - n0(l?.deduct))));
export const mValid = (l: any) => sized(l) || n0(l?.m2) > 0;

const NAMES: [RegExp, string, string][] = [[/seedh|straight|مستقيم|سیدھ/i, "جدار مستقيم", "Straight wall"], [/amood|amoot|amud|amod|column|pillar|عمود|اموت|امود|ستون/i, "عمود", "Column"], [/saqaf|saqf|sakaf|sagaf|ceiling|soffit|سقف|صقف|چھت/i, "سقف", "Ceiling"], [/beam|kamra|كمرة|بیم/i, "كمرة", "Beam"], [/deewar|diwar|dewar|wall|jidar|جدار|دیوار/i, "جدار", "Wall"], [/darwaza|door|باب|دروازہ/i, "باب", "Door"], [/khirki|window|شباك|نافذة|کھڑکی/i, "شباك", "Window"], [/zeena|stair|درج|سیڑھ/i, "درج", "Stairs"]];
export const elemName = (e: any, en: boolean) => { const t = String(e || "").trim(); const hit = NAMES.find(([re]) => re.test(t)); return hit ? (en ? hit[2] : hit[1]) : t; };

/** The paper: every entry on its own row with its working, grouped under "on the wall" and "on C-channel", a subtotal
 *  under each group, and the total at the end. Arabic for the site team, English for the owner. */
export function measureDoc(all: any[], who: string, project: string, en: boolean) {
  const X = (e: string, a: string) => (en ? e : a);
  const sysN = (k: string) => (k === "channel" ? X("On C-channel (steel)", "على القناة (حديد)") : k === "wall" ? X("On the wall (plain)", "على الجدار (سادة)") : X("Type not said", "غير محدد"));
  const lines = all.filter((l) => !mIsDed(l)), deds = all.filter(mIsDed);
  const anyDed = lines.some((l) => n0(l.deduct) > 0), anyQty = all.some((l) => mQty(l) > 1), anySys = all.some((l) => l.system);
  const cols = ["#", X("Item", "البند"), ...(anyQty ? [X("Count", "العدد")] : []), X("Length m", "الطول م"), X("Width m", "العرض م"), anyQty ? X("Count × length × width", "العدد × الطول × العرض") : X("Length × width", "الطول × العرض"), ...(anyDed ? [X("Deduction m²", "الخصم م²"), X("Area m²", "المساحة م²")] : [])];
  const blank = (first: string, last: string) => { const r = cols.map(() => ""); r[1] = first; r[cols.length - 1] = last; return r; };
  const rows: string[][] = []; let n = 0;
  const name = (l: any) => [elemName(l.element, en), String(l.place || "").trim()].filter(Boolean).join(" - ");
  const put = (ls: any[]) => ls.forEach((l) => rows.push([String(++n), name(l) || "-", ...(anyQty ? [String(mQty(l))] : []), sized(l) ? String(l.l) : "", sized(l) ? String(l.w) : "", money(mGross(l)), ...(anyDed ? [n0(l.deduct) ? money(n0(l.deduct)) : "", money(mArea(l))] : [])]));
  const groups = ["wall", "channel", ""].map((k) => ({ k, ls: lines.filter((l) => (l.system || "") === k) })).filter((g) => g.ls.length);
  const sub = (ls: any[]) => r2(ls.reduce((t, l) => t + mArea(l), 0));
  if (anySys) groups.forEach((g) => { rows.push(blank(`— ${sysN(g.k)} —`, "")); put(g.ls); rows.push(blank(`${X("Subtotal", "المجموع الفرعي")} · ${sysN(g.k)}`, money(sub(g.ls)))); });
  else put(lines);
  // The deductions have their own section: each door, window or opening on its own row, then what they take off.
  if (deds.length) {
    rows.push(blank(`— ${X("Deductions (doors, windows, openings)", "الخصم (أبواب، شبابيك، فتحات)")} —`, ""));
    deds.forEach((l) => { const sz = sized(l); rows.push([String(++n), [X("Deduction", "خصم"), name(l), anySys && l.system ? sysN(l.system) : ""].filter(Boolean).join(" - "), ...(anyQty ? [String(mQty(l))] : []), sz ? String(l.l) : "", sz ? String(l.w) : "", "− " + money(mGross(l)), ...(anyDed ? ["", ""] : [])]); });
    rows.push(blank(X("Total deductions", "مجموع الخصم"), "− " + money(-sub(deds))));
  }
  const net = (k: string) => sub(all.filter((l) => (l.system || "") === k));
  const sum: [string, string][] = [
    ...(deds.length ? [[X("Work m²", "مجموع الأعمال م²"), money(sub(lines))], [X("Deductions m²", "الخصم م²"), "− " + money(-sub(deds))]] as [string, string][] : []),
    ...(anySys ? ["wall", "channel", ""].filter((k) => all.some((l) => (l.system || "") === k)).map((k) => [`${sysN(k)} ${deds.length ? X("net m²", "الصافي م²") : X("m²", "م²")}`, money(net(k))] as [string, string]) : []),
    [X("Entries", "عدد البنود"), String(lines.length)], [deds.length ? X("Net total m²", "المجموع الصافي م²") : X("Total m²", "المجموع م²"), money(sub(all))]];
  return { title: `${X("Work measurement", "قياس أعمال")} - ${who || "-"} - ${project}`, cols, rows, sum, numCols: [] as number[] };
}
