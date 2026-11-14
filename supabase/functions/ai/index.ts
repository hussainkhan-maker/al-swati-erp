// Edge Function "ai": the only place the Anthropic API key lives.
// Tasks: parse (spoken/typed note → one action), receipt (photo → lines), rfq (BOQ read twice), ask (owner's questions), estimate (market price).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import * as XLSX from "npm:xlsx@0.18.5";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = Deno.env.get("AI_MODEL") ?? "claude-sonnet-5-5";
const MODEL_STRONG = Deno.env.get("AI_MODEL_STRONG") ?? "claude-opus-5-5";
// Token saver: short writing jobs (emails, follow-ups, rules, topic lists, the morning summary) use the small, cheap model.
const MODEL_FAST = Deno.env.get("AI_MODEL_FAST") ?? "claude-haiku-5-5";
// Free AI: when GEMINI_API_KEY is set, every task whose model name starts with "gemini" runs on Google Gemini instead of Claude.
// Turn it on with Supabase secrets, e.g. AI_MODEL_FAST=gemini-2.5-flash (short writing jobs) and, if you like the results, AI_MODEL=gemini-2.5-flash.
// Keep AI_MODEL_STRONG on Claude for BOQ reading. If Gemini fails or its free daily limit runs out, the call falls back to Claude automatically.
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const CLAUDE_FALLBACK = "claude-sonnet-5-5";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" };
const LANG: Record<string, string> = { ar: "Arabic", ur: "Urdu", en: "English" };

type Img = { media_type: string; data: string };
// Fixed company guide + the owner's learned rules, sent once as a cached system prompt (cheaper on every call after the first).
const GUIDE = `You work inside the ERP of Al-Swati Contracting, a stone, marble, granite and porcelain flooring and facade cladding contractor in Saudi Arabia (Riyadh, Dammam, Al-Hassa).
Ground rules for every task:
- Never invent facts, quantities, prices, names, projects or clients. If something is missing or unreadable, say so (null / "unclear").
- Digits 0-9 only. Money in SAR. Saudi VAT is 15%, shown separately. Calculations are done by the app's code, not by you: give raw quantities and facts.
- Materials: Arabic and English names refer to the same thing (رخام = marble, جرانيت = granite, بورسلان = porcelain, حجر رياض = Riyadh stone, ترافرتين = travertine). Keep size and thickness with the name; a different size or thickness is a different product.
- Normal values: facade cladding stone 20-30 mm (30-40 mm heavy panels), floor marble/granite 20 mm, porcelain 9-20 mm; common tile sizes 60x60, 60x120, 80x80, 120x120 cm, stone panels 30x60, 40x80, 60x90 cm; cutting waste 10-15% for normal work, 15-20% for book-match, many cuts or curves, and 15-18% at bid stage when no engineer has checked the drawings.
- Dry-fix cladding needs stainless steel anchors/brackets (count per panel, typically 4 per panel); wet-fix needs adhesive/mortar. Flag missing skirting, risers, steps, sills, coping, cut edges, sealant, mock-up and protection.
- Plain, professional language. Roman Urdu only where the task asks for it.`;
let TASK = ""; // which task is running, for the usage log
const LOG = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
let USER_ID: string | null = null; // who is asking (for the daily AI limit)
let RULES = ""; // filled per request from preferences "rules" (the owner's feedback, "Teach your AI")
async function claude(prompt: string, opts: { images?: Img[]; model?: string; max?: number; webSearch?: number } = {}) {
  const chosen = opts.model ?? MODEL;
  if (chosen.startsWith("gemini")) {
    if (GEMINI_KEY && !opts.webSearch) { try { return await gemini(prompt, chosen, opts); } catch (e) { console.error("Gemini failed, using Claude:", e); } }
    opts = { ...opts, model: opts.model === MODEL_FAST ? "claude-haiku-5-5" : CLAUDE_FALLBACK }; // fast jobs fall back to the cheap Claude model
  }
  const content: unknown[] = (opts.images ?? []).map((i) => i.media_type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: i.data } }
    : { type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } });
  content.push({ type: "text", text: prompt });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: opts.model ?? MODEL, max_tokens: opts.max ?? 2000,
      system: [{ type: "text", text: GUIDE + (RULES ? `\nThe owner's own rules (always follow):\n${RULES}` : ""), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      ...(opts.webSearch ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: opts.webSearch, user_location: { type: "approximate", country: "SA" } }] } : {}) }),
  });
  if (!r.ok) throw new Error(`AI ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  // Usage log: every call's tokens are counted per task, so the owner sees where the AI money goes.
  try { const u = j.usage || {}; await LOG.from("ai_usage").insert({ user_id: USER_ID, task: TASK, model: opts.model ?? MODEL, input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, cache_read: u.cache_read_input_tokens || 0, cache_write: u.cache_creation_input_tokens || 0, files: (opts.images ?? []).length }); } catch { /* never block the answer */ }
  return (j.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
}

// Google Gemini (free tier) with the same company guide and rules; returns plain text like claude().
async function gemini(prompt: string, model: string, opts: { images?: Img[]; max?: number }) {
  const parts: unknown[] = (opts.images ?? []).map((i) => ({ inline_data: { mime_type: i.media_type, data: i.data } }));
  parts.push({ text: prompt });
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
    method: "POST",
    headers: { "x-goog-api-key": GEMINI_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: GUIDE + (RULES ? "\nThe owner's own rules (always follow):\n" + RULES : "") }] },
      contents: [{ role: "user", parts }],
      generationConfig: { maxOutputTokens: Math.max(opts.max ?? 2000, 8192) },
    }),
  });
  if (!r.ok) throw new Error("Gemini " + r.status + ": " + (await r.text()).slice(0, 300));
  const j = await r.json();
  try { const u = j.usageMetadata || {}; await LOG.from("ai_usage").insert({ user_id: USER_ID, task: TASK, model, input_tokens: u.promptTokenCount || 0, output_tokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), cache_read: u.cachedContentTokenCount || 0, cache_write: 0, files: (opts.images ?? []).length }); } catch { /* never block the answer */ }
  const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini returned no text");
  return text;
}
/** Public share links (Google Drive, Dropbox, OneDrive, WeTransfer-style direct links) → direct download URLs. */
function shareLinks(text: string): { url: string; label: string }[] {
  const out: { url: string; label: string }[] = [], seen = new Set<string>();
  const add = (url: string, label: string) => { if (!seen.has(url)) { seen.add(url); out.push({ url, label }); } };
  for (const m of text.matchAll(/https?:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=download&)?id=)([\w-]{20,})/g)) add(`https://drive.google.com/uc?export=download&id=${m[1]}`, `drive-${m[1].slice(0, 8)}`);
  for (const m of text.matchAll(/https?:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]{20,})/g)) add(`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`, `sheet-${m[1].slice(0, 8)}.xlsx`);
  for (const m of text.matchAll(/https?:\/\/(?:www\.)?dropbox\.com\/[^\s"'<>)]+/g)) add(m[0].replace(/([?&])dl=0/, "$1dl=1") + (/[?&]dl=/.test(m[0]) ? "" : (m[0].includes("?") ? "&" : "?") + "dl=1"), "dropbox");
  return out.slice(0, 8);
}
/** Download one shared file (max 20 MB). Folders and private links are skipped with a note. */
async function fetchShared(url: string, label: string): Promise<{ name: string; type: string; bytes: Uint8Array } | { note: string }> {
  try {
    const r = await fetch(url, { redirect: "follow" });
    if (!r.ok) return { note: `${label}: link not public or not found (${r.status})` };
    const type = r.headers.get("content-type") || "application/octet-stream";
    if (/text\/html/i.test(type)) return { note: `${label}: this is a folder or a private file. Ask the client to share each file with "Anyone with the link".` };
    const len = Number(r.headers.get("content-length") || 0);
    if (len > 20 * 1024 * 1024) return { note: `${label}: file is larger than 20 MB, open it from the link.` };
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > 20 * 1024 * 1024) return { note: `${label}: file is larger than 20 MB, open it from the link.` };
    const cd = r.headers.get("content-disposition") || "";
    const name = decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i) || [, label])[1]);
    return { name, type, bytes };
  } catch (e) { return { note: `${label}: could not download (${(e as Error).message})` }; }
}

