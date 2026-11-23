// Edge Function "blog-media": when the owner publishes a blog post, this gives it
//  • "image":  a picture for its topic, made by Google's image AI (Gemini), saved in the public "blog" storage, and
//  • "arabic" (or "twin"): its twin in the other language - an English post gets its Arabic version (written the way Saudi
//              companies write, with the words Saudi clients use and search), an Arabic post gets its English version -
//              saved as a second post linked by twin_id, with the same picture and the same status. Every post goes out in both languages.
// Only Super-Admin can call it (same sign-in rules as the "ai" function). Nothing here invents facts: the Arabic keeps the
// original post's facts, and the picture is an illustration of the topic (never shown as "our project").
// The company does facade and wall cladding only (natural stone, marble, granite, porcelain, fixed with mechanical systems):
// nothing here may present flooring as its work.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLAUDE_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const ARABIC_MODEL = Deno.env.get("AI_MODEL_ARABIC") ?? "claude-sonnet-5-5";
const IMAGE_MODEL = Deno.env.get("AI_MODEL_IMAGE") ?? ""; // empty: use the newest Gemini image model this key can reach
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" };
const db = createClient(URL_, SERVICE);
let USER_ID: string | null = null, TASK = "";

const log = (model: string, inp: number, out: number) =>
  db.from("ai_usage").insert({ user_id: USER_ID, task: TASK, model, input_tokens: inp || 0, output_tokens: out || 0, cache_read: 0, cache_write: 0, files: 0 }).then(() => {}, () => {});

/** The AI answers "TITLE: … / META: … / KEYWORDS: … / --- / article" (long Arabic text breaks JSON too easily). */
function parsePost(t: string) {
  const i = t.search(/^---\s*$/m);
  if (i < 0) throw new Error("The AI did not return the post. Try again.");
  const top = t.slice(0, i), body = t.slice(i).replace(/^---\s*\n?/, "").replace(/<\/?cite[^>]*>/gi, "").trim();
  const head = (k: string) => (top.match(new RegExp("^\\s*\\**" + k + "\\**\\s*:\\s*(.+)$", "mi"))?.[1] ?? "").replace(/^\*+\s*|\s*\*+$/g, "").trim();
  return { title: head("TITLE"), meta_description: head("META"), keywords: head("KEYWORDS").split(/[,،]/).map((s) => s.trim()).filter(Boolean), body };
}

async function claude(prompt: string, max: number, ms = 120000) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(ms),
    headers: { "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: ARABIC_MODEL, max_tokens: max, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`AI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  await log(ARABIC_MODEL, j.usage?.input_tokens, j.usage?.output_tokens);
  return (j.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
}

async function geminiText(prompt: string, max: number) {
  const model = Deno.env.get("AI_MODEL_SEO") ?? "gemini-2.5-flash";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", signal: AbortSignal.timeout(110000), headers: { "x-goog-api-key": GEMINI_KEY, "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: max } }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  await log(model, j.usageMetadata?.promptTokenCount, j.usageMetadata?.candidatesTokenCount);
  return (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
}

const COMPANY = "Al-Swati Contracting, a contractor for natural stone, marble, granite and porcelain cladding of facades and walls, installed with mechanical (dry-fix) fixing systems, in Saudi Arabia (Riyadh, Dammam, Al-Hassa). The company does NOT do flooring";
const NO_FLOORING = "- The company does not do flooring, floor tiles or paving. If the article offers flooring as a service of the company, leave that part out; never add anything about flooring.";

async function twinWrite(prompt: string) {
  let out: any;
  try { out = parsePost(await (CLAUDE_KEY ? claude(prompt, 8000) : geminiText(prompt, 8000))); }
  catch (e) { if (!GEMINI_KEY || !CLAUDE_KEY) throw e; out = parsePost(await geminiText(prompt, 8000)); } // second chance with the other AI
  if (!out?.title || String(out.body || "").length < 400) throw new Error("The other-language version came back too short. Try again.");
  return out;
}

