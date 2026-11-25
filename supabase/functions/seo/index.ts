// Edge Function "seo": the SEO autopilot for al-swaticontracting.com. It reports to the main agent (morning briefing).
//  • "tick"  (server clock, every morning; harmless to call more often): pulls Google Search Console numbers, works out which
//            searches are close to page 1, writes the weekly report, drafts one blog post a day from the week's 2 topics
//            (the owner reads it and presses Publish), and reminds about Google reviews for finished projects.
//  • "lead"  (public, from the website quote form): the request goes straight into Queries, source "website".
//  • "event" (public, from the website): counts WhatsApp / call / email clicks per page. No names are kept.
//  • "run"   (Super-Admin): run the tick now ({force:"weekly"} also redoes the weekly report and topics).
//  • "google_status" / "google_start" / "google_finish" / "google_disconnect" (Super-Admin): the owner's own "Sign in with Google"
//            for Search Console (reads Google's numbers, resubmits the sitemap), used when no service-account key exists (the
//            company's Google blocks those keys).
//  • "index_ping" (public, from the website build once GitHub Pages has published): tells IndexNow (Bing, Yandex and the other
//            IndexNow engines) about new or changed pages and resubmits the sitemap to Google Search Console.
//  • "index_reping" / "index_check" (Super-Admin, Growth): ping one page again; read Google's own index status (URL Inspection).
//  • "video_ideas" (Super-Admin, Growth → Videos): write video ideas now. The tick also writes 2 a week while fewer than 4 wait.
// Nothing is ever published or sent by itself: posts wait for Publish, review messages wait for the owner to send them.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info" };
const URL_ = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const AR_WORDS = `In Arabic, cladding work is always called تركيب (تركيب حجر، تركيب رخام، تركيب جرانيت، تركيب بورسلان، تركيب واجهات حجر) - never تكسية or تكسيات, because Saudi clients search for تركيب. The company's Arabic name is "شركة السواتي للمقاولات".`;
const SITE = "https://al-swaticontracting.com";
const GSC_SITE = Deno.env.get("GSC_SITE") ?? "sc-domain:al-swaticontracting.com";
// The owner's own "Sign in with Google" (Search Console: read the numbers, resubmit the sitemap). The client id is public (it is in every sign-in link);
// the client secret lives only in the server's secrets (GOOGLE_OAUTH_SECRET); the renewable sign-in sits in the locked table google_link.
const G_CLIENT = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "479124517333-jc3h1mj0gr1hstpkf8aorg2jof0efa04.apps.googleusercontent.com";
const G_SECRET = Deno.env.get("GOOGLE_OAUTH_SECRET") ?? "";
const APP_URL = "https://hussainkhan-maker.github.io/al-swati-erp/";
const G_SCOPE = "openid email https://www.googleapis.com/auth/webmasters"; // read + resubmit the sitemap (older sign-ins can only read)
const REVIEW_LINK = "https://search.google.com/local/writereview?placeid=ChIJAZHiKg0cOaoRQl8W3DNsZ9I";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const FAST = Deno.env.get("AI_MODEL_FAST") ?? "claude-haiku-5-5";
// Free Gemini (with Google Search) when it is set up, else the cheap Claude model. AI_MODEL_SEO can choose another.
const SEO_MODEL = Deno.env.get("AI_MODEL_SEO") ?? (FAST.startsWith("gemini") ? FAST : "claude-haiku-5-5");
const MAX_WAITING_DRAFTS = 4; // the owner has not read these yet: stop writing more until he does

type Item = { level: "bad" | "warn"; text: string };
const H = 3600e3, D = 864e5;
const riyadhDay = (t = Date.now()) => new Date(t + 3 * H).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * D).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const clean = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);

async function getState(): Promise<any> {
  const { data } = await db.from("preferences").select("value").eq("key", "seo_state").maybeSingle();
  return (data?.value as any) || {};
}
async function saveState(s: any) {
  const { error } = await db.from("preferences").upsert({ key: "seo_state", value: s, updated_at: new Date().toISOString() });
  if (error) throw new Error("save: " + error.message);
}

// ───────── AI: Gemini first (free), Claude Haiku if Gemini is busy or not set up ─────────
async function write(task: string, prompt: string, o: { max?: number; search?: boolean } = {}): Promise<string> {
  const system = "You work for Al-Swati Contracting, a contractor for natural stone, marble, granite and porcelain cladding of facades and walls, installed with mechanical (dry-fix) fixing systems, in Riyadh, Saudi Arabia (website al-swaticontracting.com, English and Arabic). The company does NOT do flooring, floor tiles or paving: never write about them as its work. Never invent facts about the company.";
  const log = (model: string, i: number, out: number) => db.from("ai_usage").insert({ task: "seo_" + task, model, input_tokens: i || 0, output_tokens: out || 0 }).then(() => {}, () => {});
  if (GEMINI_KEY && SEO_MODEL.startsWith("gemini")) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${SEO_MODEL}:generateContent`, {
          method: "POST", signal: AbortSignal.timeout(90000),
          headers: { "x-goog-api-key": GEMINI_KEY, "content-type": "application/json" },
          body: JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: prompt }] }],
            ...(o.search ? { tools: [{ google_search: {} }] } : {}), generationConfig: { maxOutputTokens: Math.max(o.max ?? 2000, 8192) } }),
        });
        if (r.ok) {
          const j = await r.json(), u = j.usageMetadata || {};
          await log(SEO_MODEL, u.promptTokenCount, (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0));
          const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
          if (text) return text;
        } else if (![429, 500, 503].includes(r.status)) { console.error("Gemini", r.status, (await r.text()).slice(0, 200)); break; }
      } catch (e) { console.error("Gemini failed:", e); }
      await sleep(2000);
    }
  }
  const model = SEO_MODEL.startsWith("gemini") ? "claude-haiku-5-5" : SEO_MODEL;
  const call = (noThink: boolean) => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: o.max ?? 2000, system, messages: [{ role: "user", content: prompt }], ...(noThink ? { thinking: { type: "disabled" } } : {}) }),
  });
  let r = await call(true);
  if (r.status === 400 && /thinking/i.test(await r.clone().text())) r = await call(false);
  if (!r.ok) throw new Error(`AI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  await log(model, j.usage?.input_tokens, j.usage?.output_tokens);
  return (j.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
}
function asJson(t: string) {
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/), s = fence ? fence[1] : t.slice(t.indexOf("{"));
  return JSON.parse(s.slice(0, s.lastIndexOf("}") + 1));
}

