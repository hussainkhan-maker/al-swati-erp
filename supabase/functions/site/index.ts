// Edge Function "site": turns what a supervisor says or types on site into clean lines.
//  kind "material": an order for accessories (angles, glue, bolts, anchors…)  → Arabic item lines for the supplier
//  kind "stone":    stone sizes to order ("30×60, 20 pieces, for the entrance")  → size lines
//  Every answer may carry "ask": one short question back to the speaker, in his language, when something is missing or unclear.
//  action "make_project": a staff member named a project the app does not have and agreed to add it.
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
// Short notes are read by the small, fast model first (the person is standing on site waiting); the bigger one only if it fails.
const FAST = Deno.env.get("AI_MODEL_SITE_FAST") ?? "claude-haiku-5-5";
let NO_THINK = true; // short notes need no long thinking; if the model refuses the switch, it is left as it is
async function read(models: string[], system: string, content: string, max: number): Promise<{ text: string; model: string; usage: any }> {
  let last = "";
  for (const model of models) {
    const send = (quiet: boolean) => fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: max, system, messages: [{ role: "user", content }], ...(quiet ? { thinking: { type: "disabled" } } : {}) }) });
    let quiet = NO_THINK, r = await send(quiet);
    if (r.status === 400 && quiet) { NO_THINK = false; quiet = false; r = await send(false); }
    if (!r.ok) { last = `AI ${r.status}`; continue; }
    const j = await r.json();
    const text = (j.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
    if (text.indexOf("{") >= 0 && text.lastIndexOf("}") > text.indexOf("{")) return { text, model: model + (quiet ? "" : " (thinking)"), usage: j.usage || {} };
    last = "No JSON";
  }
  throw new Error(last || "AI did not answer");
}
const cut = (t: string) => JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" };

const SYSTEM = `You read short site notes of a stone cladding contractor in Saudi Arabia. The speaker is a site supervisor who mixes Urdu, Arabic and English; speech recognition may spell words badly. Return ONLY JSON, no other text.
Rules: write exactly what was said. Never invent an item, a size or a number, never swap an item for a similar one, never tidy or round a size. Copy every number exactly as said, in digits 0-9. If something is unclear, keep the speaker's own words in "note" and leave the number null.
You are also the one who talks back to him. In every answer add "ask": ONE short, friendly question in the language named as REPLY LANGUAGE (ur = Urdu in Urdu script, ar = Arabic, en = English), the way a helpful colleague on site would say it aloud, when something he needs is missing or could mean two things (a length without a width, a number that could be 16 or 60, an item without a quantity, a place without a name, no subcontractor named for a measurement). Ask about the most important gap only, and name the line. If everything is clear, "ask" is "". Never ask for something he already said. Ask ONLY for what the sheet cannot be made without: a missing length, width or quantity, which subcontractor, which project. Never ask about thickness, stone type, colour, finish, price, date or anything else he did not bring up, and never ask whether he wants a PDF.
Projects have nicknames: the team often calls a project by its area or by any name they like. If he names a place that is not in the project list, do not refuse and do not treat it as unknown when the answer is obvious: if the list has exactly one project, he means that one; if the name is clearly the area or another spelling of one listed project, he means that one. In both cases use that project and return the name he said in "alias", so it is remembered and never asked again.
Site words: zawiya / زاوية = angle (bracket); tool / طول = length; ard / عرض = width; khasam / خصم = deduction (opening to subtract); amood / عمود = column; saqaf / سقف = ceiling or soffit; deewar / jidar / جدار = wall; seedhi deewar = straight wall; habba / حبة = piece; kartoon / كرتون = carton; bolt / مسمار / برغي; glue brands such as Abu Jamal (أبو جمال) or Om Jamal (أم جمال) are kept as brand names.`;