// ───────── Arabic twin of an English post ─────────
async function arabic(post: any) {
  const prompt = `You write Arabic web content for ${COMPANY}.
Rewrite the article below in Arabic for clients in Saudi Arabia (villa owners, developers, consultants, project managers).
Language: clear, simple Arabic the way Saudi companies write on their own websites - fluent Modern Standard Arabic with the words Saudi clients really use and search for (for example: تركيب حجر، تركيب واجهات حجر، واجهات حجر طبيعي، تركيب حجر ميكانيكي، تركيب رخام، جرانيت، بورسلان، مقاول حجر، فلل، الرياض، الدمام، الأحساء، ريال). In Arabic, cladding work is always called تركيب (تركيب حجر، تركيب رخام، تركيب جرانيت، تركيب بورسلان، تركيب واجهات حجر) - never تكسية or تكسيات, because Saudi clients search for تركيب. The company's Arabic name is "شركة السواطي للمقاولات". Not spoken dialect, not stiff word-for-word translation: it must read as if a Saudi writer wrote it.
Rules:
- Keep every fact, figure and piece of advice. Add NO new facts about the company (no projects, years, clients, prices, certificates).
${NO_FLOORING}
- Keep the FAQ section: its heading becomes "## الأسئلة الشائعة" in Arabic or "## Frequently asked questions" in English, and every question stays a "### " heading followed by its answer.
- Keep the markdown: "## " headings, "- " bullets, **bold**. Short paragraphs.
- Phone numbers, emails and website links stay exactly as they are (digits stay Western, e.g. 0511826313).
- Title: at most 60 characters, with the main Arabic search phrase. Search description: 120-155 characters.
- keywords: 3-6 Arabic phrases people in Saudi Arabia type into Google for this topic.
Answer in exactly this form and nothing else:
TITLE: <Arabic title>
META: <Arabic search description>
KEYWORDS: <phrase>، <phrase>، <phrase>
---
<the whole Arabic article in markdown>

ARTICLE (English):
TITLE: ${post.title}
DESCRIPTION: ${post.meta_description || ""}
KEYWORDS: ${(post.keywords || []).join(", ")}
---
${String(post.body || "").slice(0, 16000)}`;
  return twinWrite(prompt);
}

// ───────── English twin of an Arabic post ─────────
async function english(post: any) {
  const prompt = `You write English web content for ${COMPANY}.
Rewrite the Arabic article below in English for clients in Saudi Arabia (villa owners, developers, consultants, project managers, many of them expatriates).
Language: clear, natural, professional English, the way a good Riyadh contractor writes on its own website - not a stiff word-for-word translation. Use the words people in Saudi Arabia search in English (for example: stone cladding Riyadh, facade cladding, mechanical stone fixing, dry-fix cladding, marble cladding, granite cladding, porcelain facade, villa facade, SAR).
Rules:
- Keep every fact, figure and piece of advice. Add NO new facts about the company (no projects, years, clients, prices, certificates).
${NO_FLOORING}
- Keep the FAQ section: its heading becomes "## الأسئلة الشائعة" in Arabic or "## Frequently asked questions" in English, and every question stays a "### " heading followed by its answer.
- Keep the markdown: "## " headings, "- " bullets, **bold**. Short paragraphs.
- Phone numbers, emails and website links stay exactly as they are; a link to an Arabic page (/ar/...) may become the same page without /ar.
- Title: at most 60 characters, with the main English search phrase. Search description: 120-155 characters.
- keywords: 3-6 English phrases people in Saudi Arabia type into Google for this topic.
Answer in exactly this form and nothing else:
TITLE: <English title>
META: <English search description>
KEYWORDS: <phrase>, <phrase>, <phrase>
---
<the whole English article in markdown>

ARTICLE (Arabic):
TITLE: ${post.title}
DESCRIPTION: ${post.meta_description || ""}
KEYWORDS: ${(post.keywords || []).join("، ")}
---
${String(post.body || "").slice(0, 16000)}`;
  return twinWrite(prompt);
}
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);