// ───────── Google Search Console (a service-account key if one exists, else the owner's own Google sign-in) ─────────
async function googleToken(write = false): Promise<string | null> {
  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT");
  if (!raw) return ownerToken();
  const sa = JSON.parse(raw), now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({ alg: "RS256", typ: "JWT" }) + "." + enc({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/webmasters" + (write ? "" : ".readonly"), aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const der = Uint8Array.from(atob(String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + b64url(sig) }) });
  if (!r.ok) throw new Error("Google sign-in " + r.status + ": " + (await r.text()).slice(0, 160));
  return (await r.json()).access_token;
}
const gLink = async () => (await db.from("google_link").select("*").eq("id", 1).maybeSingle()).data || null;
const saveGLink = async (patch: Record<string, unknown>) => { await db.from("google_link").upsert({ id: 1, ...patch, updated_at: new Date().toISOString() }); };
async function gTokenCall(params: Record<string, string>) {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: G_CLIENT, client_secret: G_SECRET, ...params }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Google sign-in " + r.status + ": " + String(j.error_description || j.error || "").slice(0, 160));
  return j;
}
/** The owner's Google sign-in, renewed for each run. ownerScope: what he allowed (a sign-in from before 25 Nov 2026 can only read). */
let ownerScope = "";
const canWrite = () => !!Deno.env.get("GOOGLE_SERVICE_ACCOUNT") || /(^|\s)https:\/\/www\.googleapis\.com\/auth\/webmasters(\s|$)/.test(ownerScope);
async function ownerToken(): Promise<string | null> {
  const L = await gLink();
  if (!L?.refresh_token || !G_SECRET) return null;
  try { const j = await gTokenCall({ grant_type: "refresh_token", refresh_token: L.refresh_token }); ownerScope = String(j.scope || ""); return j.access_token; }
  catch (e) { await saveGLink({ last_error: String((e as Error).message).slice(0, 300) }); throw e; }
}
async function googleStart() {
  if (!G_SECRET) throw new Error("One step is left: the Google client secret must be saved in Supabase (Edge Functions → Secrets → GOOGLE_OAUTH_SECRET).");
  const state = "g." + b64url(crypto.getRandomValues(new Uint8Array(16))), verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  await saveGLink({ pkce: JSON.stringify({ state, verifier }), pkce_expires: new Date(Date.now() + 15 * 60e3).toISOString() });
  const q = new URLSearchParams({ client_id: G_CLIENT, redirect_uri: APP_URL, response_type: "code", scope: G_SCOPE, state, code_challenge: challenge,
    code_challenge_method: "S256", access_type: "offline", prompt: "consent" });
  return { url: "https://accounts.google.com/o/oauth2/v2/auth?" + q };
}
async function googleFinish(p: any) {
  if (p.error) throw new Error("Google: " + clean(p.error_description || p.error, 200));
  const L = await gLink(), k = L?.pkce ? JSON.parse(L.pkce) : null;
  if (!k || k.state !== p.state || !L?.pkce_expires || Date.parse(L.pkce_expires) < Date.now()) throw new Error('This Google sign-in has expired. Press "Sign in with Google" again.');
  const j = await gTokenCall({ grant_type: "authorization_code", code: clean(p.code, 2000), code_verifier: k.verifier, redirect_uri: APP_URL });
  if (!j.refresh_token) throw new Error('Google did not give a lasting sign-in. Press "Sign in with Google" again.');
  let account = "";
  try { const x = String(j.id_token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); account = JSON.parse(atob(x + "===".slice((x.length + 3) % 4))).email || ""; } catch { /* no email in the answer */ }
  const r = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE)}`, { headers: { authorization: "Bearer " + j.access_token } });
  if (!r.ok) throw new Error(`${account || "This Google account"} cannot open ${GSC_SITE.replace("sc-domain:", "")} in Search Console. Sign in with the account that has it.`);
  await saveGLink({ account, refresh_token: j.refresh_token, pkce: null, pkce_expires: null, connected_at: new Date().toISOString(), last_error: null });
  return { done: true, account };
}
type GRow = { keys: string[]; clicks: number; impressions: number; position: number };
async function gsc(token: string, body: unknown): Promise<GRow[]> {
  const r = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE)}/searchAnalytics/query`, {
    method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("Search Console " + r.status + ": " + (await r.text()).slice(0, 160));
  return (await r.json()).rows || [];
}
/** Brings in the last days (the first time: 4 months). Google keeps changing the newest 2-3 days, so they are fetched again. */
async function pull(s: any): Promise<number> {
  const token = await googleToken();
  if (!token) { s.google = { linked: false }; return 0; }
  const from = s.last_pull ? daysAgo(7) : daysAgo(120), to = daysAgo(0);
  const [rows, days] = await Promise.all([
    gsc(token, { startDate: from, endDate: to, dimensions: ["date", "query", "page"], rowLimit: 25000, dataState: "all" }),
    gsc(token, { startDate: from, endDate: to, dimensions: ["date"], rowLimit: 500, dataState: "all" }),
  ]);
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await db.from("seo_rows").upsert(rows.slice(i, i + 1000).map((r) => ({ day: r.keys[0], query: r.keys[1].slice(0, 300), page: r.keys[2].slice(0, 300), clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 100) / 100 })));
    if (error) throw new Error("seo_rows: " + error.message);
  }
  if (days.length) {
    const { error } = await db.from("seo_days").upsert(days.map((r) => ({ day: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 100) / 100 })));
    if (error) throw new Error("seo_days: " + error.message);
  }
  s.google = { linked: true };
  s.last_pull = new Date().toISOString();
  return rows.length;
}