const TASK: Record<string, string> = {
  material: `This is an ORDER for accessories and materials. Write each item name in Arabic the way a Saudi building-materials shop writes it; keep brand names; if you do not know the Arabic trade word, keep the speaker's own word. Return {"party":"<supplier or shop if said, else empty>","lines":[{"name":"<item in Arabic>","size":"<size or type as said, e.g. 5×5 سم, M10×100>","qty":<number or null>,"unit":"<حبة, كرتون, كيس, متر… as said, else حبة>","note":"<anything else said about it>"}]}`,
  stone: `This is a list of STONE SIZES to order. Sizes are in centimetres unless the speaker says metres (then convert to cm). Return {"party":"<supplier if said, else empty>","lines":[{"place":"<where it goes, if said>","l":<length cm>,"w":<width cm>,"qty":<pieces>,"note":"<stone type, thickness, finish or anything else said>"}]}`,
  measure: `This is the MEASURED WORK of a subcontractor. Lengths are in metres unless the speaker says cm (then convert to metres). Return {"party":"<subcontractor name if said, else empty>","lines":[{"place":"<the area or place, if said>","element":"<column, ceiling, straight wall, or other name as said; empty if not said>","qty":<how many identical pieces he said, e.g. "5 amood 4 by 2" is qty 5; 1 if he gave no count>,"l":<length m>,"w":<width or height m>,"deduct":<deduction in m², 0 if none>,"system":"<channel if he says this work is on C-channel (channel, چینل, شانل, قناة, سي شانل); wall if he says it is fixed on the wall (deewar pe, على الجدار, direct); empty if he does not say. If he says it once for the whole note, it applies to every line>"}]} One line per measured place. Every size he says is its own line, in the order he said it: never join two entries into one line and never add them together, even when the sizes are the same or the element is the same. Only when he himself gives a count for one size ("5 amood 4 by 2", "teen deewar 6 by 3") is it one line with that qty. Do not multiply anything.`,
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
    const replyLang = ["ur", "ar", "en"].includes(p.lang) ? p.lang : "ur";
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
      const got = await read([FAST, MODEL], SYSTEM, `First decide what the speaker wants, then fill it. Return {"kind":"material|stone|measure|pay","project":"<project name if he said one, exactly as in PROJECTS, else empty>","party":"<supplier or subcontractor>","amount":<SAR paid, only for pay, else null>,"rate":<supplier's rate per m2 if said, only for stone, else null>,"method":"<Cash|Hawala|Bank transfer, only for pay>","lines":[...],"ask":"<as the system rules say, else empty>","alias":"<the nickname he used for the chosen project when it is not that project's listed name, else empty>","new_project":"<only if he clearly names a project, site or area that is NOT in PROJECTS and is not one of the team's words for a listed project: that name as he said it, in Latin letters if he spoke Urdu or English, Arabic if he spoke Arabic. Else empty. Never a subcontractor, a supplier, a place inside a building or a stone type>"}
REPLY LANGUAGE: ${replyLang}
kind "material" = he orders accessories or materials. ${TASK.material}
kind "stone" = he lists stone sizes ordered or arrived. ${TASK.stone}
kind "measure" = he gives measured work of a subcontractor. ${TASK.measure}
kind "pay" = he says money was paid to a stone supplier (cash, hawala): lines is [].
${terms.length ? "This team's own words (said → written): " + JSON.stringify(terms.slice(-120)) + "\n" : ""}PROJECTS: ${JSON.stringify((p.projects || []).slice(0, 40))}
PROJECT NICKNAMES already learned (listed name → what the team calls it): ${JSON.stringify(p.aka || {}).slice(0, 1500)}
Known names: ${JSON.stringify(p.names || []).slice(0, 1500)}
THE NOTE: ${text}`, 1800);
      const o = cut(got.text);
      await db.from("ai_usage").insert({ user_id: who.user.id, task: "site_route", model: got.model, input_tokens: got.usage.input_tokens || 0, output_tokens: got.usage.output_tokens || 0 }).then(() => {}, () => {});
      if (!["material", "stone", "measure", "pay"].includes(o.kind)) return json({ error: "Could not tell what you need. Say: order, stone, measurement or payment." }, 422);
      return json({ kind: o.kind, project: String(o.project || ""), party: String(o.party || "").slice(0, 120), amount: o.amount ?? null, rate: o.rate ?? null, method: String(o.method || ""), lines: Array.isArray(o.lines) ? o.lines.slice(0, 80) : [], ask: String(o.ask || "").slice(0, 300), alias: String(o.alias || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40), new_project: String(o.new_project || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60) });
    }
    // The app learns a project's nickname by itself: the name the person used is kept with the project, so it is understood
    // next time without anyone being asked. Only for a project that person may see.
    if (p.action === "alias") {
      const alias = String(p.alias || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40), pid = String(p.project_id || "");
      if (alias.length < 2 || !pid) return json({ ok: false });
      const { data: pr } = await db.from("projects").select("id, name, owner, site").eq("id", pid).maybeSingle();
      if (!pr) return json({ ok: false });
      const mine = prof.role === "admin" || (prof.role === "abu" && pr.owner === "abu") || (prof.role === "supervisor" && !!(await db.from("project_members").select("project_id").eq("project_id", pid).eq("user_id", who.user.id).maybeSingle()).data);
      if (!mine) return json({ ok: false }, 403);
      const aka: string[] = Array.isArray((pr.site as any)?.aka) ? (pr.site as any).aka : [];
      if (alias.toLowerCase() === String(pr.name).toLowerCase() || aka.some((a) => String(a).toLowerCase() === alias.toLowerCase())) return json({ ok: true, known: true });
      await db.from("projects").update({ site: { ...((pr.site as any) || {}), aka: [...aka, alias].slice(-12) } }).eq("id", pid);
      return json({ ok: true, learned: alias, project: pr.name });
    }
    // The everyday voice box ("Zar did 40 metres", "bought glue for 300"): one note becomes one action. Same answer shape as
    // the older reader, but read by the fast model and with the team's own words and project nicknames.
    if (p.action === "parse") {
      if (!text) return json({ error: "Nothing to read" }, 400);
      const langName = replyLang === "ar" ? "Arabic" : replyLang === "en" ? "English" : "Urdu";
      const allowed = prof.role === "supervisor" ? "purchase|expense|progress|statement|unknown" : "purchase|expense|income|loan|subpay|rate|mrn|progress|statement|unknown";
      const got = await read([FAST, MODEL], `You turn one spoken or typed note from a stone, marble and granite cladding contractor in Saudi Arabia into ONE JSON action. The note may mix Urdu, Arabic and English and comes from speech recognition, so spelling can be rough. Return ONLY JSON.`, `Context (JSON): ${JSON.stringify(p.context ?? {}).slice(0, 6000)}
${terms.length ? "This team's own words (said → meaning): " + JSON.stringify(terms.slice(-120)) + "\n" : ""}Note: """${text.slice(0, 2000)}"""
Return JSON only:
{"intent":"${allowed}",
 "project_id":"<id from context or null>",
 "alias":"<the nickname he used for that project when it is not the project's listed name, else empty>",
 "split":[{"project_id":"<id>","pct":<number>}],
 "amount":<number|null>, "loan":<number|null>,
 "vat_amount":<number|null>, "vat_company":"<company|null>",
 "supplier":"<or null>", "sub_name":"<or null>",
 "description":"<short, in ${langName}>",
 "lines":[{"name":"<material>","qty":<n>,"unit":"<bag|sqm|rft|ton|pcs|...>","price":<n|null>}],
 "progress":[{"sub_name":"<name>","qty":<n>,"unit":"sqm|rft|pcs","work":"<cladding|facade|wall|coping|...>"}],
 "statement":{"kind":"project|sub|supplier|material|vat","target":"<name>"},
 "heard":"<one short sentence in ${langName} restating what you understood, numbers as digits>",
 "questions":["<short question in ${langName}, only for something the entry cannot be saved without>"]}
Meaning of intents: income = money received from a client for a project (the total incl. VAT); loan = money borrowed from the company for a project; subpay = payment to a subcontractor; rate = a supplier price to remember; mrn = materials to request (material requisition); progress = meters done by subcontractors; statement = asking for an account or report.
Rules: digits 0-9 only. Never invent a number that was not said: use null and ask. For cladding work "meter / میٹر / متر" means square metres (unit "sqm") unless he clearly says running metres (tooli, rft, running, طولي). Leave out of the JSON any field that would be null or empty, except intent, heard and questions. Use split only when one purchase is shared between projects; percentages must add to 100.
Projects: the team calls a project by its area or any nickname. If the context has exactly one project, every note is about it. If he names a place that is clearly the area or another spelling of one listed project, it is that project. In both cases set project_id and put the name he said in "alias". Ask which project only when there are several and nothing points to one.`, 1200);
      await db.from("ai_usage").insert({ user_id: who.user.id, task: "site_parse", model: got.model, input_tokens: got.usage.input_tokens || 0, output_tokens: got.usage.output_tokens || 0 }).then(() => {}, () => {});
      return json(cut(got.text));
    }
    // A staff member named a project the app does not have, and said yes to adding it. It is made on Abu's side (the owner's
    // own projects stay his), the person who asked is put on it, and the owner is told in his approvals list. At most 3 a day each.
    if (p.action === "make_project") {
      const name = String(p.name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60);
      if (name.length < 2) return json({ error: "No project name" }, 400);
      const { data: same } = await db.from("projects").select("id, name").ilike("name", name).limit(1);
      if (same?.[0]) return json({ id: same[0].id, name: same[0].name, existed: true });
      const since = new Date(Date.now() - 864e5).toISOString();
      const { count } = await db.from("projects").select("id", { count: "exact", head: true }).eq("created_by", who.user.id).gte("created_at", since);
      if (prof.role !== "admin" && (count ?? 0) >= 3) return json({ error: "3 new projects today already. Ask the owner." }, 429);
      const { data: made, error: me } = await db.from("projects").insert({ name, owner: prof.role === "admin" ? "admin" : "abu", status: "active", created_by: who.user.id }).select("id, name").single();
      if (me || !made) return json({ error: me?.message || "Could not add the project" }, 500);
      if (prof.role === "supervisor") await db.from("project_members").insert({ project_id: made.id, user_id: who.user.id }).then(() => {}, () => {});
      const { data: me2 } = await db.from("profiles").select("name").eq("id", who.user.id).single();
      await db.from("agent_inbox").insert({ source: "staff", kind: "approval", area: "site", status: "waiting", title: `Naya project: ${name} (${me2?.name || prof.role} ne bol kar banaya)`, body: `${me2?.name || prof.role} ne is project ka naam liya jo app me nahi tha, aur us ki haan pe ye Abu ke hisse me ban gaya.\nApprove = project rehne dein; phir Projects me khol kar service fee, client aur company bhar dein.\nReject = project band ho jayega.`, data: { type: "new_project", project_id: made.id, from: me2?.name || "", role: prof.role, benefit: "Naya project: details bharni hain" } }).then(() => {}, () => {});
      return json({ id: made.id, name: made.name });
    }
    if (!TASK[kind] || !text) return json({ error: "Nothing to read" }, 400);
    const content = `${TASK[kind]} Add "ask" as the system rules say.\nREPLY LANGUAGE: ${replyLang}\n${terms.length ? "This team's own words, learned from earlier sheets (said → written): " + JSON.stringify(terms.slice(-120)) + "\n" : ""}${p.names?.length ? "Known names (subcontractors, suppliers): " + JSON.stringify(p.names).slice(0, 1500) + "\n" : ""}THE NOTE: ${text}`;
    const got = await read([FAST, MODEL], SYSTEM, content, 1800);
    await db.from("ai_usage").insert({ user_id: who.user.id, task: "site_" + kind, model: got.model, input_tokens: got.usage.input_tokens || 0, output_tokens: got.usage.output_tokens || 0 }).then(() => {}, () => {});
    const parsed = cut(got.text);
    return json({ party: String(parsed.party || "").slice(0, 120), lines: Array.isArray(parsed.lines) ? parsed.lines.slice(0, 80) : [], ask: String(parsed.ask || "").slice(0, 300) });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