// ───────── Picture ─────────
let imageModels: string[] | null = null;
async function findImageModels(): Promise<string[]> {
  if (imageModels) return imageModels;
  const list: string[] = [];
  if (IMAGE_MODEL) list.push(IMAGE_MODEL);
  try {
    const j = await (await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": GEMINI_KEY }, signal: AbortSignal.timeout(10000) })).json();
    const found = (j.models ?? []).filter((m: any) => /image/i.test(m.name) && !/imagen|embedding/i.test(m.name) && (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m: any) => String(m.name).replace(/^models\//, ""));
    // cheaper "flash" image models first, the newest version first
    found.sort((a: string, b: string) => (Number(/flash/.test(b)) - Number(/flash/.test(a))) || b.localeCompare(a, undefined, { numeric: true }));
    list.push(...found);
  } catch { /* list not reachable: try the known names */ }
  list.push("gemini-2.5-flash-image");
  imageModels = [...new Set(list)];
  return imageModels;
}

async function makePicture(post: any): Promise<{ bytes: Uint8Array; mime: string; model: string }> {
  if (!GEMINI_KEY) throw new Error("No Google AI key on the server (GEMINI_API_KEY).");
  const prompt = `A realistic, professional photograph to illustrate a blog article for a natural stone, marble, granite and porcelain facade and wall cladding contractor (mechanical dry-fix systems) in Saudi Arabia.
Article title: "${post.title}". Topic words: ${(post.keywords || []).join(", ")}.
What the article is about: ${String(post.body || "").replace(/[#*\-]/g, " ").replace(/\s+/g, " ").slice(0, 600)}
Show the subject of the article clearly and accurately (for example the right kind of stone, a clad facade or wall, or mechanical fixing work). Never show floors or floor tiles as the subject. Use a setting that fits Saudi Arabia (modern Riyadh villa or building, bright desert daylight) when a setting is shown.
Wide landscape picture (16:9). Natural colours, sharp, like a good architecture or construction photo.
No text, no letters, no numbers, no logos, no watermarks, no flags. No recognisable faces.`;
  let last = "";
  for (const model of await findImageModels()) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", signal: AbortSignal.timeout(100000), headers: { "x-goog-api-key": GEMINI_KEY, "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "16:9" } } }),
    });
    if (!r.ok) { last = `${model}: ${r.status} ${(await r.text()).slice(0, 160)}`; continue; }
    const j = await r.json();
    const part = (j.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.inlineData?.data || p.inline_data?.data);
    if (!part) { last = `${model}: no picture came back`; continue; }
    const d = part.inlineData ?? part.inline_data;
    await log(model, j.usageMetadata?.promptTokenCount, j.usageMetadata?.candidatesTokenCount);
    imageModels = [model, ...(imageModels ?? []).filter((m) => m !== model)]; // remember the one that works
    return { bytes: Uint8Array.from(atob(d.data), (c) => c.charCodeAt(0)), mime: d.mimeType ?? d.mime_type ?? "image/png", model };
  }
  throw new Error("The picture could not be made. " + last);
}

