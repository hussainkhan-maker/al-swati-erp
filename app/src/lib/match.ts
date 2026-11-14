// Material names in Arabic and English (and rough spellings) → one canonical form, so the same stone
// on an Arabic invoice and in an English BOQ is recognised as the same thing. Sizes and thickness must
// agree too: "60x60 2cm" and "60x120 3cm" are different products even if the name is the same.
import { norm, r2 } from "./fmt";

// Canonical English word for each Arabic / variant spelling (applied after norm(): أ/إ/آ→ا, ة→ه, ى→ي).
const DICT: [RegExp, string][] = [
  [/^(رخام|marbles?|marbal|marmar|مرمر)$/, "marble"],
  [/^(جرانيت|غرانيت|جرانيت|granit|granites?|granait)$/, "granite"],
  [/^(بورسلان|بورسلين|بورسلين|porcel[ae]n|porcelin|porselen|porcelaine)$/, "porcelain"],
  [/^(سيراميك|ceramics?)$/, "ceramic"],
  [/^(حجر|احجار|stones?)$/, "stone"],
  [/^(ترافرتين|ترافرتينو|travertino|travertines?)$/, "travertine"],
  [/^(لايمستون|limestones?)$/, "limestone"],
  [/^(كوارتز|quartz)$/, "quartz"],
  [/^(بلاط|بلاطه|tiles?)$/, "tile"],
  [/^(لاصق|غراء|adhesives?|glue)$/, "adhesive"],
  [/^(روبه|جراوت|grouts?)$/, "grout"],
  [/^(اسمنت|سمنت|cement)$/, "cement"],
  [/^(رمل|sand)$/, "sand"],
  [/^(نعلات|نعله|وزره|سكرتنج|skirtings?)$/, "skirting"],
  [/^(درج|درجات|steps?|treads?)$/, "step"],
  [/^(قائم|قوائم|risers?)$/, "riser"],
  [/^(عتبه|عتبات|جلسه|جلسات|sills?|thresholds?)$/, "sill"],
  [/^(كسوه|تكسيه|تكسية|واجهات|واجهه|cladding|facade|facades)$/, "cladding"],
  [/^(ارضيات|ارضيه|flooring|floors?)$/, "floor"],
  [/^(مصقول|لميع|polish|polished|glossy)$/, "polished"],
  [/^(مطفي|مط|honed|matt|matte)$/, "honed"],
  [/^(خشن|محروق|flamed|rough)$/, "flamed"],
  [/^(محبب|bush|bushhammered)$/, "bushhammered"],
  [/^(براغي|انكر|انكور|مرابط|anchors?|bolts?|dowels?|pins?)$/, "anchor"],
  [/^(كانات|زوايا|brackets?|angles?|channels?)$/, "bracket"],
  [/^(سيلكون|سيليكون|sealants?|silicone)$/, "sealant"],
  [/^(كرارا|carrara)$/, "carrara"],
  [/^(كريما|crema)$/, "crema"],
  [/^(مارفيل|marfil)$/, "marfil"],
  [/^(ابيض|white)$/, "white"],
  [/^(اسود|black)$/, "black"],
  [/^(بيج|beige)$/, "beige"],
  [/^(رمادي|gr[ae]y)$/, "grey"],
  [/^(رياض|riyadh)$/, "riyadh"],
];
// Words that say nothing about which material it is.
const STOP = new Set(["supply", "install", "installation", "and", "with", "of", "for", "the", "a", "to", "in", "per", "sqm", "m2", "lm", "rm", "pcs", "pc", "nos", "no", "each", "ton", "bag", "bags",
  "توريد", "تركيب", "و", "مع", "من", "في", "الى", "على", "م2", "م", "متر", "مربع", "طولي", "حبه", "قطعه", "كيس", "طن", "عدد", "سم", "ملم", "مم", "cm", "mm", "size", "مقاس", "سماكه", "thickness", "thick", "work", "works", "اعمال", "عمل", "item", "type", "نوع"]);
// Where it goes (floor, wall, facade) does not change the material; the finish must not conflict.
const PLACE = new Set(["tile", "cladding", "floor", "wall", "walls", "جدران", "حوائط", "internal", "external", "داخلي", "خارجي"]);
const FINISH = new Set(["polished", "honed", "flamed", "bushhammered"]);
// The kind of material: if both names say a kind and the kinds differ, it is not the same thing.
const KIND = new Set(["marble", "granite", "porcelain", "ceramic", "travertine", "limestone", "quartz", "cement", "sand", "adhesive", "grout", "anchor", "bracket", "sealant"]);

const canonWord = (w: string) => { for (const [re, c] of DICT) if (re.test(w)) return c; return w.replace(/^ال(?=\S{3,})/, ""); }; // drop Arabic "al-"

