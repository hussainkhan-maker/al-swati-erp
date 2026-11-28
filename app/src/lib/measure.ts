// One place for a measurement line's arithmetic and for the subcontractor's measurement paper, so the live sheet, the
// saved sheet and the PDF can never disagree. A line is one place he measured: count × length × width − deduction.
import { money, num, r2 } from "./fmt";

const n0 = (v: any) => { const x = num(v); return Number.isFinite(x) ? x : 0; };
/** How many identical pieces the line stands for ("5 columns 4 by 2"). One when he gave no count. */
export const mQty = (l: any) => { const q = n0(l?.qty); return q > 0 ? q : 1; };
export const mGross = (l: any) => r2(mQty(l) * n0(l?.l) * n0(l?.w));
export const mArea = (l: any) => r2(Math.max(0, mQty(l) * n0(l?.l) * n0(l?.w) - n0(l?.deduct)));
/** The working, written out: "5 × 4 × 2 = 40". */
export const mWorking = (l: any) => `${mQty(l) > 1 ? mQty(l) + " × " : ""}${String(l?.l ?? "")} × ${String(l?.w ?? "")}${n0(l?.deduct) ? " − " + l.deduct : ""} = ${money(mArea(l))}`;

const NAMES: [RegExp, string, string][] = [[/seedh|straight|مستقيم|سیدھ/i, "جدار مستقيم", "Straight wall"], [/amood|amoot|amud|amod|column|pillar|عمود|اموت|امود|ستون/i, "عمود", "Column"], [/saqaf|saqf|sakaf|sagaf|ceiling|soffit|سقف|صقف|چھت/i, "سقف", "Ceiling"], [/beam|kamra|كمرة|بیم/i, "كمرة", "Beam"], [/deewar|diwar|dewar|wall|jidar|جدار|دیوار/i, "جدار", "Wall"], [/darwaza|door|باب|دروازہ/i, "باب", "Door"], [/khirki|window|شباك|نافذة|کھڑکی/i, "شباك", "Window"], [/zeena|stair|درج|سیڑھ/i, "درج", "Stairs"]];
export const elemName = (e: any, en: boolean) => { const t = String(e || "").trim(); const hit = NAMES.find(([re]) => re.test(t)); return hit ? (en ? hit[2] : hit[1]) : t; };

/** The paper: every entry on its own row with its working, grouped under "on the wall" and "on C-channel", a subtotal
 *  under each group, and the total at the end. Arabic for the site team, English for the owner. */
export function measureDoc(lines: any[], who: string, project: string, en: boolean) {
  const X = (e: string, a: string) => (en ? e : a);
  const sysN = (k: string) => (k === "channel" ? X("On C-channel (steel)", "على القناة (حديد)") : k === "wall" ? X("On the wall (plain)", "على الجدار (سادة)") : X("Type not said", "غير محدد"));
  const anyDed = lines.some((l) => n0(l.deduct) > 0), anyQty = lines.some((l) => mQty(l) > 1), anySys = lines.some((l) => l.system);
  const cols = ["#", X("Item", "البند"), ...(anyQty ? [X("Count", "العدد")] : []), X("Length m", "الطول م"), X("Width m", "العرض م"), anyQty ? X("Count × length × width", "العدد × الطول × العرض") : X("Length × width", "الطول × العرض"), ...(anyDed ? [X("Deduction m²", "الخصم م²"), X("Area m²", "المساحة م²")] : [])];
  const blank = (first: string, last: string) => { const r = cols.map(() => ""); r[1] = first; r[cols.length - 1] = last; return r; };
  const rows: string[][] = []; let n = 0;
  const put = (ls: any[]) => ls.forEach((l) => rows.push([String(++n), [elemName(l.element, en), String(l.place || "").trim()].filter(Boolean).join(" - ") || "-", ...(anyQty ? [String(mQty(l))] : []), String(l.l), String(l.w), money(mGross(l)), ...(anyDed ? [n0(l.deduct) ? money(n0(l.deduct)) : "", money(mArea(l))] : [])]));
  const groups = ["wall", "channel", ""].map((k) => ({ k, ls: lines.filter((l) => (l.system || "") === k) })).filter((g) => g.ls.length);
  const sub = (ls: any[]) => r2(ls.reduce((t, l) => t + mArea(l), 0));
  if (anySys) groups.forEach((g) => { rows.push(blank(`— ${sysN(g.k)} —`, "")); put(g.ls); rows.push(blank(`${X("Subtotal", "المجموع الفرعي")} · ${sysN(g.k)}`, money(sub(g.ls)))); });
  else put(lines);
  const sum: [string, string][] = [...(anySys ? groups.map((g) => [`${sysN(g.k)} ${X("m²", "م²")}`, money(sub(g.ls))] as [string, string]) : []), [X("Entries", "عدد البنود"), String(lines.length)], [X("Total m²", "المجموع م²"), money(sub(lines))]];
  return { title: `${X("Work measurement", "قياس أعمال")} - ${who || "-"} - ${project}`, cols, rows, sum, numCols: [] as number[] };
}
