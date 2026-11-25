// Edge Function "visit": the website's own visit counter (no cookies, nothing that identifies a person).
// Every page of al-swaticontracting.com sends a small note here with navigator.sendBeacon when it opens, and when a
// visitor presses WhatsApp, call, email or the quote form. The note is checked and saved in public.site_visits; only the
// owner can read it (ERP → Agents → Website team, and the weekly growth report).
// Saved: the page, where the visit started (google, tiktok, youtube …), our own link tag (?src=…), the first page of the
// visit, phone or computer. Never saved: IP address, the full referring address, anything typed, the WhatsApp message.
// Open to anyone (verify_jwt = false in config.toml): a page cannot sign in. Bots and other websites' pages are ignored.
const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITES = ["https://al-swaticontracting.com", "https://www.al-swaticontracting.com"];
const KINDS = new Set(["view", "whatsapp", "call", "email", "form"]);
const BOT = /bot|crawl|spider|slurp|preview|lighthouse|headless|facebookexternalhit|whatsapp\/|telegram|python|curl|wget|node-fetch|axios/i;

// Where a visit came from, by the referring site's name (the address itself is not kept).
const SOURCES: [RegExp, string][] = [
  [/(^|\.)google\./, "google"], [/(^|\.)bing\.com$/, "bing"], [/(^|\.)yahoo\./, "yahoo"], [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)tiktok\.com$/, "tiktok"], [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"], [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "facebook"], [/(^|\.)snapchat\.com$/, "snapchat"], [/(^|\.)(linkedin\.com|lnkd\.in)$/, "linkedin"],
  [/(^|\.)(x\.com|twitter\.com|t\.co)$/, "x"], [/(^|\.)(whatsapp\.com|wa\.me)$/, "whatsapp"], [/(^|\.)(chatgpt\.com|openai\.com)$/, "chatgpt"],
  [/(^|\.)(claude\.ai|perplexity\.ai|gemini\.google\.com)$/, "ai-search"], [/(^|\.)github\.io$/, "erp"],
];
// Our own link tags: tt-…, yt-…, ig-…, fb-…, li-…, gbp-…, wa-…, sc-… name the platform even when the app sends no referrer.
const TAGS: Record<string, string> = { tt: "tiktok", yt: "youtube", ig: "instagram", fb: "facebook", li: "linkedin", gbp: "google-maps", wa: "whatsapp", sc: "snapchat", x: "x" };

const clip = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const cleanPath = (v: unknown) => { const s = clip(v, 300); return s && s.startsWith("/") ? s.split(/[?#]/)[0] : null; };
function sourceOf(host: string | null, tag: string | null) {
  const t = tag?.split("-")[0].toLowerCase();
  if (t && TAGS[t]) return TAGS[t];
  if (!host) return "direct";
  for (const [re, name] of SOURCES) if (re.test(host)) return name;
  return "other:" + host.slice(0, 50);
}
const hostOf = (r: unknown) => { try { return r ? new URL(String(r)).hostname.replace(/^www\./, "").toLowerCase() : null; } catch { return null; } };

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const cors = { "Access-Control-Allow-Origin": SITES.includes(origin) ? origin : SITES[0], "Vary": "Origin" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "content-type" } });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: cors });
  // only our own pages, and only people (a beacon from a page always carries its Origin)
  if (!SITES.includes(origin) || BOT.test(req.headers.get("user-agent") || "")) return new Response(null, { status: 204, headers: cors });
  let b: any;
  try { const t = await req.text(); if (t.length > 2000) throw 0; b = JSON.parse(t); } catch { return new Response("bad note", { status: 400, headers: cors }); }
  const kind = KINDS.has(b?.k) ? b.k : null, path = cleanPath(b?.p);
  if (!kind || !path) return new Response("bad note", { status: 400, headers: cors });
  // The page keeps, for this tab only, how the visit started: the first referring site (f), its link tag (g) and first page (l).
  const OWN = "al-swaticontracting.com", tagOf = (v: unknown) => clip(v, 60)?.replace(/[^\w\-.]/g, "") || null;
  const tag = tagOf(b?.g) || tagOf(b?.s), ref = hostOf(b?.r);
  const first = typeof b?.f === "string" && /^[a-z0-9.-]{1,100}$/i.test(b.f) ? b.f.toLowerCase().replace(/^www\./, "") : null;
  const source = sourceOf(first && first !== OWN ? first : null, tag);
  const row = { kind, path, lang: path === "/ar" || path.startsWith("/ar/") ? "ar" : "en", source, src: tag, landing: cleanPath(b?.l) || path,
    ref: ref && ref !== OWN ? ref.slice(0, 100) : null, mobile: typeof b?.m === "boolean" ? b.m : null };
  const r = await fetch(`${URL_}/rest/v1/site_visits`, { method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(row) });
  return new Response(null, { status: r.ok ? 204 : 500, headers: cors });
});
