// Edge Function "site": turns what a supervisor says or types on site into clean lines.
//  kind "material": an order for accessories (angles, glue, bolts, anchors…)  → Arabic item lines for the supplier
//  kind "stone":    stone sizes to order ("30×60, 20 pieces, for the entrance")  → size lines
//  kind "measure":  measured work of a subcontractor ("column 3.2 by 0.6, ceiling 4 by 2 minus 0.5") → length, width, deduction
// The app does every sum; this function only reads the words. Any signed-in, active account may use it.
// It keeps learning the team's own words: after a sheet is made final, action "learn" compares what was said with what was
// kept and saves new word pairs in preferences "site_terms"; every later reading gets that list.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const db = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const MODEL = Deno.env.get("AI_MODEL_SITE") ?? "claude-sonnet-5-5";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" };

const SYSTEM = `You read short site notes of a stone cladding contractor in Saudi Arabia. The speaker is a site supervisor who mixes Urdu, Arabic and English; speech recognition may spell words badly. Return ONLY JSON, no other text.
Rules: write exactly what was said. Never invent an item, a size or a number, never swap an item for a similar one, never tidy or round a size. Copy every number exactly as said, in digits 0-9. If something is unclear, keep the speaker's own words in "note" and leave the number null.
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
    const { data: tp } = await db.from("preferences").select("value").eq("key", "site_terms").maybeSingle();
    const terms: { said: string; means: string }[] = ((tp?.value as any)?.terms || []).filter((t: any) => t?.said && t?.means);
    // After "Final": what did the speaker say, and what did the team keep? New word pairs are remembered.
    if (p.action === "learn") {
      const heard = String(p.heard || "").slice(0, 3000), kept = JSON.stringify(p.lines || []).slice(0, 4000);
      if (!heard.trim() || kept.length < 5) return json({ ok: true, learned: 0 });
      const lr = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 700, system: SYSTEM, messages: [{ role: "user", content: `A supervisor said the NOTE; the FINAL LINES are what the team kept after correcting. List the site words, item names, brand names or ways of saying a size that this team uses and that a reader should remember next time: "said" = the word as spoken or as speech recognition wrote it, "means" = how the team writes it. Only pairs clearly supported by both texts, at most 6, none already in KNOWN. Return {"terms":[{"said":"","means":""}]}\nKNOWN: ${JSON.stringify(terms.slice(-80))}\nNOTE: ${heard}\nFINAL LINES: ${kept}` }] }) });
      if (!lr.ok) return json({ ok: false });
      const lt = ((await lr.json()).content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
      const la = lt.indexOf("{"), lb = lt.lastIndexOf("}");
      const fresh = la >= 0 && lb > la ? (JSON.parse(lt.slice(la, lb + 1)).terms || []) : [];
      const have = new Set(terms.map((t) => t.said.toLowerCase()));
      const add = fresh.filter((t: any) => t?.said && t?.means && !have.has(String(t.said).toLowerCase())).slice(0, 6).map((t: any) => ({ said: String(t.said).slice(0, 60), means: String(t.means).slice(0, 80) }));
      if (add.length) await db.from("preferences").upsert({ key: "site_terms", value: { terms: [...terms, ...add].slice(-200) }, updated_at: new Date().toISOString() });
      return json({ ok: true, learned: add.length });
    }
    // Voice first: the speaker only talks; this works out which of the four sheets he means and fills it.
    if (p.action === "route") {
      if (!text) return json({ error: "Nothing to read" }, 400);
      const rr = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 2500, system: SYSTEM, messages: [{ role: "user", content: `First decide what the speaker wants, then fill it. Return {"kind":"material|stone|measure|pay","project":"<project name if he said one, exactly as in PROJECTS, else empty>","party":"<supplier or subcontractor>","amount":<SAR paid, only for pay, else null>,"rate":<supplier's rate per m2 if said, only for stone, else null>,"method":"<Cash|Hawala|Bank transfer, only for pay>","lines":[...]}
kind "material" = he orders accessories or materials. ${TASK.material}
kind "stone" = he lists stone sizes ordered or arrived. ${TASK.stone}
kind "measure" = he gives measured work of a subcontractor. ${TASK.measure}
kind "pay" = he says money was paid to a stone supplier (cash, hawala): lines is [].
${terms.length ? "This team's own words (said → written): " + JSON.stringify(terms.slice(-120)) + "\n" : ""}PROJECTS: ${JSON.stringify((p.projects || []).slice(0, 40))}
Known names: ${JSON.stringify(p.names || []).slice(0, 1500)}
THE NOTE: ${text}` }] }) });
      if (!rr.ok) return json({ error: `AI ${rr.status}` }, 502);
      const rt = ((await rr.json()).content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
      const ra = rt.indexOf("{"), rb = rt.lastIndexOf("}");
      if (ra < 0 || rb <= ra) return json({ error: "Could not read it. Say it again." }, 422);
      const o = JSON.parse(rt.slice(ra, rb + 1));
      if (!["material", "stone", "measure", "pay"].includes(o.kind)) return json({ error: "Could not tell what you need. Say: order, stone, measurement or payment." }, 422);
      return json({ kind: o.kind, project: String(o.project || ""), party: String(o.party || "").slice(0, 120), amount: o.amount ?? null, rate: o.rate ?? null, method: String(o.method || ""), lines: Array.isArray(o.lines) ? o.lines.slice(0, 80) : [] });
    }
    if (!TASK[kind] || !text) return json({ error: "Nothing to read" }, 400);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 2500, system: SYSTEM, messages: [{ role: "user", content: `${TASK[kind]}\n${terms.length ? "This team's own words, learned from earlier sheets (said → written): " + JSON.stringify(terms.slice(-120)) + "\n" : ""}${p.names?.length ? "Known names (subcontractors, suppliers): " + JSON.stringify(p.names).slice(0, 1500) + "\n" : ""}THE NOTE: ${text}` }] }),
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
