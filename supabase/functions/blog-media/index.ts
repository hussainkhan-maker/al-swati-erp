// Edge Function "blog-media": when the owner publishes a blog post, this gives it
//  • "image":  a picture for its topic, made by Google's image AI (Gemini), saved in the public "blog" storage, and
//  • "arabic": its Arabic twin, written the way Saudi companies write (clear Arabic with the words Saudi clients use and search),
//              saved as a second post linked by twin_id, with the same picture and the same status.
// Only Super-Admin can call it (same sign-in rules as the "ai" function). Nothing here invents facts: the Arabic keeps the
// English post's facts, and the picture is an illustration of the topic (never shown as "our project").
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
  const top = t.slice(0, i), body = t.slice(i).replace(/^---\s*\n?/, "").trim();
  const head = (k: string) => (top.match(new RegExp("^\\s*\\**" + k + "\\**\\s*:\\s*(.+)$", "mi"))?.[1] ?? "").replace(/^\*+\s*|\s*\*+$/g, "").trim();
  return { title: head("TITLE"), meta_description: head("META"), keywords: head("KEYWORDS").split(/[,،]/).map((s) => s.trim()).filter(Boolean), body };
}

async function claude(prompt: string, max: number) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(120000),
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

// ───────── Arabic twin ─────────
async function arabic(post: any) {
  const prompt = `You write Arabic web content for Al-Swati Contracting, a natural stone, marble, granite and porcelain cladding and flooring contractor in Saudi Arabia (Riyadh, Dammam, Al-Hassa).
Rewrite the article below in Arabic for clients in Saudi Arabia (villa owners, developers, consultants, project managers).
Language: clear, simple Arabic the way Saudi companies write on their own websites - fluent Modern Standard Arabic with the words Saudi clients really use and search for (for example: تكسيات حجر، تكسية واجهات، واجهات حجر طبيعي، تركيب حجر ميكانيكي، تركيب رخام، جرانيت، بورسلان، مقاول حجر، فلل، الرياض، الدمام، الأحساء، ريال). Not spoken dialect, not stiff word-for-word translation: it must read as if a Saudi writer wrote it.
Rules:
- Keep every fact, figure and piece of advice. Add NO new facts about the company (no projects, years, clients, prices, certificates).
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
  let out: any;
  try { out = parsePost(await (CLAUDE_KEY ? claude(prompt, 8000) : geminiText(prompt, 8000))); }
  catch (e) { if (!GEMINI_KEY || !CLAUDE_KEY) throw e; out = parsePost(await geminiText(prompt, 8000)); } // second chance with the other AI
  if (!out?.title || String(out.body || "").length < 400) throw new Error("The Arabic version came back too short. Try again.");
  return out;
}

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
  const prompt = `A realistic, professional photograph to illustrate a blog article for a natural stone, marble, granite and porcelain cladding and flooring contractor in Saudi Arabia.
Article title: "${post.title}". Topic words: ${(post.keywords || []).join(", ")}.
What the article is about: ${String(post.body || "").replace(/[#*\-]/g, " ").replace(/\s+/g, " ").slice(0, 600)}
Show the subject of the article clearly and accurately (for example the right kind of stone, facade, floor or fixing work), in a setting that fits Saudi Arabia (modern Riyadh villa or building, bright desert daylight) when a setting is shown.
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

async function picture(post: any) {
  const pic = await makePicture(post);
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

    const { data: post } = await db.from("blog_posts").select("*").eq("id", String(body.id || "")).maybeSingle();
    if (!post) return json({ error: "Post not found" }, 404);

    if (body.action === "image") return json(await picture(post));

    if (body.action === "arabic") {
      if (post.lang === "ar") return json({ error: "This post is already in Arabic." }, 400);
      if (post.twin_id) { const { data: tw } = await db.from("blog_posts").select("*").eq("id", post.twin_id).maybeSingle(); if (tw) return json({ post: tw, existed: true }); }
      const a = await arabic(post);
      let slug = `${post.slug || "post"}-ar`.slice(0, 80);
      const { data: same } = await db.from("blog_posts").select("id").eq("slug", slug).maybeSingle();
      if (same) slug += "-" + Date.now().toString(36).slice(-4);
      const now = new Date().toISOString();
      const { data: tw, error } = await db.from("blog_posts").insert({
        slug, lang: "ar", title: String(a.title).slice(0, 90), meta_description: String(a.meta_description || "").slice(0, 170),
        keywords: (Array.isArray(a.keywords) ? a.keywords : []).map((k: any) => String(k).trim()).filter(Boolean).slice(0, 8), body: String(a.body),
        status: post.status, published_at: post.status === "Published" ? (post.published_at || now) : null, source: post.source || "manual",
        image_url: post.image_url, image_alt: post.image_url ? String(a.title).slice(0, 120) : null, twin_id: post.id, created_by: USER_ID,
      }).select().single();
      if (error) throw new Error("Saving the Arabic post: " + error.message);
      await db.from("blog_posts").update({ twin_id: tw.id }).eq("id", post.id);
      return json({ post: tw });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("blog-media", TASK, String((e as Error).message || e)); // shows in the function's Logs
    return json({ error: String((e as Error).message || e).slice(0, 400) }, 500);
  }
});