// ───────── Until Google allows pictures on this key (billing on), the closest photo from the company's own website ─────────
const SITE = "https://al-swaticontracting.com";
const PHOTOS: { path: string; en: string; ar: string; tags: string[] }[] = [
  { path: "/images/3d/stone-cladding-system-exploded-view.webp", en: "Layers of a mechanically fixed stone facade: wall, brackets, C-channels, angles and stone panels", ar: "طبقات واجهة الحجر الميكانيكية: الجدار والزوايا ومجاري C-Channel وألواح الحجر", tags: ["mechanical", "dry fix", "dry-fix", "fixing system", "bracket", "c-channel", "channel", "system", "layers", "ميكانيكي", "تثبيت", "زوايا"] },
  { path: "/images/3d/mechanical-stone-installation-step-4-stone-panels.webp", en: "Natural stone panels fixed row by row on a mechanical cladding system", ar: "تركيب ألواح الحجر الطبيعي صفاً بعد صف على نظام تثبيت ميكانيكي", tags: ["installation", "install", "panels", "steps", "step", "rows", "مراحل", "تركيب"] },
  { path: "/images/3d/up-down-angle-stone-kerf-detail.webp", en: "Stainless steel up-down angle entering the kerf of a stone panel", ar: "زاوية Up-Down من الستانلس ستيل داخل مجرى حافة لوح الحجر", tags: ["kerf", "up-down", "angle", "stainless", "edge", "detail", "ستانلس", "مجرى"] },
  { path: "/images/pages/about/hilti-machinery.webp", en: "Drilling for stone cladding anchors", ar: "تثبيت مسامير الانكر لتركيب الحجر", tags: ["anchor", "anchors", "drill", "drilling", "hilti", "fischer", "bolt", "load", "wind", "انكر", "مسامير", "هيلتي"] },
  { path: "/images/pages/about/hero.webp", en: "Stone cladding installation on site", ar: "تركيب الحجر في الموقع", tags: ["site", "scaffold", "team", "contractor", "installer", "workmanship", "quality", "supervision", "مقاول", "موقع", "تنفيذ"] },
  { path: "/images/pages/about/workshop.webp", en: "Stone cutting and preparation in the workshop", ar: "قص وتجهيز الحجر في الورشة", tags: ["cutting", "cut", "workshop", "fabrication", "thickness", "finish", "honed", "polished", "sample", "samples", "قص", "ورشة", "سماكة", "تشطيب", "عينة"] },
  { path: "/images/pages/projects/institutional-1.webp", en: "Natural stone wall cladding", ar: "تركيب الحجر الطبيعي على جدار", tags: ["natural stone", "limestone", "travertine", "texture", "colour", "color", "choose", "choosing", "حجر طبيعي", "ترافرتين", "اختيار", "لون"] },
  { path: "/images/pages/home/service-stone-cladding.webp", en: "Building with natural stone facade cladding", ar: "مبنى بواجهة من الحجر الطبيعي", tags: ["stone cladding", "facade", "façade", "exterior", "building", "heat", "sun", "واجهات", "واجهة", "تركيب"] },
  { path: "/images/pages/home/hero.webp", en: "Porcelain and stone cladding on a residential tower", ar: "تركيب بورسلان وحجر على برج سكني", tags: ["porcelain", "tower", "high-rise", "apartment", "panel", "بورسلان", "برج"] },
  { path: "/images/pages/projects/commercial-1.webp", en: "Commercial tower with a light-coloured facade", ar: "برج تجاري بواجهة فاتحة", tags: ["commercial", "office", "tower", "developer", "تجاري", "مكاتب", "مطور"] },
  { path: "/images/pages/projects/commercial-2.webp", en: "Marble cladding at a building entrance", ar: "تركيب رخام عند مدخل مبنى", tags: ["marble", "entrance", "lobby", "wall", "granite", "رخام", "جرانيت", "مدخل"] },
  { path: "/images/pages/projects/residential-1.webp", en: "Villa with a decorative stone facade", ar: "فيلا بواجهة حجرية مزخرفة", tags: ["villa", "residential", "home", "house", "najdi", "classic", "فيلا", "فلل", "سكني"] },
];
async function sitePhoto(post: any) {
  const text = `${post.title} ${post.title} ${post.title} ${(post.keywords || []).join(" ")} ${(post.keywords || []).join(" ")} ${String(post.body || "").slice(0, 3000)}`.toLowerCase();
  const { data: used } = await db.from("blog_posts").select("image_url").neq("id", post.id).neq("id", post.twin_id ?? post.id).not("image_url", "is", null);
  const taken = new Set((used || []).map((r: any) => r.image_url));
  const best = PHOTOS.map((p, i) => ({ p, i, s: p.tags.reduce((n, t) => n + text.split(t).length - 1, 0) - (taken.has(SITE + p.path) ? 3 : 0) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)[0].p;
  return { url: SITE + best.path, alt: post.lang === "ar" ? best.ar : best.en, alt_ar: best.ar, alt_en: best.en };
}
let aiPicturesOffUntil = 0; // after "no quota", do not ask Google again for an hour

async function picture(post: any) {
  if (Date.now() < aiPicturesOffUntil) return useSitePhoto(post, "Google AI pictures are not on for this key yet");
  let pic;
  try { pic = await makePicture(post); }
  catch (e) {
    const why = String((e as Error).message || e);
    if (/\b429\b|quota|billing/i.test(why)) aiPicturesOffUntil = Date.now() + 3600e3;
    return useSitePhoto(post, why);
  }
  const ext = pic.mime.includes("jpeg") || pic.mime.includes("jpg") ? "jpg" : pic.mime.includes("webp") ? "webp" : "png";
  const path = `${post.slug || post.id}-${Date.now().toString(36)}.${ext}`;
  const { error } = await db.storage.from("blog").upload(path, pic.bytes, { contentType: pic.mime, upsert: true, cacheControl: "31536000" });
  if (error) throw new Error("Saving the picture: " + error.message);
  const url = db.storage.from("blog").getPublicUrl(path).data.publicUrl;
  const alt = String(post.title).slice(0, 120);
  await db.from("blog_posts").update({ image_url: url, image_alt: alt, updated_at: new Date().toISOString() }).eq("id", post.id);
  // the twin shows the same picture, with its own words
  if (post.twin_id) {
    const { data: tw } = await db.from("blog_posts").select("title").eq("id", post.twin_id).maybeSingle();
    await db.from("blog_posts").update({ image_url: url, image_alt: String(tw?.title || alt).slice(0, 120), updated_at: new Date().toISOString() }).eq("id", post.twin_id);
  }
  return { image_url: url, image_alt: alt, model: pic.model };
}

async function useSitePhoto(post: any, why: string) {
  console.error("blog-media: AI picture not made, using a website photo -", why.slice(0, 200));
  const ph = await sitePhoto(post);
  const now = new Date().toISOString();
  await db.from("blog_posts").update({ image_url: ph.url, image_alt: ph.alt, updated_at: now }).eq("id", post.id);
  if (post.twin_id) {
    const { data: tw } = await db.from("blog_posts").select("lang").eq("id", post.twin_id).maybeSingle();
    await db.from("blog_posts").update({ image_url: ph.url, image_alt: tw?.lang === "ar" ? ph.alt_ar : ph.alt_en, updated_at: now }).eq("id", post.twin_id);
  }
  return { image_url: ph.url, image_alt: ph.alt, model: "website-photo", note: "Google AI pictures need billing on the Google key; a photo from the company website was used." };
}


// ───────── "Boost to Top 3": upgrade the page that is close to Google's top 3 for one search ─────────
// The AI rewrites and expands the live page (an ERP post, or a hand-made page of the website) with the company profile's
// facts, a price and material table (prices only from the owner), a 5-question FAQ and links to the main service pages.
// The result is always a Draft: nothing changes on the website until the owner reads it and presses Publish.
const AR_RULE = `In Arabic, cladding work is always called تركيب (تركيب حجر، تركيب رخام، تركيب جرانيت، تركيب بورسلان، تركيب واجهات حجر) - never تكسية or تكسيات, because Saudi clients search for تركيب. The company's Arabic name is "شركة السواطي للمقاولات".`;
// main pages are never replaced by an article: a boost for them writes a new article aimed at the search instead
const MAIN_PAGES = new Set(["/", "/ar/", "/blog/", "/ar/blog/", "/contact/", "/ar/contact/", "/about/", "/ar/about/", "/projects/", "/ar/projects/", "/privacy/", "/ar/privacy/", "/terms/", "/ar/terms/"]);
const normPath = (t: string) => { let s = String(t || "").trim().replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0]; if (!s.startsWith("/")) s = "/" + s; if (!/\.[a-z0-9]+$/i.test(s) && !s.endsWith("/")) s += "/"; return s; };
const pathOfPost = (p: any) => (p.target_path ? normPath(p.target_path) : p.lang === "ar" ? `/ar/blog/${String(p.slug).replace(/-ar$/, "")}/` : `/blog/${p.slug}/`);
const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

/** A live page's title, description, hero picture and main text as simple markdown, for the AI to start from. */
// Page furniture that the website adds by itself: a "Back to Blog" link and the category / date / author line.
const CHROME = /^\[[^\]]*\]\((?:https:\/\/al-swaticontracting\.com)?(?:\/ar)?\/blog\/\)$|[▣👤]/u;
const tidyBody = (s: string, ar: boolean) => {
  const l = s.split("\n");
  while (l.length && (!l[0].trim() || /^# /.test(l[0]) || CHROME.test(l[0].trim()))) l.shift();
  const out = l.filter((x) => !/^# /.test(x)).join("\n").trim(); // the page has its own title (h1)
  return ar ? out.replace(/\[→\s*/g, "[").replace(/\s*→\]/g, "]") : out; // a right arrow points backwards in Arabic
};
const tidyTitle = (t: string) => String(t).replace(/\s*[|·–—-]\s*(?:شركة\s+)?(?:ال)?سواطي[^|]*$/u, "").replace(/\s*[|·–—-]\s*Al[- ]?Swati[^|]*$/i, "").trim(); // the website adds the name

function pageText(html: string) {
  const meta = (n: string) => decode((html.match(new RegExp(`<meta (?:name|property)="${n}" content="([^"]*)"`, "i")) || [])[1] || "");
  const main = (html.match(/<main[\s\S]*?<\/main>/i) || [html.replace(/^[\s\S]*?<body[^>]*>/i, "")])[0];
  const img = (main.match(/<img[^>]+src="([^"]+)"/i) || [])[1] || meta("og:image");
  const md = main.replace(/<(script|style|svg|form|noscript|iframe|canvas)[\s\S]*?<\/\1>/gi, "")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n\n").replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n")
    .replace(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/gi, "\n\n### $1\n\n").replace(/<summary[^>]*>([\s\S]*?)<\/summary>/gi, "\n\n### $1\n\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m: string, h: string, t: string) => { const x = t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); return x ? `[${x}](${h})` : ""; })
    .replace(/<li[^>]*>/gi, "\n- ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|ul|ol|section|article|details|figcaption|tr|td|th)>/gi, "\n").replace(/<[^>]+>/g, " ");
  let lines = decode(md).split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim());
  const h1 = lines.findIndex((l) => /^# /.test(l)); // only the article: the build adds the title, date line and back link itself
  if (h1 >= 0 && h1 < 15) lines = lines.slice(h1 + 1);
  const body = lines.filter((l) => !CHROME.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const title = decode((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "").replace(/\s*\|[^|]*$/, "").trim();
  return { title, meta_description: meta("description"), body, image: img ? (img.startsWith("/") ? SITE + img : img) : null, image_alt: title };
}

async function boost(b: any) {
  const q = String(b.query || "").trim().slice(0, 200), path = normPath(b.page || "");
  if (!q || !b.page) throw new Error("Pick a search from the list first.");
  const ar = path.startsWith("/ar/"), main = MAIN_PAGES.has(path);
  const { data: live } = await db.from("blog_posts").select("*").eq("status", "Published");
  const orig = (live || []).find((p: any) => pathOfPost(p) === path) || null;
  let cur: any;
  if (orig) cur = { title: orig.title, meta_description: orig.meta_description, body: orig.body, image: orig.image_url, image_alt: orig.image_alt };
  else {
    const r = await fetch(SITE + path, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`The page ${path} could not be read (${r.status}).`);
    cur = pageText(await r.text());
  }
  const { data: pr } = await db.from("preferences").select("value").eq("key", "company_profile").maybeSingle();
  const co = pr?.value || {}, prices = String(co.price_table || "").trim();
  const links = [["/stone-cladding-riyadh/", ar ? "تركيب الحجر في الرياض" : "stone cladding in Riyadh"], ["/marble-installation-riyadh/", ar ? "تركيب الرخام في الرياض" : "marble installation in Riyadh"], ["/contact/#contact-form", ar ? "اطلب عرض سعر مجاني" : "request a free quote"]]
    .map(([p, t]) => [(ar ? "/ar" : "") + p, t]).filter(([p]) => p.split("#")[0] !== path); // no link from a page to itself
  const year = new Date().getFullYear();
  const priceHead = ar ? `أسعار ومقارنة مواد التركيب في الرياض ${year}` : `${year} Riyadh price and material comparison`;
  const faqHead = ar ? "الأسئلة الشائعة" : "Frequently asked questions";
  const cols = ar ? ["المادة", "التوريد والتركيب بالتثبيت الميكانيكي (ريال/م²)", "الأنسب لـ", "ملاحظات"] : ["Material", "Supply & installation with mechanical fixing (SAR/m²)", "Best for", "Notes"];
  const prompt = `You improve one page of the website of ${COMPANY}, so it can reach the top 3 on Google in Saudi Arabia for the search "${q}" (its average position now: ${b.position ?? "unknown"}).
Write the complete new version of the page in ${ar ? "Arabic: clear Modern Standard Arabic the way Saudi companies write on their own websites. " + AR_RULE : "English: clear, natural, professional English for clients in Saudi Arabia."}
COMPANY FACTS (the ONLY facts you may state about the company; never invent projects, clients, numbers, years, certificates or prices):
${JSON.stringify({ name: co.name, services: co.services, cities: co.cities, phone: co.phone, email: co.email, facts: co.about })}
RULES
- Keep what is true and useful on the current page and expand it to about 1100-1500 words of specific, practical help for villa owners, developers and commercial contractors in Riyadh. Use the search phrase "${q}" in the title, in the first paragraph and in one "## " heading, naturally - no keyword stuffing.
${NO_FLOORING}
- "## " headings and short paragraphs. Use the company facts where they help the reader decide, worded only as the facts say.
- Add a section "## ${priceHead}" with a markdown table with exactly these columns: | ${cols.join(" | ")} | and these rows in this order: ${ar ? "حجر الرياض الطبيعي، الرخام، الجرانيت، البورسلان" : "Natural Riyadh stone, Marble, Granite, Porcelain"}.
  ${prices ? `For the price cells use exactly these ranges from the owner, unchanged: ${prices}` : `The owner has not given prices yet: write exactly "[SAR ___–___]" in every price cell. Never guess or invent a price.`}
  Under the table, one sentence: the final price depends on the stone grade, thickness, panel size, building height and quantity, and comes with a free site visit and written quote.
- Add a section "## ${faqHead}" with exactly 5 questions that Riyadh villa owners and commercial contractors really ask about this search, each written as "### <question>" followed by a 2-3 sentence answer (facts only from this page and the company facts).
- Link from the text, with natural words, to: ${links.map(([p, t]) => `[${t}](${p})`).join(", ")} - use these exact paths.
- End with a short contact paragraph (phone / WhatsApp / email from the facts).
- Start with the first paragraph of the article: no "# " title, no back link and no date, category or author line - the website adds those itself.
- Title: at most 60 characters, with the search phrase, without the company name (the website adds it). Search description: 120-155 characters, with the search phrase. Keywords: 4-8 search phrases.
Answer in exactly this form and nothing else:
TITLE: <title>
META: <search description>
KEYWORDS: <phrase>, <phrase>, <phrase>
---
<the whole page in markdown>

CURRENT PAGE (${SITE}${path}):
TITLE: ${cur.title}
DESCRIPTION: ${cur.meta_description || ""}
---
${String(cur.body || "").slice(0, 14000)}`;
  let out: any;
  try { out = parsePost(await (CLAUDE_KEY ? claude(prompt, 9000, 140000) : geminiText(prompt, 9000))); }
  catch (e) { if (!GEMINI_KEY || !CLAUDE_KEY) throw e; out = parsePost(await geminiText(prompt, 9000)); } // second chance with the other AI
  const body = tidyBody(String(out.body || ""), ar);
  out.title = tidyTitle(out.title || "");
  if (!out.title || body.split(/\s+/).length < 450) throw new Error("The upgraded page came back too short. Try again.");
  const rnd = Date.now().toString(36).slice(-4);
  let slug: string, target_path: string | null = null, revision_of: string | null = null, note: string;
  if (orig) { revision_of = orig.id; slug = `${String(orig.slug).replace(/-ar$/, "").slice(0, 60)}-top3-${rnd}${ar ? "-ar" : ""}`; note = "Publish copies this text into the live post (same address) and refreshes its other-language version."; }
  else if (main) { slug = `${slugify(out.title) || "post-" + rnd}${ar ? "-ar" : ""}`; note = `${path} is a main page and stays as it is: this is a new article aimed at "${q}".`; }
  else { target_path = path; slug = `upgrade-${path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60)}-${rnd}`; note = `Publish replaces the live page ${path} with this version (same address). Unpublish puts the old page back.`; }
  if (!main) { // one waiting upgrade per page: a new boost replaces the older draft
    const old = db.from("blog_posts").delete().eq("status", "Draft").eq("source", "boost");
    await (target_path ? old.eq("target_path", target_path) : old.eq("revision_of", revision_of));
  }
  const { data: same } = await db.from("blog_posts").select("id").eq("slug", slug).maybeSingle();
  if (same) slug = `${slug.replace(/-ar$/, "").slice(0, 70)}-${rnd}${ar ? "-ar" : ""}`;
  const { data: row, error } = await db.from("blog_posts").insert({
    slug, lang: ar ? "ar" : "en", title: String(out.title).slice(0, 90), meta_description: String(out.meta_description || "").slice(0, 170),
    keywords: (out.keywords || []).slice(0, 8), body, status: "Draft", source: "boost", target_path, revision_of, boost_query: q,
    image_url: main ? null : cur.image || null, image_alt: main ? null : String(cur.image_alt || out.title).slice(0, 120), created_by: USER_ID,
  }).select().single();
  if (error) throw new Error("Saving the upgrade: " + error.message);
  return { post: row, note, prices_missing: !prices };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({}));
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: u } = await user.auth.getUser();
    if (!u?.user) return json({ error: "Sign in first" }, 401);
    const { data: prof } = await db.from("profiles").select("role, active, must_change").eq("id", u.user.id).single();
    if (!prof?.active || prof.must_change || prof.role !== "admin") return json({ error: "Only Super-Admin" }, 403);
    if (u.user.last_sign_in_at && Date.parse(u.user.last_sign_in_at) < Date.now() - 7 * 864e5) return json({ error: "Please sign in again." }, 401);
    USER_ID = u.user.id; TASK = "blog_" + String(body.action || "");

    if (body.action === "boost") return json(await boost(body));

    const { data: post } = await db.from("blog_posts").select("*").eq("id", String(body.id || "")).maybeSingle();
    if (!post) return json({ error: "Post not found" }, 404);

    // after a Top-3 upgrade was copied into a post: write its other-language version again from the new text
    if (body.action === "retwin") {
      if (!post.twin_id) return json({ skipped: true });
      const { data: tw } = await db.from("blog_posts").select("*").eq("id", post.twin_id).maybeSingle();
      if (!tw) return json({ skipped: true });
      const a = post.lang !== "ar" ? await arabic(post) : await english(post);
      const { data: up, error } = await db.from("blog_posts").update({
        title: String(a.title).slice(0, 90), meta_description: String(a.meta_description || "").slice(0, 170),
        keywords: (Array.isArray(a.keywords) ? a.keywords : []).map((k: any) => String(k).trim()).filter(Boolean).slice(0, 8), body: String(a.body),
        image_url: post.image_url || tw.image_url, updated_at: new Date().toISOString(),
      }).eq("id", tw.id).select().single();
      if (error) throw new Error("Updating the other language: " + error.message);
      return json({ post: up, refreshed: true });
    }

    if (body.action === "image") return json(await picture(post));

    if (body.action === "arabic" || body.action === "twin") {
      if (post.twin_id) { const { data: tw } = await db.from("blog_posts").select("*").eq("id", post.twin_id).maybeSingle(); if (tw) return json({ post: tw, existed: true }); }
      const toAr = post.lang !== "ar";
      const a = toAr ? await arabic(post) : await english(post);
      // the Arabic page lives at /ar/blog/<slug without -ar>/, the English one at /blog/<slug>/
      // (an Arabic original named "x-ar" gives its English twin "x"; otherwise the English name comes from the English title)
      const base = String(post.slug || "").replace(/-ar$/, "");
      let slug = toAr ? `${post.slug || "post"}-ar`.slice(0, 80)
        : (String(post.slug).endsWith("-ar") && /^[a-z0-9-]+$/.test(base) ? base : slugify(a.title)) || "post-" + Date.now().toString(36);
      const { data: same } = await db.from("blog_posts").select("id").eq("slug", slug).maybeSingle();
      if (same) slug = toAr ? `${base || "post"}-${Date.now().toString(36).slice(-4)}-ar`.slice(0, 80) : slug.slice(0, 74) + "-" + Date.now().toString(36).slice(-4);
      const now = new Date().toISOString();
      const { data: tw, error } = await db.from("blog_posts").insert({
        slug, lang: toAr ? "ar" : "en", title: String(a.title).slice(0, 90), meta_description: String(a.meta_description || "").slice(0, 170),
        keywords: (Array.isArray(a.keywords) ? a.keywords : []).map((k: any) => String(k).trim()).filter(Boolean).slice(0, 8), body: String(a.body),
        status: post.status, published_at: post.status === "Published" ? (post.published_at || now) : null, source: post.source || "manual",
        image_url: post.image_url, image_alt: post.image_url ? String(a.title).slice(0, 120) : null, twin_id: post.id, created_by: USER_ID,
      }).select().single();
      if (error) throw new Error(`Saving the ${toAr ? "Arabic" : "English"} post: ` + error.message);
      await db.from("blog_posts").update({ twin_id: tw.id }).eq("id", post.id);
      return json({ post: tw });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("blog-media", TASK, String((e as Error).message || e)); // shows in the function's Logs
    return json({ error: String((e as Error).message || e).slice(0, 400) }, 500);
  }
});