export type Canon = { words: Set<string>; kinds: Set<string>; finish: Set<string>; sizes: Set<string>; thick: number | null };
const cache = new Map<string, Canon>();
export function canon(text: any): Canon {
  const key = String(text ?? "");
  const hit = cache.get(key); if (hit) return hit;
  let s = norm(key).replace(/(\d)\s*[x×*]\s*(?=\d)/g, "$1x");
  const sizes = new Set<string>();
  // 60x60, 60x120x2 (last part = thickness in cm when small)
  let thick: number | null = null;
  s.replace(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?/g, (_m, a, b, t) => {
    const [p, q] = [Number(a), Number(b)].sort((x, y) => x - y); sizes.add(`${p}x${q}`);
    if (t) { const n = Number(t); thick = n <= 6 ? n * 10 : n; }
    return "";
  });
  const tm = s.match(/(\d+(?:\.\d+)?)\s*(mm|ملم|مم|cm|سم)(?![a-z])/);
  if (tm) { const n = Number(tm[1]); thick = /cm|سم/.test(tm[2]) ? n * 10 : n; }
  const words = new Set<string>(), kinds = new Set<string>(), finish = new Set<string>();
  for (const raw of s.replace(/\d+(?:\.\d+)?x\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)?/g, " ").split(/\s+/)) {
    if (!raw || /^\d/.test(raw) || STOP.has(raw)) continue;
    const w = canonWord(raw);
    if (STOP.has(w) || PLACE.has(w) || w.length < 2) continue;
    if (FINISH.has(w)) { finish.add(w); continue; }
    words.add(w); if (KIND.has(w)) kinds.add(w);
  }
  const out = { words, kinds, finish, sizes, thick };
  cache.set(key, out);
  return out;
}

/** 0…1: how sure we are that two descriptions are the same material (size and thickness must not conflict). */
export function sameMaterial(a: any, b: any): number {
  const A = canon(a), B = canon(b);
  if (!A.words.size || !B.words.size) return 0;
  if (A.kinds.size && B.kinds.size && ![...A.kinds].some((k) => B.kinds.has(k))) return 0;
  if (A.sizes.size && B.sizes.size && ![...A.sizes].some((k) => B.sizes.has(k))) return 0;
  if (A.thick && B.thick && Math.abs(A.thick - B.thick) > 1) return 0;
  if (A.finish.size && B.finish.size && ![...A.finish].some((k) => B.finish.has(k))) return 0;
  let hit = 0;
  A.words.forEach((w) => { if (B.words.has(w)) hit += 1; else if (w.length > 4 && [...B.words].some((x) => x.length > 4 && (x.startsWith(w.slice(0, -1)) || w.startsWith(x.slice(0, -1))))) hit += 0.6; });
  const score = hit / Math.max(A.words.size, B.words.size); // every word must be accounted for: "marble" alone is not "Carrara marble"
  return Math.min(1, score) * (A.sizes.size && B.sizes.size ? 1 : 0.95); // a little less sure when a size is missing on one side
}

export type Buy = { price: number; unit: string; supplier: string; date: string; name: string; from: "invoice" | "price list" | "supplier"; score: number };
/** Every price we actually paid (invoice lines) or were given (cost prices) for this material, cheapest first. */
export function pricesFor(d: any, desc: string, minScore = 0.6): Buy[] {
  const out: Buy[] = [];
  for (const x of d.txns || []) {
    if (x.type !== "purchase" || (x.status && x.status !== "active")) continue;
    for (const l of x.lines || []) {
      const price = Number(l.price); if (!(price > 0) || !l.name) continue;
      const sc = sameMaterial(desc, l.name); if (sc < minScore) continue;
      out.push({ price, unit: l.unit || "", supplier: x.supplier || "", date: String(x.paid_on || x.created_at || "").slice(0, 10), name: l.name, from: "invoice", score: sc });
    }
  }
  const itemById: Record<string, any> = Object.fromEntries((d.items || []).map((i: any) => [i.id, i]));
  for (const p of d.prices || []) {
    if (p.kind !== "cost") continue;
    const it = itemById[p.item_id]; if (!it) continue;
    const sc = Math.max(sameMaterial(desc, [it.name, it.size].filter(Boolean).join(" ")), ...(it.aliases || []).map((a: string) => sameMaterial(desc, [a, it.size].filter(Boolean).join(" "))));
    if (sc < minScore) continue;
    out.push({ price: Number(p.price), unit: it.unit || "", supplier: p.supplier || "", date: String(p.created_at || "").slice(0, 10), name: it.name, from: p.source === "invoice" ? "invoice" : p.source === "supplier" ? "supplier" : "price list", score: sc });
  }
  return out.sort((a, b) => a.price - b.price || b.date.localeCompare(a.date));
}

/** Lowest and latest price paid, and which suppliers sold it. */
export function priceSummary(d: any, desc: string) {
  const all = pricesFor(d, desc);
  if (!all.length) return null;
  const latest = [...all].sort((a, b) => b.date.localeCompare(a.date))[0];
  const bySupplier: Record<string, Buy> = {};
  all.forEach((b) => { const k = norm(b.supplier); if (k && (!bySupplier[k] || b.price < bySupplier[k].price)) bySupplier[k] = b; });
  const avg = r2(all.reduce((s, b) => s + b.price, 0) / all.length);
  return { lowest: all[0], latest, count: all.length, avg, suppliers: Object.values(bySupplier).sort((a, b) => a.price - b.price), all };
}
