// Edge Function "ai": the only place the Anthropic API key lives.
// Tasks: parse (spoken/typed note → one action), receipt (photo → lines), rfq (BOQ read twice), ask (owner's questions), estimate (market price).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = Deno.env.get("AI_MODEL") ?? "claude-sonnet-5-5";
const MODEL_STRONG = Deno.env.get("AI_MODEL_STRONG") ?? "claude-opus-5-5";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" };
const LANG: Record<string, string> = { ar: "Arabic", ur: "Urdu", en: "English" };

type Img = { media_type: string; data: string };
async function claude(prompt: string, opts: { images?: Img[]; model?: string; max?: number; webSearch?: number } = {}) {
  const content: unknown[] = (opts.images ?? []).map((i) => i.media_type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: i.data } }
    : { type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } });
  content.push({ type: "text", text: prompt });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: opts.model ?? MODEL, max_tokens: opts.max ?? 2000, messages: [{ role: "user", content }],
      ...(opts.webSearch ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: opts.webSearch, user_location: { type: "approximate", country: "SA" } }] } : {}) }),
  });
  if (!r.ok) throw new Error(`AI ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return (j.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
    const { data: u } = await user.auth.getUser();
    if (!u?.user) return json({ error: "Sign in first" }, 401);
    const admin = createClient(URL_, SERVICE);
    const { data: prof } = await admin.from("profiles").select("role, active").eq("id", u.user.id).single();
    if (!prof?.active) return json({ error: "Account not active" }, 403);
    const role = prof.role as string;
    const { task, ...p } = await req.json();

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
      const img = await imageFrom(admin, "receipts", p.path);
      const prompt = `This image is a purchase receipt or invoice from Saudi Arabia (Arabic and/or English). Read it carefully. Return JSON only:
{"supplier":"<name>","date":"YYYY-MM-DD or null","lines":[{"name":"<item as written; add English if Arabic>","qty":<n>,"unit":"<unit>","price":<unit price before VAT>,"total":<line total before VAT>}],"subtotal":<before VAT>,"vat":<VAT amount or 0>,"total":<grand total>,"confidence":"high|medium|low","notes":"<anything unclear>"}
Digits 0-9. If something is unreadable use null and say so in notes. Do not guess.`;
      return json(asJson(await claude(prompt, { images: [img] })));
    }

    if (task === "rfq") {
      if (role !== "admin") return json({ error: "Only Super-Admin" }, 403);
      const imgs: Img[] = [];
      if (p.inquiry_id) {
        const { data: q } = await admin.from("inquiries").select("body, attachments").eq("id", p.inquiry_id).single();
        p.text = [p.text, q?.body].filter(Boolean).join("\n\n");
        for (const a of (q?.attachments || []).filter((a: any) => /^image\/|pdf$/i.test(a.type || "")).slice(0, 5)) {
          try { const f = await imageFrom(admin, "inbox", a.path); if (/pdf/i.test(a.type)) f.media_type = "application/pdf"; imgs.push(f); } catch { /* skip unreadable file */ }
        }
      }
      if (p.path) imgs.push(await imageFrom(admin, "documents", p.path));
      const prompt = `You read a construction RFQ / BOQ for a stone, marble, granite, porcelain and flooring contractor in Saudi Arabia. Extract every priced line exactly as given. Return JSON only:
{"lines":[{"ref":"<item no>","desc":"<full description incl. material, size, thickness, finish>","qty":<number>,"unit":"sqm|rft|lm|no|ton|ls","category":"Marble|Granite|Porcelain|Ceramic|Civil|Fixing|Other"}],
 "documents":[{"name":"<file or section>","kind":"drawing|boq|specification|letter|other","summary":"<one line: what it contains>"}],
 "specs":["<each requirement from specifications: material grade, thickness, finish, fixing method, standards, samples, warranty>"],
 "drawingQuantities":[{"what":"<area or element>","qty":<number>,"unit":"sqm|lm|no","source":"<which drawing / DXF layer>"}],
 "rfis":["<contradiction between BOQ, drawings and specs, or missing spec, to ask the consultant>"],"siteChecks":["<what must be verified on site before work>"],"notes":"<anything unclear>"}
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
      return json(result);
    }

    if (task === "supplier_msg") {
      if (!["admin", "abu"].includes(role)) return json({ error: "Not allowed" }, 403);
      const lang = LANG[p.lang] ?? "Arabic";
      const text = await claude(`Write a short, polite WhatsApp message in ${lang} from a stone and flooring contractor in Saudi Arabia to a supplier named "${p.supplier}", asking for their best price (before VAT), stock availability and delivery time for these items in ${p.city || "Riyadh"}:
${JSON.stringify(p.items)}
List each item on its own line with size and quantity. Ask them to reply with unit prices. Sign as "${p.signature || "Al-Swati"}". Plain text only, no markdown. Do not invent anything not given.`, { max: 800 });
      return json({ text: text.trim() });
    }

    if (task === "find_suppliers") {
      // Supplier finder agent: searches the web, returns candidates for the owner to approve. Nothing is added by itself.
      if (!["admin", "abu"].includes(role)) return json({ error: "Not allowed" }, 403);
      const text = await claude(`Find real suppliers in Saudi Arabia for: ${String(p.material).slice(0, 200)}${p.city ? `, preferably in or delivering to ${p.city}` : ""}. Search the web (company websites, Google business listings, Saudi directories). Only Saudi-registered businesses. Do not invent anything: every field must come from a page you found; leave a field empty if you did not find it.
Return JSON only: {"suppliers":[{"name":"","city":"","phone":"","whatsapp":"","email":"","website":"","cr_no":"","categories":["Marble|Granite|Porcelain|Ceramic|Civil|Fixing|Other"],"note":"<what they sell, one line>","source_url":"<page where you found it>"}]} with at most 8 suppliers.`, { webSearch: 6, max: 4000 });
      return json(asJson(text));
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
    return json({ error: "Unknown task" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