/** Text of a PDF when it has enough real text per page (≥ 400 characters), else null (drawing or scan). */
async function pdfText(admin: ReturnType<typeof createClient>, bucket: string, path: string): Promise<string | null> {
  try {
    const { data } = await admin.storage.from(bucket).download(path);
    if (!data) return null;
    const pdf = await getDocumentProxy(new Uint8Array(await data.arrayBuffer()));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text]).map((x) => String(x || "").replace(/[ \t]+/g, " ").trim());
    const chars = pages.reduce((n, x) => n + x.length, 0);
    if (!totalPages || chars / totalPages < 400) return null;
    return pages.map((x, i) => `--- page ${i + 1} ---\n${x}`).join("\n").slice(0, 60000);
  } catch { return null; }
}
function asJson(t: string) {
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const s = fence ? fence[1] : t.slice(Math.min(...["{", "["].map((c) => (t.indexOf(c) < 0 ? Infinity : t.indexOf(c)))));
  return JSON.parse(s.slice(0, Math.max(s.lastIndexOf("}"), s.lastIndexOf("]")) + 1));
}
async function imageFrom(admin: ReturnType<typeof createClient>, bucket: string, path: string): Promise<Img> {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) throw new Error("Image not found");
  const buf = new Uint8Array(await data.arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { media_type: data.type || "image/jpeg", data: btoa(bin) };
}

/** AI reads one query (two readers: fast and strong) and stores the reading on it. */
async function readInquiry(admin: any, p: any) {
  TASK = "rfq";
  const imgs: Img[] = [];
  if (p.inquiry_id) {
    const { data: q } = await admin.from("inquiries").select("body, attachments").eq("id", p.inquiry_id).single();
    p.text = [p.text, q?.body].filter(Boolean).join("\n\n");
    for (const a of (q?.attachments || []).filter((a: any) => /^image\/|pdf$/i.test(a.type || "")).slice(0, 5)) {
      try {
        // Token saver: a PDF that has real text (BOQ, specification, letter) is sent as text — far fewer tokens.
        // Drawings and scans (little or no text) are still sent as the file, because they must be seen.
        if (/pdf/i.test(a.type)) { const t = await pdfText(admin, "inbox", a.path); if (t) { p.text = [p.text, `=== ${a.name} (text of the PDF) ===\n${t}`].filter(Boolean).join("\n\n"); continue; } }
        const f = await imageFrom(admin, "inbox", a.path); if (/pdf/i.test(a.type)) f.media_type = "application/pdf"; imgs.push(f);
      } catch { /* skip unreadable file */ }
    }
  }
  if (p.path) imgs.push(await imageFrom(admin, "documents", p.path));
  const prompt = `You read a construction RFQ / BOQ for a stone, marble, granite, porcelain and flooring contractor in Saudi Arabia. Extract every priced line exactly as given. Return JSON only:
{"lines":[{"ref":"<item no>","desc":"<full description incl. material, size, thickness, finish>","qty":<number>,"unit":"sqm|rft|lm|no|ton|ls","category":"Marble|Granite|Porcelain|Ceramic|Civil|Fixing|Other"}],
 "documents":[{"name":"<file or section>","kind":"drawing|boq|specification|letter|other","summary":"<one line: what it contains>"}],
 "specs":["<each requirement from specifications: material grade, thickness, finish, fixing method, standards, samples, warranty>"],
 "drawingQuantities":[{"what":"<area or element>","qty":<number>,"unit":"sqm|lm|no","source":"<which drawing / DXF layer>"}],
 "rfis":["<contradiction between BOQ, drawings and specs, or missing spec, to ask the consultant>"],"siteChecks":["<what must be verified on site before work>"],
 "estimate":{"waste_pct":<cutting waste % from slab sizes vs. the areas, or null>,"waste_note":"<which slab size you assumed>","fixings":[{"item":"<bracket|pin|anchor bolt|channel|adhesive>","qty":<number or null>,"basis":"<how counted: per m², per panel, wind/dead load in KSA>"}]},"notes":"<anything unclear>"}
Compare BOQ quantities with drawing quantities (including any "DXF takeoff" section in the text) and put every difference above 3% in rfis.
Digits only. Never invent a quantity: if unreadable, qty null and say so in notes.
BOQ TEXT:
${String(p.text ?? "(see image)").slice(0, 30000)}`;
  const [a, b] = await Promise.all([
    claude(prompt, { images: imgs, max: 6000 }),
    claude(prompt + "\nRead slowly, line by line, and check each quantity twice.", { images: imgs, model: MODEL_STRONG, max: 6000 }),
  ]);
  const result = { a: asJson(a), b: asJson(b) };
  if (p.inquiry_id) await admin.from("inquiries").update({ reading: result, status: "Under Review" }).eq("id", p.inquiry_id).eq("status", "New");
  if (p.inquiry_id) await admin.from("inquiries").update({ reading: result }).eq("id", p.inquiry_id);
  return result;
}

// Red gates (same as the app): the two readings disagree, or a quantity / unit is missing.
const STD_UNITS = ["sqm", "rft", "lm", "no", "ton", "ls"];
function redGate(A: any[], B: any[]) {
  if (B.length > A.length) return true;
  for (let i = 0; i < A.length; i++) {
    const l = A[i], m = B.find((x: any) => x.ref && x.ref === l.ref) || B[i];
    if (!m || Number(m.qty) !== Number(l.qty) || String(m.unit) !== String(l.unit)) return true;
    if (!(Number(l.qty) > 0) || !STD_UNITS.includes(String(l.unit).toLowerCase())) return true;
  }
  const refs = A.map((l: any) => l.ref).filter(Boolean);
  return refs.some((x: any, i: number) => refs.indexOf(x) !== i);
}