// ───────── The numbers the agent works from (last 28 days against the 28 before) ─────────
async function all(table: string, cols: string, since: string, dayCol = "day") {
  const out: any[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db.from(table).select(cols).gte(dayCol, since).order(dayCol).range(i, i + 999);
    if (error) throw new Error(table + ": " + error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}
async function analyse() {
  const cut = daysAgo(28), short = (u: string) => u.replace(SITE, "") || "/";
  const [rows, days, ev] = await Promise.all([
    all("seo_rows", "day, query, page, clicks, impressions, position", daysAgo(56)),
    all("seo_days", "day, clicks, impressions, position", daysAgo(56)),
    all("web_events", "at, kind, page, ref", new Date(Date.now() - 28 * D).toISOString(), "at"),
  ]);
  type Agg = { c: number; i: number; p: number; pages: Record<string, number> };
  const now: Record<string, Agg> = {}, before: Record<string, Agg> = {}, pages: Record<string, { c: number; i: number }> = {};
  for (const r of rows) {
    const m = r.day >= cut ? now : before, a = (m[r.query] ??= { c: 0, i: 0, p: 0, pages: {} });
    a.c += r.clicks; a.i += r.impressions; a.p += Number(r.position) * r.impressions; a.pages[r.page] = (a.pages[r.page] || 0) + r.impressions;
    if (r.day >= cut) { const g = (pages[short(r.page)] ??= { c: 0, i: 0 }); g.c += r.clicks; g.i += r.impressions; }
  }
  const pos = (a?: Agg) => (a && a.i ? r1(a.p / a.i) : null);
  const list = Object.entries(now).map(([q, a]) => ({ q, clicks: a.c, impr: a.i, pos: pos(a)!, was: pos(before[q]),
    page: short(Object.entries(a.pages).sort((x, y) => y[1] - x[1])[0]?.[0] || "") }));
  const sum = (xs: any[], k: string) => xs.reduce((t, x) => t + Number(x[k] || 0), 0);
  const dn = days.filter((x) => x.day >= cut), db4 = days.filter((x) => x.day < cut);
  const avgPos = (xs: any[]) => { const i = sum(xs, "impressions"); return i ? r1(xs.reduce((t, x) => t + Number(x.position) * x.impressions, 0) / i) : null; };
  const recent = ev.filter((e) => Date.parse(e.at) > Date.now() - 7 * D);
  const count = (xs: any[], k: string) => xs.reduce((m: Record<string, number>, x) => { m[x[k] || "?"] = (m[x[k] || "?"] || 0) + 1; return m; }, {});
  return {
    at: new Date().toISOString(),
    totals: { clicks: sum(dn, "clicks"), impressions: sum(dn, "impressions"), position: avgPos(dn),
      clicks_before: sum(db4, "clicks"), impressions_before: sum(db4, "impressions"), position_before: avgPos(db4), days: dn.length },
    striking: list.filter((x) => x.pos >= 4 && x.pos <= 30 && x.impr >= 3).sort((a, b) => b.impr - a.impr).slice(0, 12),
    top: [...list].sort((a, b) => b.clicks - a.clicks || b.impr - a.impr).slice(0, 10),
    up: list.filter((x) => x.was != null && x.was - x.pos >= 3).sort((a, b) => (b.was! - b.pos) - (a.was! - a.pos)).slice(0, 5),
    down: list.filter((x) => x.was != null && x.pos - x.was >= 3 && x.impr >= 3).sort((a, b) => (b.pos - b.was!) - (a.pos - a.was!)).slice(0, 5),
    pages: Object.entries(pages).map(([p, g]) => ({ p, clicks: g.c, impr: g.i })).sort((a, b) => b.clicks - a.clicks || b.impr - a.impr).slice(0, 8),
    web: { week: count(recent, "kind"), month: count(ev, "kind"), by_page: Object.entries(count(ev, "page")).sort((a, b) => b[1] - a[1]).slice(0, 6), by_ref: count(ev, "ref") },
  };
}

async function sitemap(): Promise<string[]> {
  try { const t = await (await fetch(SITE + "/sitemap.xml", { signal: AbortSignal.timeout(8000) })).text(); return [...t.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]); }
  catch { return []; }
}
async function profile() {
  const { data } = await db.from("preferences").select("value").eq("key", "company_profile").maybeSingle();
  return { name: "Al-Swati Contracting", phone: "+966 51 182 6313 (call / WhatsApp)", email: "info@al-swaticontracting.com", website: SITE, ...((data?.value as any) || {}) };
}

/** Weekly: the report for the owner and the 2 blog topics (1 English, 1 Arabic) taken from real searches. */
async function weekly(s: any) {
  const a = s.summary, urls = await sitemap();
  const { data: posts } = await db.from("blog_posts").select("title, lang, keywords").order("created_at", { ascending: false }).limit(60);
  const out = asJson(await write("weekly", `${s.google?.linked && a?.totals?.days ? "Google Search Console for al-swaticontracting.com:" : "Google Search Console is NOT linked to the ERP yet: there are NO Google numbers. Never write 0 clicks or 0 impressions; say in one line that Google numbers start once it is linked, and ignore the empty Google lines below:"}
Last 28 days vs the 28 days before: ${JSON.stringify(a?.totals || {})}
Searches close to page 1 (average position 4-30): ${JSON.stringify(a?.striking || [])}
Rising: ${JSON.stringify(a?.up || [])} Falling: ${JSON.stringify(a?.down || [])}
Pages with most clicks: ${JSON.stringify(a?.pages || [])}
Website quote-form leads and WhatsApp/call/email clicks (last 7 days, last 28 days): ${JSON.stringify(a?.web || {})}
Pages already on the website: ${urls.join(" ").slice(0, 3000)}
Blog posts already written: ${JSON.stringify((posts || []).map((p: any) => p.title)).slice(0, 2500)}

1) Write the owner's weekly SEO report in ROMAN URDU (Urdu written in English letters, like \"Is hafte Google par 12 clicks aaye, pichle mahine se 3 zyada\"), never in English sentences. Numbers as digits, at most 5 short lines: how the website did (clicks, impressions, average position, change), the 2-3 searches closest to page 1, website leads, and the 2 blog drafts you will write this week. Do not promise any other work. Use only the numbers above.
2) Choose exactly 2 new blog topics, 1 English and 1 Arabic, that target real searches above (prefer phrases with impressions at position 5-30) and are not already covered by a page or post. With no data yet, choose phrases clients in Riyadh really type when they need a stone, marble, granite or porcelain cladding contractor (facades and walls, mechanical dry-fix fixing). Every topic must be about cladding of facades or walls with natural stone, marble, granite or porcelain, or about mechanical (dry-fix) fixing - never about flooring, floor tiles, paving, stairs or countertops, even if such searches appear above. Practical and useful, never clickbait.
Return JSON only: {"report":"<lines separated by \\n>","topics":[{"title":"","lang":"en|ar","keyword":"<main search phrase>","why":"<one line, Roman Urdu>"}]}`, { max: 1500 }));
  s.report = { at: new Date().toISOString(), text: String(out.report || "").slice(0, 1200) };
  s.queue = (out.topics || []).filter((t: any) => t?.title).slice(0, 2).map((t: any) => ({ title: clean(t.title, 120), lang: t.lang === "ar" ? "ar" : "en", keyword: clean(t.keyword || t.title, 100), why: clean(t.why, 200) }));
  s.last_week = new Date().toISOString();
}

/** One blog draft from the queue. It stays a Draft until the owner reads it and presses Publish in Growth. */
async function draftOne(s: any) {
  const t = s.queue?.[0];
  if (!t) return null;
  const urls = (await sitemap()).filter((u) => (t.lang === "ar") === u.includes("/ar/") || (t.lang === "ar" && /\/ar$/.test(u)));
  const p = await profile();
  const txt = await write("blog", `Write a helpful blog post in ${t.lang === "ar" ? "Arabic (Modern Standard Arabic, natural for Saudi readers)" : "English"} for the website of this company.
Company facts (the ONLY facts you may state about the company; never invent projects, clients, years, numbers, certificates, awards or prices): ${JSON.stringify(p)}
Topic: "${t.title}". Main search phrase (people really search this on Google): "${t.keyword}".
Rules: stay on cladding of facades and walls and its mechanical fixing; never present flooring, floor tiles or paving as the company's work. Before the closing contact section, add a section "## Frequently asked questions" (in an Arabic post: "## الأسئلة الشائعة") with 3-4 questions clients really ask about this topic, each written as "### <question>" followed by a 1-3 sentence answer that repeats only facts from the article (the website turns this section into FAQ data for Google). 700-1000 words, clear headings (##), short paragraphs, practical advice for Saudi conditions (heat, sand, Saudi Building Code where relevant - only say what you are sure of; if you mention a standard or figure, check it with search). Use the search phrase naturally in the title, the first paragraph and one heading; no keyword stuffing. Where it truly helps the reader, link 2-3 of these pages of the company website as markdown links with the exact URL: ${urls.slice(0, 40).join(" ")}. End with a short, honest call to contact the company with the phone/WhatsApp and email above. Plain, human tone; no hype words like "best", "No. 1", "leading".
Answer in exactly this format and nothing else:
TITLE: <max 60 characters>
SLUG: <latin lowercase words with dashes, in English even for Arabic posts>
META: <max 155 characters>
KEYWORDS: <3-6 search phrases, comma separated>
---
<the post in markdown>`, { max: 6000, search: true });
  const head = (k: string) => ((txt.match(new RegExp("^[*#\\s]*" + k + "[*\\s]*:[*\\s]*(.+)$", "mi")) || [])[1] || "").replace(/\*+$/, "").trim();
  const body = txt.split(/^---\s*$/m).slice(1).join("---").replace(/<\/?cite[^>]*>/gi, "").trim(); // web-search citation tags out
  if (body.split(/\s+/).length < 300) throw new Error("The AI's post was too short; it will try again tomorrow.");
  let slug = (head("SLUG") || t.keyword).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "post-" + Date.now().toString(36);
  if (t.lang === "ar") slug = slug.replace(/-ar$/, "").slice(0, 67) + "-ar"; // Arabic page /ar/blog/<name>/, its English twin later /blog/<name>/
  const { data: same } = await db.from("blog_posts").select("id").eq("slug", slug).maybeSingle();
  if (same) slug = slug.replace(/-ar$/, "") + "-" + Date.now().toString(36).slice(-4) + (t.lang === "ar" ? "-ar" : "");
  const { error } = await db.from("blog_posts").insert({ slug, lang: t.lang, title: (head("TITLE") || t.title).slice(0, 90), meta_description: head("META").slice(0, 170),
    keywords: (head("KEYWORDS") || t.keyword).split(/[,،]/).map((k: string) => k.trim()).filter(Boolean).slice(0, 8), body, status: "Draft", source: "autopilot" });
  if (error) throw new Error("blog_posts: " + error.message);
  s.queue = s.queue.slice(1);
  s.last_draft = new Date().toISOString();
  return t.title;
}

/** Google reviews: when a project is closed, the owner gets a ready message for the client (he sends it himself). */
async function reviews(s: any, items: Item[]) {
  const { data: closed } = await db.from("projects").select("id, name, client").eq("status", "closed");
  const seen = (s.reviews ??= {}), first = !s.reviews_started;
  const msgs: any[] = [];
  for (const p of closed || []) {
    if (!seen[p.id]) seen[p.id] = new Date().toISOString();
    if (first || Date.now() - Date.parse(seen[p.id]) < 14 * D) msgs.push({ project: p.name, client: p.client || "",
      en: `Thank you for choosing Al-Swati Contracting for ${p.name}. If you are happy with our work, a short Google review would help us a lot: ${REVIEW_LINK}`,
      ar: `شكراً لاختياركم السواتي للمقاولات لمشروع ${p.name}. إذا كنتم راضين عن عملنا، يسعدنا تقييمكم على جوجل: ${REVIEW_LINK}` });
  }
  const fresh = (closed || []).filter((p: any) => Date.now() - Date.parse(seen[p.id]) < 3 * D && !first);
  fresh.forEach((p: any) => items.push({ level: "warn", text: `Project "${p.name}" band hua: ${p.client || "client"} se Google review maangein (Growth → SEO mein message tayyar hai)` }));
  if (first && msgs.length) items.push({ level: "warn", text: `${msgs.length} band projects ke clients se Google review maangein - abhi 0 reviews hain (Growth → SEO mein messages tayyar hain)` });
  s.reviews_started = true;
  s.review_msgs = msgs.slice(0, 20);
}

// ───────── Videos (TikTok, YouTube Shorts, Instagram Reels): ideas with script and captions; the owner posts them himself ─────────
const MIN_VIDEO_IDEAS = 4;
async function videoIdeas(n: number, source: "weekly" | "manual", s: any): Promise<number> {
  const { price_table, ...p } = await profile(); // prices change: never in a video
  const { data: old } = await db.from("video_ideas").select("title_en, keyword").order("created_at", { ascending: false }).limit(40);
  const out = asJson(await write("video_ideas", `${AR_WORDS}
Plan ${n} short vertical videos (TikTok, YouTube Shorts, Instagram Reels; 20-40 seconds each) for this company.
Company facts (the ONLY facts you may state; never invent projects, clients, numbers, prices, awards or guarantees): ${JSON.stringify(p).slice(0, 3000)}
What people search on Google (close to page 1): ${JSON.stringify(s?.summary?.striking || []).slice(0, 1500)}
Videos already planned or made (do not repeat them): ${JSON.stringify((old || []).map((o: any) => o.title_en)).slice(0, 1500)}
Informative videos only for now: each one explains how something works, why, or what to check. No sales lines (never "your villa deserves stone", offers or "call us now"); the company name comes only on the end card.
Kinds: mostly "3d" = made automatically from AI pictures and short clips of modern Riyadh villas and buildings (Al Malqa, Al Narjis style: clean modern villas, steel-structure buildings) with stone going up: ONE fixing system step by step, or a facade going up panel by panel; and "tips" = practical advice for villa owners in Riyadh (choosing the stone, heat, white stains, maintenance, what a quote must include), also made from AI pictures. "site" = filmed with a phone on a real AL-Swati site: at most one in four ideas.
The fixing systems, exactly as the company installs them (one system per video, never mixed): Up-Down angle brackets = stainless-steel angles bolted to the wall with Hilti or Fischer anchors engage kerfs (grooves) cut in the top and bottom edges of each panel; PEN (pin) fixing = stainless-steel pins set into the panel edges, all hardware hidden; C-Channel rails = vertical aluminium rails set plumb on wall brackets, panels hang on them and each panel can be replaced on its own; kerf rail system = the stainless-steel blade of a horizontal aluminium rail slides into a groove along the panel top and bottom edges; undercut anchors = a stainless-steel anchor expands in a hole drilled in the panel back (not through it) and hangs on horizontal aluminium rails. Stainless steel grade 304 or 316 as the approved design says. Stone 30 mm (limestone, granite), marble 20 mm. No mortar behind the stone.
Arabic names to use: زوايا Up-Down، تثبيت PEN بالمسامير، مجاري C-Channel الرأسية (never السكك الحديدية, which means railways)، نظام Kerf (مجرى في حافة اللوح)، مراسي Undercut، مرساة هيلتي أو فيشر، ستانلس ستيل، تركيب حجر ميكانيكي، ثقوب (not خرام).
The only guarantee you may mention is the company's minimum 5-year written workmanship warranty; never "lifetime", "forever" or other promises.
Each video: a hook in the first 2 seconds that makes a villa owner stop scrolling (a sharp question or a surprising true fact, e.g. why white stains appear on stone, what holds a 30 mm stone panel on a wall), never clickbait; 4-6 scenes; text on screen short (at most 7 words a line) in Saudi spoken Arabic (white Saudi dialect as people in Riyadh talk: ليش، وش، كذا، ورا، ينركّب; not formal فصحى), with English under it; facts only from the company facts and the systems above. Check the Arabic spelling twice. Stay on cladding of facades and walls (stone, marble, granite, porcelain) and mechanical fixing, never flooring or paving.
Captions: TikTok caption in Arabic first, then one English line, at most 2 emoji, ending with 5-8 hashtags mixing Arabic and English (always #الرياض and #تركيب_حجر); YouTube Shorts title at most 90 characters (Arabic, then " | " and English); YouTube description 3-6 lines (Arabic, then English) with the website and the WhatsApp number from the company facts, ending with #shorts; YouTube tags comma separated.
"why" and "shots" MUST be in ROMAN URDU (Urdu written in English letters, e.g. "Log Google par 'tarkib hajar mekaniki' search karte hain, ye video unhi ke sawal ka jawab hai"), never English sentences: "why" = one line, which search or which client question this video answers.
Return JSON only: {"videos":[{"kind":"3d|site|tips","keyword":"","why":"","title_ar":"","title_en":"","hook_ar":"","hook_en":"","scenes":[{"sec":"0-3","visual":"<what we see, in English: a picture an AI can make (modern villa, close-up of the system), with the exact parts>","ar":"","en":""}],"voice_ar":"<voice-over in Saudi Arabic, 40-70 words>","voice_en":"<voice-over in English, 40-70 words>","shots":"<kind site: 4-6 shots to film on site, in Roman Urdu; otherwise empty>","tiktok_caption":"","youtube_title":"","youtube_description":"","youtube_tags":"","hashtags":""}]}`, { max: 7000 }));
  const rows = (out.videos || []).filter((v: any) => v && (v.title_en || v.title_ar)).slice(0, n).map((v: any) => ({
    source, status: "idea", kind: ["3d", "site", "tips"].includes(v.kind) ? v.kind : "3d",
    keyword: clean(v.keyword, 120), why: clean(v.why, 300), title_ar: clean(v.title_ar, 200), title_en: clean(v.title_en, 200),
    hook_ar: clean(v.hook_ar, 200), hook_en: clean(v.hook_en, 200),
    scenes: (Array.isArray(v.scenes) ? v.scenes : []).slice(0, 8).map((x: any) => ({ sec: clean(x?.sec, 12), visual: clean(x?.visual, 300), ar: clean(x?.ar, 200), en: clean(x?.en, 200) })),
    voice_ar: clean(v.voice_ar, 1500), voice_en: clean(v.voice_en, 1500), shots: clean(v.shots, 1500),
    tiktok_caption: clean(v.tiktok_caption, 2200), youtube_title: clean(v.youtube_title, 100), youtube_description: clean(v.youtube_description, 3000),
    youtube_tags: clean(v.youtube_tags, 500), hashtags: clean(v.hashtags, 400) }));
  if (!rows.length) throw new Error("the AI returned no video ideas");
  const { error } = await db.from("video_ideas").insert(rows);
  if (error) throw new Error("video_ideas: " + error.message);
  return rows.length;
}

async function tick(force: string | false) {
  const s = await getState(), items: Item[] = [], done: string[] = [];
  if (!force && s.last_tick && Date.now() - Date.parse(s.last_tick) < 10 * 60e3) return { skipped: "ran less than 10 minutes ago" };
  s.last_tick = new Date().toISOString();
  // 1. Google's numbers, once a day
  if (force || !s.last_pull || Date.now() - Date.parse(s.last_pull) > 20 * H || !s.google?.linked) {
    try { done.push(`search console rows: ${await pull(s)}`); s.error = null; }
    catch (e) { s.error = String((e as Error).message || e).slice(0, 300); items.push({ level: "warn", text: "SEO: Google Search Console se aaj data nahi aaya - " + s.error.slice(0, 120) }); }
  }
  // 2. Where the website stands
  const before = s.summary;
  s.summary = await analyse();
  const a = s.summary;
  for (const x of a.striking) if (x.pos <= 10 && (before?.striking || []).some((b: any) => b.q === x.q && b.pos > 10)) items.push({ level: "warn", text: `SEO: "${x.q}" ab Google ke page 1 par (position ${x.pos})` });
  for (const x of a.down.slice(0, 2)) items.push({ level: "warn", text: `SEO: "${x.q}" neeche gaya ${x.was} → ${x.pos} (page ${x.page})` });
  // 3. Website leads and clicks since the last run
  const since = before?.at || new Date(Date.now() - D).toISOString();
  const { data: ev } = await db.from("web_events").select("kind").gt("at", since);
  const n = (k: string) => (ev || []).filter((e: any) => e.kind === k).length;
  if ((ev || []).length) items.push({ level: n("lead") ? "bad" : "warn", text: `Website: ${n("lead")} form query, ${n("whatsapp")} WhatsApp, ${n("call")} call click${n("lead") ? " - Queries mein dekhein aur aaj jawab dein" : ""}` });
  // 4. Weekly report + 2 topics (not on the same run as a long blog draft: the server gives each run about 2 minutes)
  let busy = false;
  if (force === "weekly" || !s.last_week || Date.now() - Date.parse(s.last_week) > 6.5 * D) {
    try { await weekly(s); busy = true; done.push("weekly report"); items.push({ level: "warn", text: "SEO hafta report: " + s.report.text.split("\n").slice(0, 2).join(" · ") }); }
    catch (e) { items.push({ level: "warn", text: "SEO: weekly report nahi ban saki - " + String((e as Error).message).slice(0, 100) }); }
  }
  // 5. One blog draft a day from the queue, while the owner keeps up with reading them
  const { count: waiting } = await db.from("blog_posts").select("id", { count: "exact", head: true }).eq("status", "Draft").eq("source", "autopilot");
  if (!busy && s.queue?.length && (waiting ?? 0) < MAX_WAITING_DRAFTS && (force || !s.last_draft || Date.now() - Date.parse(s.last_draft) > 20 * H)) {
    try { const t = await draftOne(s); if (t) { done.push("draft: " + t); busy = true; } }
    catch (e) { items.push({ level: "warn", text: "SEO: blog draft nahi bana - " + String((e as Error).message).slice(0, 100) }); }
  }
  const { count: drafts } = await db.from("blog_posts").select("id", { count: "exact", head: true }).eq("status", "Draft").eq("source", "autopilot");
  if (drafts) items.push({ level: (drafts ?? 0) >= MAX_WAITING_DRAFTS ? "bad" : "warn", text: `SEO: ${drafts} blog draft tayyar - Growth mein parh kar Publish dabayen${(drafts ?? 0) >= MAX_WAITING_DRAFTS ? " (naye tab tak nahi likhe jayenge)" : ""}` });
  // 6. Google reviews for finished projects
  try { await reviews(s, items); } catch { /* projects table not readable: skip */ }
  // 7. Videos: 2 new ideas a week while fewer than 4 wait (not on a run that already wrote a long text)
  if (!busy && (!s.last_videos || Date.now() - Date.parse(s.last_videos) > 6.5 * D)) {
    try {
      const { count: open } = await db.from("video_ideas").select("id", { count: "exact", head: true }).eq("status", "idea");
      s.last_videos = new Date().toISOString();
      if ((open ?? 0) < MIN_VIDEO_IDEAS) { const k = await videoIdeas(2, "weekly", s); done.push(`video ideas: ${k}`); items.push({ level: "warn", text: `Videos: ${k} naye video ideas tayyar - Growth → Videos mein script aur caption dekhein` }); }
    } catch (e) { items.push({ level: "warn", text: "Videos: ideas nahi bane - " + String((e as Error).message).slice(0, 100) }); }
  }
  s.items = items.slice(0, 10);
  s.done = done;
  await saveState(s);
  return { ok: true, done, items: s.items.length };
}

// ───────── Instant indexing: IndexNow (Bing, Yandex and the other IndexNow engines) and Google Search Console ─────────
// The IndexNow key is public by design: the website serves it at /<key>.txt, which is how the search engines check it.
const INDEXNOW_KEY = "a5f3c1e9d2b84f6e9c7a0b1d3e5f7a92";
const SITEMAP = SITE + "/sitemap.xml";
/** A public address on the website, written the way the build and Growth write it, or "" for anything else. */
function pageUrl(v: unknown): string {
  try {
    const u = new URL(String(v || "").trim());
    if (u.protocol !== "https:" || u.hostname !== "al-swaticontracting.com") return "";
    let path = u.pathname.replace(/\/{2,}/g, "/");
    if (!/\.[a-z0-9]{2,5}$/i.test(path) && !path.endsWith("/")) path += "/";
    return SITE + path;
  } catch { return ""; }
}
async function indexNow(urls: string[]): Promise<number> {
  const r = await fetch("https://api.indexnow.org/indexnow", { method: "POST", signal: AbortSignal.timeout(20000),
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: "al-swaticontracting.com", key: INDEXNOW_KEY, keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`, urlList: urls }) });
  await r.text().catch(() => "");
  return r.status; // 200 or 202 = received
}
/** Resubmits sitemap.xml in Search Console, so Google reads the new and changed addresses in it. */
async function sitemapSubmit(): Promise<{ code: number; why?: string }> {
  const tok = await googleToken(true);
  if (!tok) return { code: 0, why: "Google Search Console is not linked" };
  if (!canWrite()) return { code: 403, why: "the Google sign-in can only read: press Sign in with Google again in Growth to allow sitemap resubmits" };
  const r = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE)}/sitemaps/${encodeURIComponent(SITEMAP)}`,
    { method: "PUT", headers: { authorization: "Bearer " + tok }, signal: AbortSignal.timeout(20000) });
  const t = await r.text().catch(() => "");
  return r.ok ? { code: r.status } : { code: r.status, why: `Google ${r.status}: ${t.slice(0, 160)}` };
}
/** Google's own status for one address (URL Inspection: indexed or not, last crawl). Reading only. */
async function inspect(tok: string, url: string) {
  const now = new Date().toISOString();
  const r = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { method: "POST", signal: AbortSignal.timeout(30000),
    headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: JSON.stringify({ inspectionUrl: url, siteUrl: GSC_SITE, languageCode: "en-US" }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { google_checked_at: now, google_error: `Google ${r.status}: ${clean(j?.error?.message, 160)}` };
  const x = j?.inspectionResult?.indexStatusResult || {};
  return { google_state: clean(x.coverageState || x.indexingState, 120) || null, google_verdict: clean(x.verdict, 20) || null,
    google_crawled_at: x.lastCrawlTime || null, google_checked_at: now, google_error: null };
}
/** IndexNow for these addresses, one sitemap resubmit for Google (at most every 10 minutes from the build), saved for Growth. */
async function sendPings(urls: string[], by: "build" | "erp") {
  if (!urls.length) return { ok: true, sent: 0 };
  const now = new Date().toISOString();
  let code = 0, sm: { code: number; why?: string } = { code: 0 };
  try { code = await indexNow(urls); } catch (e) { console.error("IndexNow", e); }
  const { data: lately } = await db.from("index_status").select("url").gte("sitemap_at", new Date(Date.now() - 10 * 60e3).toISOString()).limit(1);
  if (by === "erp" || !lately?.length) { try { sm = await sitemapSubmit(); } catch (e) { sm = { code: 0, why: clean((e as Error).message, 160) }; } }
  const rows = urls.map((url) => ({ url, indexnow_at: now, indexnow_code: code, indexnow_by: by, ...(sm.code ? { sitemap_at: now, sitemap_code: sm.code } : {}), updated_at: now }));
  const { error } = await db.from("index_status").upsert(rows, { onConflict: "url" });
  if (error) throw new Error(error.message);
  console.log("index_ping", JSON.stringify({ by, sent: urls.length, indexnow: code, sitemap: sm }));
  return { ok: true, sent: urls.length, indexnow: code, sitemap: sm };
}

/** Asks GitHub to rebuild al-swaticontracting.com right away (the "Blog from the ERP" workflow, event erp-publish).
 *  Needs the secret GITHUB_SITE_TOKEN: a fine-grained GitHub token for the al-swati-website repository only, with
 *  "Contents: Read and write". Without it the website still updates on its own schedule (about every 30-60 minutes). */
async function siteRebuild() {
  // A pasted token can carry invisible characters (a space, line break or direction mark) or be pasted twice:
  // keep only letters, digits and "_", then try each GitHub token found in it, the last one first.
  const raw = (Deno.env.get("GITHUB_SITE_TOKEN") || "").replace(/[^A-Za-z0-9_]/g, "");
  if (!raw) return { started: false, why: "no GITHUB_SITE_TOKEN secret yet - the website picks the change up on its next scheduled build" };
  const found = [...raw.matchAll(/github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}|ghp_[A-Za-z0-9]{36}/g)].map((m) => m[0]);
  const tries = [...new Set(found.length ? found.reverse() : [raw])];
  let out: { started: boolean; why?: string } = { started: false }, used = "";
  for (const tok of tries) {
    used = tok;
    const r = await fetch("https://api.github.com/repos/hussainkhan-maker/al-swati-website/dispatches", {
      method: "POST", signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${tok}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "al-swati-erp" },
      body: JSON.stringify({ event_type: "erp-publish" }),
    });
    out = r.status === 204 ? { started: true } : { started: false, why: `GitHub answered ${r.status}: ${(await r.text()).slice(0, 160)}` };
    if (r.status !== 401) break; // only "Bad credentials" is worth trying the next token for
  }
  // For the logs: never the token itself, only lengths and kind.
  const kind = used.startsWith("github_pat_") ? "fine-grained" : used.startsWith("ghp_") ? "classic" : "unknown kind";
  console.log("site_rebuild", JSON.stringify({ ...out, token: `${raw.length} characters saved, ${found.length} GitHub token(s) in it, used ${used.length} characters (${kind})` }));
  return out;
}

async function isAdmin(req: Request) {
  const u = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data } = await u.auth.getUser();
  if (!data?.user) return false;
  const { data: prof } = await db.from("profiles").select("role, active").eq("id", data.user.id).single();
  return prof?.role === "admin" && !!prof?.active;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, st = 200) => new Response(JSON.stringify(b), { status: st, headers: { ...cors, "content-type": "application/json" } });
  try {
    const p = await req.json().catch(() => ({}));
    if (p.action === "tick") return json(await tick(false));
    if (p.action === "run") {
      if (!(await isAdmin(req))) return json({ error: "Only Super-Admin" }, 403);
      return json(await tick(p.force === "weekly" ? "weekly" : "now"));
    }
    if (p.action === "video_ideas") { // Growth → Videos: "Write 3 new ideas"
      if (!(await isAdmin(req))) return json({ error: "Only Super-Admin" }, 403);
      return json({ ok: true, added: await videoIdeas(Math.min(3, Math.max(1, Number(p.n) || 3)), "manual", await getState()) });
    }
    if (p.action === "site_rebuild") { // after Publish / Unpublish / Save of a public post: rebuild the website now
      if (!(await isAdmin(req))) return json({ error: "Only Super-Admin" }, 403);
      return json(await siteRebuild());
    }
    if (String(p.action || "").startsWith("google_")) {
      if (!(await isAdmin(req))) return json({ error: "Only Super-Admin" }, 403);
      if (p.action === "google_status") {
        const L = await gLink(), linked = !!(L?.refresh_token || Deno.env.get("GOOGLE_SERVICE_ACCOUNT"));
        if (linked && !Deno.env.get("GOOGLE_SERVICE_ACCOUNT")) await ownerToken().catch(() => null); // learns what the sign-in allows
        return json({ linked, account: L?.account || null, error: L?.last_error || null, ready: !!G_SECRET, write: linked && canWrite() });
      }
      if (p.action === "google_start") return json(await googleStart());
      if (p.action === "google_finish") return json(await googleFinish(p));
      if (p.action === "google_disconnect") {
        const L = await gLink();
        if (L?.refresh_token) await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(L.refresh_token), { method: "POST" }).catch(() => {});
        await saveGLink({ refresh_token: null, account: null, last_error: null });
        const st = await getState(); st.google = { linked: false }; await saveState(st);
        return json({ ok: true });
      }
    }
    // From the website build (public), once GitHub Pages has published: the same address is pinged at most every 10 minutes.
    if (p.action === "index_ping") {
      // only addresses the live sitemap lists (the build calls after publishing, so new pages are in it): nobody can use this to ping made-up pages
      const map = await fetch(`${SITEMAP}?v=${Date.now()}`, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
      const listed = new Set([SITEMAP, ...[...map.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => pageUrl(m[1]))]);
      const urls = [...new Set((Array.isArray(p.urls) ? p.urls : []).map(pageUrl).filter((u: string) => listed.has(u)))].slice(0, 200) as string[];
      if (!urls.length) return json({ ok: true, sent: 0 });
      const { data: recent } = await db.from("index_status").select("url").in("url", urls).gte("indexnow_at", new Date(Date.now() - 10 * 60e3).toISOString());
      const done = new Set((recent || []).map((r: any) => r.url));
      return json(await sendPings(urls.filter((u) => !done.has(u)), "build"));
    }
    // Growth (Super-Admin): "Re-ping Google" for one page, and Google's own status for up to 10 pages.
    if (p.action === "index_reping" || p.action === "index_check") {
      if (!(await isAdmin(req))) return json({ error: "Only Super-Admin" }, 403);
      const urls = [...new Set((p.action === "index_reping" ? [p.url] : Array.isArray(p.urls) ? p.urls : []).map(pageUrl).filter(Boolean))].slice(0, 10) as string[];
      if (!urls.length) return json({ error: "No address on al-swaticontracting.com" }, 400);
      const sent = p.action === "index_reping" ? await sendPings(urls, "erp") : null;
      const tok = await googleToken().catch(() => null);
      if (tok) for (const url of urls) await db.from("index_status").upsert({ url, ...(await inspect(tok, url)), updated_at: new Date().toISOString() }, { onConflict: "url" });
      const { data: rows } = await db.from("index_status").select("*").in("url", urls);
      return json({ ok: true, google: !!tok, sent, rows: rows || [] });
    }
    // From the website (public). A daily-salted fingerprint of the visitor's address stops floods; nothing else is kept.
    if (p.action === "lead" || p.action === "event") {
      const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
      const ip_hash = (await sha256(ip + "|" + riyadhDay() + "|" + URL_)).slice(0, 16);
      const { count } = await db.from("web_events").select("id", { count: "exact", head: true }).eq("ip_hash", ip_hash).gte("at", new Date(Date.now() - 10 * 60e3).toISOString());
      if ((count ?? 0) >= 8) return json({ ok: true });
      const row = { page: clean(p.page, 200), lang: p.lang === "ar" ? "ar" : "en", ref: clean(p.ref, 100), utm: clean(p.utm, 200), ip_hash };
      if (p.action === "event") {
        if (!["whatsapp", "call", "email", "estimate"].includes(p.kind)) return json({ error: "Unknown kind" }, 400); // estimate: the cost calculator was used
        await db.from("web_events").insert({ ...row, kind: p.kind });
        return json({ ok: true });
      }
      if (p.hp) return json({ ok: true }); // the hidden field was filled: a bot
      const name = clean(p.name, 80), phone = clean(p.phone, 30), email = clean(p.email, 120).toLowerCase(), type = clean(p.projectType, 60), msg = clean(p.message, 3000);
      // from the website's cost calculator: what the visitor picked and the range the page showed them
      const e = p.estimate && typeof p.estimate === "object" ? p.estimate : null;
      const est = e ? { type: clean(e.type, 60), material: clean(e.material, 60), fixing: clean(e.fixing, 60), area: Math.round(Number(e.area) || 0),
        lo: Math.round(Number(e.lo) || 0), hi: Math.round(Number(e.hi) || 0), weeks: clean(e.weeks, 12) } : null;
      const hasEst = !!est && est.area > 0 && est.area <= 100000 && est.lo > 0 && est.hi >= est.lo && est.hi < 1e9;
      const sar = (v: number) => v.toLocaleString("en-US");
      // from /technical-specs/: an engineering office asking for CAD details (.DWG) and a method statement
      const company = clean(p.company, 120), role = clean(p.role, 40), system = clean(p.system, 60), project = clean(p.project, 160);
      const docs: string[] = Array.isArray(p.docs) ? p.docs.map((d: unknown) => clean(d, 40)).filter(Boolean).slice(0, 5) : [];
      const tech = !hasEst && (!!company || docs.length > 0);
      if (!name || !(phone || email) || !msg) return json({ error: "Name, phone or email, and the details are needed." }, 400);
      if (phone && !/^[+\d\s()\-]{7,22}$/.test(phone)) return json({ error: "Check the phone number." }, 400);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Check the email." }, 400);
      await db.from("web_events").insert({ ...row, kind: "lead" });
      // Into Queries as "Under Review": a short form message has no BOQ for the AI readers, so the autopilot leaves it to the owner.
      const { data, error } = await db.from("inquiries").insert({
        source: "website", status: "Under Review", from_name: name + (company ? " · " + company : "") + (phone ? " · " + phone : ""), from_email: email || null,
        subject: hasEst ? `Website estimate: ${est!.type} · ${est!.material} · ${sar(est!.area)} m² - ${name}`
          : tech ? `Technical request: ${docs.join(" + ") || "documents"} - ${name}${company ? " (" + company + ")" : ""}` : `Website: ${type || "quote request"} - ${name}`,
        body: `${msg}\n\n— ${hasEst ? "Website cost calculator" : tech ? "Website technical request (/technical-specs/)" : "Website quote form"} —\nName: ${name}\nPhone: ${phone || "-"}\nEmail: ${email || "-"}\nProject type: ${type || "-"}`
          + (hasEst ? `\nEstimate shown: ${est!.type}, ${est!.material}, ${est!.fixing}, ${sar(est!.area)} m², SAR ${sar(est!.lo)} – ${sar(est!.hi)}, ${est!.weeks} weeks` : "")
          + (tech ? `\nCompany: ${company || "-"}\nRole: ${role || "-"}\nDocuments: ${docs.join(", ") || "-"}\nFixing system: ${system || "-"}\nProject: ${project || "-"}` : "")
          + `\nPage: ${row.page || "-"} (${row.lang})\nCame from: ${row.ref || "direct"}${row.utm ? "\nCampaign: " + row.utm : ""}`,
        dedupe_key: `web|${phone.replace(/\D/g, "") || email}|${riyadhDay()}`,
      }).select("ref").single();
      if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
      if (data?.ref) { // the main agent hears about it straight away
        const s = await getState();
        const what = hasEst ? ` - estimate ${est!.material}, ${sar(est!.area)} m², SAR ${sar(est!.lo)}–${sar(est!.hi)}`
          : tech ? `${company ? " (" + company + ")" : ""}${email ? " " + email : ""} - ${docs.join(" + ") || "technical documents"}` : type ? " - " + type : "";
        s.items = [{ level: "bad", text: `${tech ? "Technical request" : "Website query"} ${data.ref}: ${name}${phone ? " " + phone : ""}${what}. Aaj call ya WhatsApp karein` }, ...(s.items || [])].slice(0, 10);
        await saveState(s);
      }
      return json({ ok: true, ref: data?.ref || null });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
