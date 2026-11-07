// Formatting and money math. The database repeats the same math and is the final authority.

export const r2 = (n: any) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function money(n: any): string {
  const v = r2(Number(n) || 0);
  const neg = v < 0;
  const [i, d] = Math.abs(v).toFixed(2).split(".");
  const s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (d === "00" ? "" : "." + d.replace(/0$/, ""));
  return (neg ? "−" : "") + s;
}
export const SAR = (n: any) => money(n) + " SAR";

export const ARABIC_DIGITS = /[٠-٩۰-۹]/;
export const toLatin = (s: any) =>
  String(s ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
export const num = (v: any) => { const x = Number(toLatin(v).replace(/[,\s]/g, "")); return Number.isFinite(x) ? x : NaN; };

export const day = (d: any) => new Date(d).toISOString().slice(0, 10);
export const stamp = (d: any) => new Date(d).toISOString().slice(0, 16).replace("T", " ");
export const ageDays = (d: any) => Math.floor((Date.now() - new Date(d).getTime()) / 864e5);

/** VAT is 15% inside the total; the service fee is charged on the amount after VAT. */
export function splitIncome(gross: number, feePct: number, loan = 0) {
  const base = r2(gross / 1.15), vat = r2(gross - base), fee = r2(base * (feePct || 0) / 100), l = r2(loan || 0);
  return { gross: r2(gross), base, vat, fee, loan: l, net: r2(gross - vat - fee - l) };
}

// ── smart matching of material names (spellings, Arabic, sizes) ──
export function norm(s: any) {
  return toLatin(String(s ?? "").toLowerCase())
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[×*]/g, "x").replace(/(\d+)\s*(?:x|by)\s*(\d+)/g, "$1x$2")
    .replace(/[^\w؀-ۿ\s.]+/g, " ").replace(/\s+/g, " ").trim();
}
export function matchItems(q: string, items: any[]): { item: any; score: number }[] {
  const qt = norm(q).split(" ").filter(Boolean);
  if (!qt.length) return [];
  return items
    .map((item) => {
      const hay = norm([item.name, ...(item.aliases || []), item.category, item.size].join(" "));
      const ht = new Set(hay.split(" "));
      let hit = 0;
      qt.forEach((w) => { if (ht.has(w)) hit += 1; else if (w.length > 3 && hay.includes(w.slice(0, -1))) hit += 0.6; });
      return { item, score: hit / qt.length };
    })
    .filter((x) => x.score > 0.3)
    .sort((a, b) => b.score - a.score);
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