/** Autopilot (runs on the server, app open or not): reads new queries and turns clean ones into draft quotations.
 *  Safe to call any time: it only does work that is waiting, claims each query first so it is never done twice,
 *  and never prices or sends anything. Rates stay for the owner. */
async function autopilot(admin: any) {
  const out = { read: 0, quoted: 0 };
  const { data: news } = await admin.from("inquiries").select("id").eq("status", "New").is("reading", null).order("created_at").limit(1);
  // One query per call (two AI readers run side by side), so the call stays well inside the time limit.
  await Promise.all((news || []).map(async (q: any) => {
    const { data: claim } = await admin.from("inquiries").update({ status: "Under Review" }).eq("id", q.id).eq("status", "New").is("reading", null).select("id");
    if (!claim?.length) return;
    // On failure the query goes back to New with the error kept, so the owner sees it and presses "Read with AI" (never retried by itself).
    try { await readInquiry(admin, { inquiry_id: q.id }); out.read++; } catch (e) { await admin.from("inquiries").update({ status: "New", reading: { error: String((e as Error).message || e).slice(0, 300) } }).eq("id", q.id); }
  }));
  const { data: ready } = await admin.from("inquiries").select("id, ref, subject, from_name, reading").not("reading", "is", null).is("quote_id", null).in("status", ["New", "Under Review"]).limit(5);
  for (const q of ready || []) {
    const A = q.reading?.a?.lines || [], B = q.reading?.b?.lines || [];
    if (!A.length || redGate(A, B)) continue;
    const { data: claim } = await admin.from("inquiries").update({ status: "Priced" }).eq("id", q.id).is("quote_id", null).in("status", ["New", "Under Review"]).select("id");
    if (!claim?.length) continue;
    const { data: qt, error } = await admin.from("quotes").insert({
      title: q.subject || q.ref, client: q.from_name, owner: "admin",
      lines: A.map((l: any) => ({ desc: (l.ref ? l.ref + " · " : "") + l.desc, qty: Number(l.qty) || 0, unit: l.unit, rate: null })),
      history: [`${new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 16).replace("T", " ")} made by the autopilot from ${q.ref}`], rfq: { inquiry_id: q.id, ref: q.ref },
    }).select("id").single();
    if (error) { await admin.from("inquiries").update({ status: "Under Review" }).eq("id", q.id); continue; }
    await admin.from("inquiries").update({ quote_id: qt.id }).eq("id", q.id);
    out.quoted++;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.task === "autopilot") { TASK = "autopilot"; return json(await autopilot(createClient(URL_, SERVICE))); }
    const auth = req.headers.get("Authorization") ?? "";
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
    const { data: u } = await user.auth.getUser();
    if (!u?.user) return json({ error: "Sign in first" }, 401);
    const admin = createClient(URL_, SERVICE);
    const { data: prof } = await admin.from("profiles").select("role, active, must_change").eq("id", u.user.id).single();
    if (!prof?.active) return json({ error: "Account not active" }, 403);
    // Sign in again after 7 days (same rule as the database), so an old stolen session stops working.
    if (u.user.last_sign_in_at && Date.parse(u.user.last_sign_in_at) < Date.now() - 7 * 864e5) return json({ error: "Please sign in again." }, 401);

    // Choosing one's own password goes through here, so the server checks it (strength + known leaked passwords)
    // and only then clears "must change". Until then no other AI task (and no data in the database) opens.
    if (body.task === "set_password") {
      const pw = String(body.password || ""), name = String(u.user.email || "").split("@")[0].toLowerCase();
      if (pw.length < 10 || !/[a-z]/i.test(pw) || !/\d/.test(pw)) return json({ error: "Use 10 or more characters with letters and numbers." }, 400);
      if ((name.length >= 3 && pw.toLowerCase().includes(name)) || /password|123456|qwerty|swati/i.test(pw)) return json({ error: "Do not use your name, email or an easy word." }, 400);
      try { // Have I Been Pwned (k-anonymity): only the first 5 characters of the SHA-1 hash leave the server.
        const h = [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(pw)))].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
        const list = await (await fetch(`https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`, { headers: { "Add-Padding": "true" } })).text();
        if (list.split("\n").some((l) => l.split(":")[0].trim() === h.slice(5) && Number(l.split(":")[1]) > 0)) return json({ error: "This password is known to be leaked on the internet. Choose another one." }, 400);
      } catch { /* check service down: the strength rules above still apply */ }
      const { error: ue } = await admin.auth.admin.updateUserById(u.user.id, { password: pw, user_metadata: { temp_password: false } });
      if (ue) return json({ error: ue.message }, 400);
      await admin.from("profiles").update({ must_change: false }).eq("id", u.user.id);
      return json({ ok: true });
    }
    if (prof.must_change) return json({ error: "Choose your own password first." }, 403);
    const role = prof.role as string;
    const { task, ...p } = body;
    TASK = String(task || ""); USER_ID = u.user.id;
    // Daily AI limit for everyone except Super-Admin (stops a lost phone or a bad actor running up the AI bill).
    if (role !== "admin") {
      const { count } = await admin.from("ai_usage").select("id", { count: "exact", head: true }).eq("user_id", u.user.id).gte("at", new Date(Date.now() - 864e5).toISOString());
      if ((count ?? 0) >= 150) return json({ error: "Today's AI limit is reached. It opens again tomorrow, or ask Super-Admin." }, 429);
    }
    // The owner's private pricing rules ("Teach your AI") go only into Super-Admin and Abu requests, never to site staff.
    RULES = "";
    if (role === "admin" || role === "abu") { try { const { data: rl } = await admin.from("preferences").select("value").eq("key", "rules").maybeSingle(); RULES = ((rl?.value as any)?.list || []).slice(-30).map((r: any) => `- ${r.action_for_agents || r.observed_rule}`).join("\n"); } catch { RULES = ""; } }

    if (task === "parse") {
      const lang = LANG[p.lang] ?? "Urdu";
      const allowed = role === "supervisor" ? "purchase|expense|progress|statement|unknown" : "purchase|expense|income|loan|subpay|rate|mrn|progress|statement|unknown";
      const prompt = `You turn one spoken or typed note from a stone, marble and flooring contractor in Saudi Arabia into ONE JSON action. The note may mix Urdu, Arabic and English and may come from speech recognition, so spelling can be rough.
Context (JSON): ${JSON.stringify(p.context ?? {})}
Note: """${String(p.text ?? "").slice(0, 2000)}"""
Return JSON only:
{"intent":"${allowed}",
 "project_id":"<id from context or null>",
 "split":[{"project_id":"<id>","pct":<number>}],
 "amount":<number|null>, "loan":<number|null>,
 "vat_amount":<number|null>, "vat_company":"<company|null>",
 "supplier":"<or null>", "sub_name":"<or null>",
 "description":"<short, in ${lang}>",
 "lines":[{"name":"<material>","qty":<n>,"unit":"<bag|sqm|rft|ton|pcs|...>","price":<n|null>}],
 "progress":[{"sub_name":"<name>","qty":<n>,"unit":"sqm|rft|pcs","work":"<flooring|cladding|skirting|...>"}],
 "statement":{"kind":"project|sub|supplier|material|vat","target":"<name>"},
 "heard":"<one short sentence in ${lang} restating what you understood, numbers as digits>",
 "questions":["<short question in ${lang} for anything missing or unclear>"]}
Meaning of intents: income = money received from a client for a project (the total incl. VAT); loan = money borrowed from the company for a project; subpay = payment to a subcontractor; rate = a supplier price to remember; mrn = materials to request (material requisition); progress = meters done by subcontractors; statement = asking for an account or report.
Rules: digits 0-9 only. Never invent a number that was not said: use null and ask. Match project names loosely ("Malqa wali site"). Use split only when one purchase is shared between projects; percentages must add to 100.`;
      return json(asJson(await claude(prompt)));
    }

    if (task === "receipt") {
      // A receipt is read only by the person who uploaded it (path starts with their id), or by Super-Admin / Abu.
      // Strict path: <own user id>/<file name>, no "..", no extra folders (so no way to step into someone else's folder).
      if (!/^[0-9a-f-]{36}\/[\w.-]+$/.test(String(p.path || "")) || String(p.path).includes("..")) return json({ error: "Bad file path" }, 400);
      if (!["admin", "abu"].includes(role) && !String(p.path).startsWith(u.user.id + "/")) return json({ error: "Not your receipt" }, 403);
      const img = await imageFrom(admin, "receipts", p.path);
      const prompt = `This image is a purchase receipt or invoice from Saudi Arabia (Arabic and/or English). Read it carefully. Return JSON only:
{"supplier":"<name>","invoice_no":"<invoice / tax invoice number or null>","buyer":"<the company the invoice is made out to (customer name, VAT no.) or null>","date":"YYYY-MM-DD or null","lines":[{"name":"<item as written; add English if Arabic>","qty":<n>,"unit":"<unit>","price":<unit price before VAT>,"total":<line total before VAT>}],"subtotal":<before VAT>,"vat":<VAT amount or 0>,"total":<grand total>,"confidence":"high|medium|low","notes":"<anything unclear>"}
Digits 0-9. Read EVERY line: the same stone or tile often appears 2-4 times with different sizes or thicknesses (e.g. 60x60 2cm and 60x120 3cm) - keep each as its own line and put the size/thickness in the name, never merge them. Keep the Arabic name and add the English after it. If something is unreadable use null and say so in notes. Do not guess.`;
      return json(asJson(await claude(prompt, { images: [img] })));
    }

    if (task === "rfq") {
      if (role !== "admin") return json({ error: "Only Super-Admin" }, 403);
      return json(await readInquiry(admin, p));
    }

    if (task === "supplier_msg") {
      if (!["admin", "abu"].includes(role)) return json({ error: "Not allowed" }, 403);
      const lang = LANG[p.lang] ?? "Arabic";
      const text = await claude(`Write a short, polite WhatsApp message in ${lang} from a stone and flooring contractor in Saudi Arabia to a supplier named "${p.supplier}", asking for their best price (before VAT), stock availability and delivery time for these items in ${p.city || "Riyadh"}:
${JSON.stringify(p.items)}
List each item on its own line with size and quantity. Ask them to reply with unit prices. Sign as "${p.signature || "Al-Swati"}". Plain text only, no markdown. Do not invent anything not given.`, { max: 800 });
      if (!p.withEmail) return json({ text: text.trim() });
      const em = asJson(await claude(`Write a formal procurement email in ${lang} (English if Arabic is not asked) from "${p.signature || "Al-Swati Contracting"}" to the supplier "${p.supplier}" in Saudi Arabia asking for a quotation for these items: ${JSON.stringify(p.items)}.
Mention delivery to ${p.city || "Riyadh"} project site${p.needBy ? `, needed by ${p.needBy}` : ""}; ask for unit price before VAT, VAT 15% shown separately, stock vs. lead time, delivery to site or ex-yard, loading/unloading, and payment terms (cash, advance, or 30/60 days credit). Professional Saudi business tone. Do not invent anything not given.
Return JSON only: {"subject":"","body":""}`, { max: 1200 }));
      return json({ text: text.trim(), email: em });
    }

    if (task === "compare_quotes") {
      // Auditor: compares supplier quotations side by side, flags hidden costs, names the best value.
      if (!["admin", "abu"].includes(role)) return json({ error: "Not allowed" }, 403);
      const imgs: Img[] = [];
      for (const path of (p.paths || []).slice(0, 6)) { try { const f = await imageFrom(admin, "documents", path); if (/\.pdf$/i.test(path)) f.media_type = "application/pdf"; imgs.push(f); } catch { /* skip */ } }
      return json(asJson(await claude(`You are the cost controller of a stone and flooring contractor in Saudi Arabia. Compare these supplier quotations for the same need${p.need ? ` (${p.need})` : ""}.
QUOTATIONS (text and/or attached files):
${String(p.text || "").slice(0, 30000)}
Use only what is written. Prices in SAR. If VAT 15% is not stated say "VAT unclear".
Return JSON only: {"rows":[{"supplier":"","item":"","unit_price":<n|null>,"total":<n|null>,"vat":"incl|excl|unclear","stock":"ready|<lead time>|unclear","delivery":"to site|ex-yard|unclear","payment":"cash|advance|<n> days credit|unclear","hidden":["<cost not included: loading, unloading, transport, crane, cutting, VAT>"]}],
"best":{"supplier":"","why":"<one line: price balanced with delivery time>"},"recommendations":["<3 short points in simple Roman Urdu>"]}`, { images: imgs, max: 4000 })));
    }

    if (task === "contract") {
      // Contract auditor: Arabic muqawala / quotation / agreement → plain summary + risky clauses with the Arabic text.
      if (role !== "admin") return json({ error: "Only Super-Admin" }, 403);
      const imgs: Img[] = [];
      if (p.path) { const f = await imageFrom(admin, "documents", p.path); if (/\.pdf$/i.test(p.path)) f.media_type = "application/pdf"; imgs.push(f); }
      return json(asJson(await claude(`You review construction contracts (Saudi muqawala, FIDIC-style) for a stone, marble and cladding subcontractor in Saudi Arabia. Read the attached contract / agreement / quotation${p.text ? " and this text" : ""}.
${String(p.text || "").slice(0, 40000)}
Find what puts the subcontractor at risk: delay penalties (gharama) and their cap, retention and payment withholding, payment timing, who pays transport, loading, crane and scaffolding, wastage and breakage liability, variation and measurement rules, termination, warranty and defects period, VAT, advance payment guarantees.
Quote the original clause text exactly. Do not invent clauses. If a page is unreadable, say so.
Return JSON only: {"summary_en":"<5 short lines>","summary_ur":"<5 short lines in simple Roman Urdu>","terms":[{"term":"<value, payment, duration, retention, penalty, warranty...>","value":"<as written>"}],
"risks":[{"level":"high|medium","clause":"<original text, Arabic if Arabic>","risk":"<what can go wrong, plain English>","counter":"<what to ask for instead>"}]}`, { images: imgs, model: MODEL_STRONG, max: 6000 })));
    }

    if (task === "learn") {
      // Memory agent: turns the owner's feedback into a rule every agent follows; saved in preferences ("rules").
      if (role !== "admin") return json({ error: "Only Super-Admin" }, 403);
      const rule = asJson(await claude(`The owner of a stone and flooring contractor in Saudi Arabia gave this feedback to his AI assistants: "${String(p.text).slice(0, 1000)}".
Turn it into one rule. Return JSON only: {"category":"supplier|price|material|tone|process|other","observed_rule":"<the rule, one line>","action_for_agents":"<what the agents must do differently, one line>"}`, { max: 400, model: MODEL_FAST }));
      const { data: cur } = await admin.from("preferences").select("value").eq("key", "rules").maybeSingle();
      const list = [...((cur?.value as any)?.list || []), { ...rule, at: new Date().toISOString() }].slice(-60);
      await admin.from("preferences").upsert({ key: "rules", value: { list }, updated_at: new Date().toISOString() });
      return json(rule);
    }

    if (task === "find_suppliers") {
      // Supplier finder agent: searches the web, returns candidates for the owner to approve. Nothing is added by itself.
      if (!["admin", "abu"].includes(role)) return json({ error: "Not allowed" }, 403);
      const text = await claude(`Find real suppliers in Saudi Arabia for: ${String(p.material).slice(0, 200)}${p.city ? `, preferably in or delivering to ${p.city}` : ""}. Search the web (company websites, Google business listings, Saudi directories). Only Saudi-registered businesses. Do not invent anything: every field must come from a page you found; leave a field empty if you did not find it.
Return JSON only: {"suppliers":[{"name":"","city":"","phone":"","whatsapp":"","email":"","website":"","cr_no":"","categories":["Marble|Granite|Porcelain|Ceramic|Civil|Fixing|Other"],"note":"<what they sell, one line>","source_url":"<page where you found it>"}]} with at most 8 suppliers.`, { webSearch: 6, max: 4000 });
      return json(asJson(text));
    }

    if (task === "audit_takeoff") {
      // Second AI (the auditor): checks the estimator's lines against what was read from the BOQ / drawings / specs.
      // It only checks and flags; the app's own code does every calculation (waste, cost, margin).
      if (role !== "admin") return json({ error: "Only Super-Admin" }, 403);
      return json(asJson(await claude(`You are a senior quantity surveyor for a stone, marble, granite and porcelain cladding and flooring contractor in Riyadh.
A junior estimator prepared these quotation lines: ${JSON.stringify(p.lines).slice(0, 30000)}
What was read from the client's BOQ / drawings / specs (may be empty): ${JSON.stringify(p.source || {}).slice(0, 40000)}
Check every line, strictly and without guessing:
- quantity and unit match the BOQ/drawing (m² vs lm vs pcs); flag anything that looks copied wrong (extra zero, m² used for running metres)
- material, finish, thickness and size are stated and plausible for KSA (cladding 20-30 mm stone, 30-40 mm for heavy panels; tiles 60x60, 60x120, 80x80, 120x120 cm common); flag odd sizes or thickness
- waste % is realistic for the material and pattern (stone cladding 10-15%, book-match / cut pieces / curves 15-20%)
- items usually needed but missing from the quotation (skirting, risers, steps, coping, window sills, cut edges, anchors/brackets, adhesive, grout, sealant, mock-up, protection)
- contradictions between BOQ, drawings and specs that need an RFI to the consultant
Return JSON only: {"lines":[{"i":<line index>,"level":"ok|warn|high","issue":"<short, plain English>","suggest_qty":<number or null>}],"missing":["<item>"],"rfis":["<question for the consultant>"],"summary":"<2 short lines in simple Roman Urdu>"}`, { model: MODEL_STRONG, max: 4000 })));
    }

    if (task === "advise") {
      // Advisor agent: suggests a rate per line from this owner's own history and preferences, with the reason.
      if (role !== "admin") return json({ error: "Only Super-Admin" }, 403);
      const { data: prefs } = await admin.from("preferences").select("key, value");
      const { data: hist } = await admin.from("quotes").select("title, status, lost_reason, lines").in("status", ["Approved", "Lost", "Sent to Client"]).order("updated_at", { ascending: false }).limit(40);
      const text = await claude(`You advise the owner of a stone and flooring contractor in Saudi Arabia on quotation rates (SAR, before VAT).
Owner's preferences: ${JSON.stringify(prefs)}
Past quotations with outcome (learn which margins win and which lose): ${JSON.stringify(hist).slice(0, 60000)}
This quotation, with the known cost / last quoted / AI-estimate price for each line: ${JSON.stringify(p.quote).slice(0, 30000)}
For every line suggest a rate rounded as the preferences say, and give a one-line reason (cost + margin, what won before, risk). Never go below cost plus the minimum margin. If there is no cost, say so and suggest asking suppliers instead of guessing.
Return JSON only: {"lines":[{"i":<line index>,"rate":<number or null>,"reason":"<short>"}],"summary":"<2-3 short lines of advice in simple Roman Urdu>"}`, { max: 3000 });
      return json(asJson(text));
    }

    if (task === "ask") {
      // Every account has its own assistant. The data comes from the phone, which only ever holds what that role may see.
      const text = await claude(`You are the personal assistant of a ${role} inside a stone and flooring contractor's ERP in Saudi Arabia. Explain simply, like to someone new to apps. Answer using ONLY this data. Numbers with digits and SAR. If the data does not hold the answer, say what is missing. Short and plain, in the language of the question.
DATA: ${JSON.stringify(p.data).slice(0, 150000)}
QUESTION: ${String(p.question).slice(0, 1000)}`);
      return json({ text });
    }

    if (task === "estimate") {
      if (!["admin", "abu"].includes(role)) return json({ error: "Not allowed" }, 403);
      return json(asJson(await claude(`Give a rough current Saudi Arabia market COST price (supply only, before VAT, SAR per ${p.unit || "unit"}) for: ${p.name}. Return JSON only: {"low":n,"high":n,"typical":n,"note":"<one short line on what drives the price>"}. This is an estimate from general knowledge, not a quote.`)));
    }

    if (task === "match") {
      return json(asJson(await claude(`A user of a stone & flooring price list searches: "${p.query}". Items: ${JSON.stringify(p.items).slice(0, 40000)}. Return JSON only: {"ids":["<best matching item ids, best first, max 8>"],"why":"<short>"}`)));
    }
    // ───────── Morning briefing (main agent). Runs when Super-Admin opens the app: once a day, no secret key needed. ─────────
    if (task === "briefing") {
      if (role !== "admin") return json({ error: "Only Super-Admin" }, 403);
      const riyadhDay = (t: string | number | Date) => new Date(new Date(t).getTime() + 3 * 3600e3).toISOString().slice(0, 10);
      const { data: last } = await admin.from("agent_reports").select("created_at").eq("for_role", "admin").order("created_at", { ascending: false }).limit(1);
      const lastAt = last?.[0]?.created_at;
      if (lastAt && riyadhDay(lastAt) === riyadhDay(Date.now()) && !(p.force && Date.now() - Date.parse(lastAt) > 30 * 60e3)) return json({ skipped: true, at: lastAt });
      const items: { level: "bad" | "warn"; text: string }[] = [];
      const since = new Date(Date.now() - 2 * 864e5).toISOString();
      const [{ data: ledger }, { data: subs }, { data: quotes }, { data: inq }, { data: reqs }, { data: txns }, { data: prog }, { data: rfis }, { data: outr }, { data: posts }] = await Promise.all([
        admin.from("project_ledger").select("*"),
        admin.from("subcontractors").select("name, rate"),
        admin.from("quotes").select("title, status, lines, updated_at, rfq"),
        admin.from("inquiries").select("ref, subject, status, deadline, created_at"),
        admin.from("supplier_requests").select("status, sent_at, suppliers(name)").eq("status", "Sent"),
        admin.from("txns").select("type, flags, created_at, amount, total, gross").gte("created_at", since).eq("status", "active"),
        admin.from("progress").select("sub_name, flags, created_at").gte("created_at", since).eq("status", "active"),
        admin.from("rfis").select("ref, subject, status, due_date, sent_at, follow_ups, to_name"),
        admin.from("outreach_contacts").select("name, company, status, last_contact, emails"),
        admin.from("blog_posts").select("title, status, created_at, published_at").order("created_at", { ascending: false }).limit(5),
      ]);
      (ledger || []).forEach((l: any) => { if (Number(l.profit) < 0 && Number(l.gross) > 0) items.push({ level: "bad", text: `${l.name}: loss ${l.profit} SAR` }); if (Number(l.sub_due) > 0) items.push({ level: "warn", text: `${l.name}: subcontractors are owed ${l.sub_due} SAR` }); });
      (subs || []).filter((x: any) => !(Number(x.rate) > 0)).forEach((x: any) => items.push({ level: "bad", text: `Subcontractor ${x.name} has no rate` }));
      (quotes || []).filter((q: any) => ["Draft", "Abu Review"].includes(q.status)).forEach((q: any) => { const n = (q.lines || []).filter((l: any) => !(Number(l.rate) > 0)).length; if (n) items.push({ level: "warn", text: `Quotation "${q.title}": ${n} line(s) without a rate` }); });
      (quotes || []).filter((q: any) => q.status === "Draft" && !q.rfq?.lock && (q.lines || []).length && (q.lines || []).every((l: any) => Number(l.rate) > 0)).forEach((q: any) => { const days = Math.floor((Date.now() - Date.parse(q.updated_at)) / 864e5); items.push({ level: days >= 2 ? "bad" : "warn", text: `Quotation "${q.title}" waits for your Approve & Lock${days ? ` since ${days} day(s)` : ""}` }); });
      (inq || []).forEach((q: any) => {
        if (q.status === "New") items.push({ level: "warn", text: `Query ${q.ref} "${q.subject}" not reviewed yet` });
        if (q.deadline && !["Sent", "Won", "Lost"].includes(q.status)) { const d = Math.ceil((Date.parse(q.deadline) - Date.now()) / 864e5); if (d <= 2) items.push({ level: "bad", text: `Query ${q.ref} is due in ${d} day(s)` }); }
      });
      (reqs || []).forEach((r: any) => { if (r.sent_at && Date.now() - Date.parse(r.sent_at) > 2 * 864e5) items.push({ level: "warn", text: `${r.suppliers?.name ?? "Supplier"} has not replied for 2 days` }); });
      (txns || []).forEach((x: any) => (x.flags || []).forEach((f: string) => items.push({ level: "warn", text: `${x.type} ${x.amount ?? x.total ?? x.gross}: ${f}` })));
      (prog || []).forEach((x: any) => (x.flags || []).forEach((f: string) => items.push({ level: "warn", text: `Progress ${x.sub_name}: ${f}` })));
      (rfis || []).forEach((r: any) => {
        if (r.status === "Draft") items.push({ level: "warn", text: `${r.ref} "${r.subject}" is written but not sent` });
        if (r.status === "Sent" && r.due_date && Date.parse(r.due_date) < Date.now()) items.push({ level: "bad", text: `${r.ref} to ${r.to_name || "consultant"}: no answer, due ${r.due_date} - send a follow-up` });
        if (r.status === "Answered") items.push({ level: "warn", text: `${r.ref} answered - apply it to the quotation` });
      });
      (outr || []).forEach((o: any) => { if (o.status === "Emailed" && o.last_contact && Date.now() - Date.parse(o.last_contact) > 7 * 864e5 && (o.emails || []).length < 3) items.push({ level: "warn", text: `Outreach: ${o.name}${o.company ? ` (${o.company})` : ""} has not replied for 7 days - one polite follow-up` }); });
      if (!(posts || []).some((x: any) => Date.now() - Date.parse(x.created_at) < 36 * 3600e3)) items.push({ level: "warn", text: "No blog post written since yesterday - write today's post (SEO)" });
      let summary = items.length ? `${items.filter((i) => i.level === "bad").length} urgent, ${items.filter((i) => i.level === "warn").length} to check.` : "Sab theek hai. Koi khula masla nahi.";
      try {
        summary = (await claude(`You are the main agent of a stone and flooring contractor's ERP in Saudi Arabia. Write the owner's morning briefing in simple Roman Urdu, numbers as digits, exactly these 5 lines:
Projects: <which projects need attention>
Alerts: <data errors or anomalies caught, or "Koi nahi">
Procurement: <supplier/price/RFI item to act on, one sentence>
Paisa: <money impact in SAR from the items>
Agla kaam: <the one button or approval the owner should do next>
Use only these items, never invent: ${JSON.stringify(items.slice(0, 80))}`, { max: 600, model: MODEL_FAST })).trim() || summary;
      } catch { /* keep the plain summary */ }
      await admin.from("agent_reports").insert({ for_role: "admin", summary, items });
      return json({ ok: true, items: items.length });
    }

    // ───────── RFI: one formal letter from the open questions; follow-ups; reading the consultant's answer. ─────────
    if (task === "rfi_letter") {
      if (role !== "admin") return json({ error: "Only Super-Admin" }, 403);
      const lang = p.lang === "ar" ? "Arabic" : "English";
      return json(asJson(await claude(`Write a formal Request for Information (RFI) email in ${lang} from "${p.signature || "Al-Swati Contracting"}" (stone, marble, granite and porcelain cladding and flooring contractor, Saudi Arabia) to ${p.to_name || "the consultant"} about the project / tender "${p.project || ""}". Reference: ${p.ref || ""}.
Questions (keep every one, number them, keep BOQ item / drawing references exactly as given, do not add new questions, do not answer them): ${JSON.stringify(p.questions).slice(0, 12000)}
Ask for a reply by ${p.due || "the date stated"} because the price depends on it. Polite, short, professional Saudi business tone. No invented facts.
Return JSON only: {"subject":"<${p.ref || "RFI"} - short subject>","body":"<full email text>"}`, { max: 2500, model: MODEL_FAST })));
    }
    if (task === "rfi_followup") {
      if (role !== "admin") return json({ error: "Only Super-Admin" }, 403);
      const lang = p.lang === "ar" ? "Arabic" : "English";
      return json(asJson(await claude(`Write a short, polite follow-up email in ${lang} from "${p.signature || "Al-Swati Contracting"}" to ${p.to_name || "the consultant"} about RFI ${p.ref} "${p.subject}" sent on ${p.sent_on}, which has no answer yet. This is follow-up number ${p.n || 1}. Remind them the quotation is waiting for these answers; list the open questions briefly: ${JSON.stringify(p.questions).slice(0, 6000)}. Not pushy. No invented facts.
Return JSON only: {"subject":"","body":""}`, { max: 1200, model: MODEL_FAST })));
    }
    if (task === "rfi_apply") {
      // Reads the consultant's answer and proposes exact changes to the quotation lines. Nothing is changed until the owner applies it.
      if (role !== "admin") return json({ error: "Only Super-Admin" }, 403);
      return json(asJson(await claude(`A stone and flooring contractor in Saudi Arabia sent this RFI: ${JSON.stringify(p.questions).slice(0, 8000)}
The consultant answered: """${String(p.answer || "").slice(0, 12000)}"""
Current quotation lines (index i): ${JSON.stringify(p.lines).slice(0, 20000)}
For each question say what the answer is. Then propose ONLY the changes the answer clearly requires: a new quantity, a new description (material, finish, size, thickness), a line to add, or a line to remove. If the answer is unclear or does not answer a question, say so and propose no change for it. Never change a rate or cost: prices are re-checked by the owner. Material changes that need new supplier prices go in "supplier_items".
Return JSON only: {"answers":[{"q":"<question>","answer":"<short>","clear":true|false}],
"changes":[{"op":"edit|add|remove","i":<line index or null for add>,"desc":"<new description or null>","qty":<new qty or null>,"unit":"<unit or null>","why":"<which answer>"}],
"supplier_items":[{"desc":"","qty":<n|null>,"unit":""}],"still_open":["<question still not answered>"],"summary_ur":"<2 short lines in simple Roman Urdu>"}`, { model: MODEL_STRONG, max: 4000 })));
    }

    // ───────── SEO: topics and blog posts for the company website. Facts only from the company profile; no invented projects. ─────────
    if (task === "seo_topics") {
      if (role !== "admin") return json({ error: "Only Super-Admin" }, 403);
      return json(asJson(await claude(`Company profile (use only this about the company): ${JSON.stringify(p.profile || {})}
Already written posts: ${JSON.stringify(p.done || []).slice(0, 4000)}
Suggest 14 blog topics that people in Saudi Arabia actually search for when they need a stone, marble, granite or porcelain cladding / flooring contractor (owners, developers, project managers, consultants) in ${(p.cities || ["Riyadh", "Dammam", "Al-Hassa"]).join(", ")}. Mix English and Arabic topics. Practical and useful (choosing stone for Riyadh heat, dry-fix vs wet-fix cladding, maintenance, cost factors, approvals and samples), never clickbait, not already written.
Return JSON only: {"topics":[{"title":"","lang":"en|ar","keyword":"<main search phrase>","why":"<one line>"}]}`, { max: 2500, webSearch: 3, model: MODEL_FAST })));
    }
    if (task === "blog") {
      if (role !== "admin") return json({ error: "Only Super-Admin" }, 403);
      const lang = p.lang === "ar" ? "Arabic" : "English";
      return json(asJson(await claude(`Write a helpful blog post in ${lang} for the website of this company. Company profile (the ONLY facts you may state about the company; never invent projects, clients, years, numbers, certificates, awards or prices): ${JSON.stringify(p.profile || {})}
Topic: "${p.topic}". Main search phrase: "${p.keyword || p.topic}".
Rules: 700-1000 words, clear headings (##), short paragraphs, practical advice for Saudi conditions (heat, sand, Saudi Building Code where relevant - only say what you are sure of; if you mention a standard or figure, check it with search). Use the search phrase naturally in the title, the first paragraph and one heading; no keyword stuffing. End with a short, honest call to contact the company using the phone/email in the profile (if given). Plain, human tone; no hype words like "best", "No. 1", "leading".
Return JSON only: {"title":"<max 60 chars>","slug":"<latin lowercase words with dashes>","meta_description":"<max 155 chars>","keywords":["",""],"body":"<markdown>"}`, { max: 5000, webSearch: 3 })));
    }

    // ───────── Outreach: one personal email at a time to someone the owner knows; he reads, edits and sends it himself. ─────────
    if (task === "outreach_email") {
      if (role !== "admin") return json({ error: "Only Super-Admin" }, 403);
      const c = p.contact || {};
      const lang = p.lang === "ar" ? "Arabic" : "English";
      return json(asJson(await claude(`Write a short personal ${p.kind === "follow-up" ? "follow-up " : ""}email in ${lang} from ${p.signature || "the owner of Al-Swati Contracting"} to ${c.name}${c.role ? `, ${c.role}` : ""}${c.company ? ` at ${c.company}` : ""}${c.city ? ` in ${c.city}` : ""}.
How we know them: ${c.source || "not stated"}. Notes: ${c.notes || "-"}. ${p.kind === "follow-up" ? `Earlier email(s): ${JSON.stringify((c.emails || []).slice(-2)).slice(0, 3000)}` : ""}
Company profile (the ONLY facts you may state about the company; never invent projects, clients, numbers or claims): ${JSON.stringify(p.profile || {})}
Purpose: introduce our stone / marble / granite / porcelain cladding and flooring work and ask if they have current or upcoming projects where we could quote (BOQ / drawings welcome). 90-140 words, specific to their role and city, plain and respectful, one clear question, no hype, no pressure, no fake urgency. ${p.kind === "follow-up" ? "One short gentle reminder only." : ""}
Last line: "If you prefer not to receive emails from us, just reply 'no thanks' and we will not write again." (in ${lang}).
Return JSON only: {"subject":"<short, specific, not salesy>","body":""}`, { max: 1200, model: MODEL_FAST })));
    }

    // ───────── Files shared as links in a query (Google Drive, Google Sheets, Dropbox) → downloaded and attached. ─────────
    if (task === "attach_links") {
      if (role !== "admin") return json({ error: "Only Super-Admin" }, 403);
      const { data: q } = await admin.from("inquiries").select("body, attachments").eq("id", p.inquiry_id).single();
      if (!q) return json({ error: "Query not found" }, 404);
      let body = String(q.body || ""); const atts = [...(q.attachments || [])]; const notes: string[] = []; let added = 0;
      for (const l of shareLinks(body + "\n" + String(p.text || ""))) {
        const f = await fetchShared(l.url, l.label);
        if ("note" in f) { notes.push(f.note); continue; }
        const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
        const up = await admin.storage.from("inbox").upload(path, f.bytes, { contentType: f.type });
        if (up.error) { notes.push(`${f.name}: ${up.error.message}`); continue; }
        atts.push({ path, name: f.name, type: f.type }); added++;
        if (/\.(xlsx|xls|csv)$/i.test(f.name) || /spreadsheet|excel|csv/i.test(f.type)) {
          try { const wb = XLSX.read(f.bytes, { type: "array" }); for (const sh of wb.SheetNames) body += `\n\n=== ${f.name} / ${sh} ===\n` + XLSX.utils.sheet_to_csv(wb.Sheets[sh], { blankrows: false }); } catch { /* keep the file */ }
        }
      }
      if (notes.length) body += "\n\n" + notes.map((n) => `=== ${n} ===`).join("\n");
      await admin.from("inquiries").update({ body: body.slice(0, 200000), attachments: atts }).eq("id", p.inquiry_id);
      return json({ added, notes });
    }

    // ───────── Reply to a client query: the owner picks what to say, the AI writes it, he approves it into a Gmail draft. ─────────
    if (task === "query_reply") {
      if (role !== "admin") return json({ error: "Only Super-Admin" }, 403);
      const { data: q } = await admin.from("inquiries").select("ref, subject, from_name, from_email, body, reading, deadline").eq("id", p.inquiry_id).single();
      if (!q) return json({ error: "Query not found" }, 404);
      const KINDS: Record<string, string> = {
        received: "Thank them, confirm we received the enquiry and its files, and say when they can expect our quotation (use the date given by the owner, or say 'within the requested deadline').",
        missing: "Thank them and politely ask for the missing documents / information listed below, explaining the price depends on them.",
        rfi: "Ask the technical clarification questions listed below, numbered, before we can price accurately.",
        quotation: "Send our quotation: say it is attached, give the total before VAT and with 15% VAT exactly as given below, validity and payment terms as given. Invite questions and a meeting.",
        decline: "Politely decline this enquiry for the reason given, keep the door open for future projects.",
        custom: "Write what the owner asks for below.",
      };
      const lang = p.lang === "ar" ? "Arabic" : "English";
      return json(asJson(await claude(`Write an email reply in ${lang} from "${p.signature || "Al-Swati Contracting"}" to ${q.from_name || "the client"} about their enquiry "${q.subject || q.ref}" (our ref ${q.ref}).
Purpose: ${KINDS[p.kind] || KINDS.custom}
Details from the owner (use exactly, never change numbers): ${String(p.details || "-").slice(0, 4000)}
Their email (for context only): """${String(q.body || "").slice(0, 3000)}"""
Short, polite, professional Saudi business tone. No invented facts, prices, dates or promises.
Return JSON only: {"subject":"<Re: ... >","body":"<email text>"}`, { max: 1500, model: MODEL_FAST })));
    }

    // ───────── Technical proposal: company profile + quotation + what was read from the specs → proposal sections. ─────────
    if (task === "tech_proposal") {
      if (role !== "admin") return json({ error: "Only Super-Admin" }, 403);
      const { data: q } = await admin.from("quotes").select("title, client, lines, rfq").eq("id", p.quote_id).single();
      if (!q) return json({ error: "Quotation not found" }, 404);
      let reading: any = null;
      if (q.rfq?.inquiry_id) { const { data: inq } = await admin.from("inquiries").select("reading").eq("id", q.rfq.inquiry_id).maybeSingle(); reading = inq?.reading?.a || null; }
      const { data: prof } = await admin.from("preferences").select("value").eq("key", "company_profile").maybeSingle();
      const lines = (q.lines || []).map((l: any, i: number) => ({ i: i + 1, desc: l.desc, qty: l.qty, unit: l.unit }));
      return json(asJson(await claude(`Write the technical proposal (not the price) that a stone, marble, granite and porcelain cladding / flooring contractor in Saudi Arabia submits with its bid.
Project: "${q.title}" for ${q.client || "the client"}.
Scope (quotation lines, quantities as given): ${JSON.stringify(lines).slice(0, 15000)}
Specification points read from the tender documents: ${JSON.stringify(reading?.specs || []).slice(0, 8000)}
Owner's choices: fixing method = ${p.fixing || "as per specification"}; stone origin = ${p.origin || "as per specification"}; programme start = ${p.start || "on award"}; site team = ${p.team || "not stated"}; notes = ${p.notes || "-"}.
Company profile (the ONLY facts you may state about the company; never invent projects, clients, years, certificates or staff numbers): ${JSON.stringify(prof?.value || {})}
Write in ${p.lang === "ar" ? "Arabic" : "English"}. Practical, specific to this scope, standard good practice in Saudi Arabia (SBC, manufacturer instructions, consultant approval of samples and shop drawings). Where the spec is silent, write "to be confirmed with the consultant" instead of guessing. The programme must come from the quantities and a stated daily output assumption (say the assumption). Keep each section 100-250 words.
Return JSON only: {"sections":[{"title":"1. Understanding of the project and scope","body":"<markdown: paragraphs and - bullets>"},{"title":"2. Materials and specifications","body":""},{"title":"3. Method statement","body":""},{"title":"4. Programme","body":""},{"title":"5. Quality assurance and control","body":""},{"title":"6. Health, safety and environment","body":""},{"title":"7. Submittals and approvals","body":""},{"title":"8. Assumptions and exclusions","body":""}],"open_points":["<what the owner must confirm before sending>"]}`, { max: 7000 })));
    }

    return json({ error: "Unknown task" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
