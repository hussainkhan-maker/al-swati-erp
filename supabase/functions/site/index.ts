// Edge Function "site": turns what a supervisor says or types on site into clean lines.
//  kind "material": an order for accessories (angles, glue, bolts, anchors…)  → Arabic item lines for the supplier
//  kind "stone":    stone sizes to order ("30×60, 20 pieces, for the entrance")  → size lines
//  kind "measure":  measured work of a subcontractor ("column 3.2 by 0.6, ceiling 4 by 2 minus 0.5") → length, width, deduction
// The app does every sum; this function only reads the words. Any signed-in, active account may use it.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const db = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const MODEL = Deno.env.get("AI_MODEL_SITE") ?? "claude-sonnet-5-5";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" };

const SYSTEM = `You read short site notes of a stone cladding contractor in Saudi Arabia. The speaker is a site supervisor who mixes Urdu, Arabic and English; speech recognition may spell words badly. Return ONLY JSON, no other text.
Rules: never invent an item, a size or a number. Copy every number exactly as said, in digits 0-9. If something is unclear, keep the speaker's own words in "note" and leave the number null.
Site words: zawiya / زاوية = angle (bracket); tool / طول = length; ard / عرض = width; khasam / خصم = deduction (opening to subtract); amood / عمود = column; saqaf / سقف = ceiling or soffit; deewar / jidar / جدار = wall; seedhi deewar = straight wall; habba / حبة = piece; kartoon / كرتون = carton; bolt / مسمار / برغي; glue brands such as Abu Jamal (أبو جمال) or Om Jamal (أم جمال) are kept as brand names.`;

const TASK: Record<string, string> = {
  material: `This is an ORDER for accessories and materials. Write each item name in Arabic the way a Saudi building-materials shop writes it; keep brand names; if you do not know the Arabic trade word, keep the speaker's own word. Return {"party":"<supplier or shop if said, else empty>","lines":[{"name":"<item in Arabic>","size":"<size or type as said, e.g. 5×5 سم, M10×100>","qty":<number or null>,"unit":"<حبة, كرتون, كيس, متر… as said, else حبة>","note":"<anything else said about it>"}]}`,
  stone: `This is a list of STONE SIZES to order. Sizes are in centimetres unless the speaker says metres (then convert to cm). Return {"party":"<supplier if said, else empty>","lines":[{"place":"<where it goes, if said>","l":<length cm>,"w":<width cm>,"qty":<pieces>,"note":"<stone type, thickness, finish or anything else said>"}]}`,
  measure: `This is the MEASURED WORK of a subcontractor. Lengths are in metres unless the speaker says cm (then convert to metres). Return {"party":"<subcontractor name if said, else empty>","lines":[{"place":"<the area or place, if said>","element":"<column, ceiling, straight wall, or other name as said; empty if not said>","l":<length m>,"w":<width or height m>,"deduct":<deduction in m², 0 if none>}]} One line per measured place. Do not multiply anything.`,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, st = 200) => new Response(JSON.stringify(b), { status: st, headers: { ...cors, "content-type": "application/json" } });
  try {
    const u = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: who } = await u.auth.getUser();
    if (!who?.user) return json({ error: "Sign in first" }, 401);
    const { data: prof } = await db.from("profiles").select("role, active").eq("id", who.user.id).single();
    if (!prof?.active || !["admin", "abu", "supervisor"].includes(prof.role)) return json({ error: "Not allowed" }, 403);
    const p = await req.json().catch(() => ({}));
    const kind = String(p.kind || ""), text = String(p.text || "").slice(0, 3000).trim();
    if (!TASK[kind] || !text) return json({ error: "Nothing to read" }, 400);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 2500, system: SYSTEM, messages: [{ role: "user", content: `${TASK[kind]}\n${p.names?.length ? "Known names (subcontractors, suppliers): " + JSON.stringify(p.names).slice(0, 1500) + "\n" : ""}THE NOTE: ${text}` }] }),
    });
    if (!r.ok) return json({ error: `AI ${r.status}: ${(await r.text()).slice(0, 200)}` }, 502);
    const j = await r.json();
    const us = j.usage || {};
    await db.from("ai_usage").insert({ user_id: who.user.id, task: "site_" + kind, model: MODEL, input_tokens: us.input_tokens || 0, output_tokens: us.output_tokens || 0 }).then(() => {}, () => {});
    const out = (j.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
    const a = out.indexOf("{"), b = out.lastIndexOf("}");
    if (a < 0 || b <= a) return json({ error: "Could not read it. Say it again, one item at a time." }, 422);
    const parsed = JSON.parse(out.slice(a, b + 1));
    return json({ party: String(parsed.party || "").slice(0, 120), lines: Array.isArray(parsed.lines) ? parsed.lines.slice(0, 80) : [] });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
