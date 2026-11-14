// Edge Function "inbound-query": receives client RFQs from the Gmail script or the website form.
// Saves attachments, turns Excel/CSV into text the AI can read, and drops repeats.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import * as XLSX from "npm:xlsx@0.18.5";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-intake-secret" };
const b64ToBytes = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Public share links (Google Drive, Dropbox, OneDrive, WeTransfer-style direct links) → direct download URLs. */
export function shareLinks(text: string): { url: string; label: string }[] {
  const out: { url: string; label: string }[] = [], seen = new Set<string>();
  const add = (url: string, label: string) => { if (!seen.has(url)) { seen.add(url); out.push({ url, label }); } };
  for (const m of text.matchAll(/https?:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=download&)?id=)([\w-]{20,})/g)) add(`https://drive.google.com/uc?export=download&id=${m[1]}`, `drive-${m[1].slice(0, 8)}`);
  for (const m of text.matchAll(/https?:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]{20,})/g)) add(`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`, `sheet-${m[1].slice(0, 8)}.xlsx`);
  for (const m of text.matchAll(/https?:\/\/(?:www\.)?dropbox\.com\/[^\s"'<>)]+/g)) add(m[0].replace(/([?&])dl=0/, "$1dl=1") + (/[?&]dl=/.test(m[0]) ? "" : (m[0].includes("?") ? "&" : "?") + "dl=1"), "dropbox");
  return out.slice(0, 8);
}
/** Download one shared file (max 20 MB). Folders and private links are skipped with a note. */
export async function fetchShared(url: string, label: string): Promise<{ name: string; type: string; bytes: Uint8Array } | { note: string }> {
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

/** Drawing takeoff agent: closed polylines in a DXF, area summed per layer, in m² (uses the drawing's $INSUNITS). */
export function dxfTakeoff(src: string) {
  const L = src.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < L.length; i += 2) pairs.push([parseInt(L[i].trim(), 10), L[i + 1].trim()]);
  let units = 0;
  for (let i = 0; i < pairs.length; i++) if (pairs[i][1] === "$INSUNITS") { units = parseInt(pairs[i + 1]?.[1] ?? "0", 10); break; }
  const toM = ({ 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1 } as Record<number, number>)[units] ?? 0.001; // unknown → assume mm (architectural norm)
  const byLayer: Record<string, { area: number; n: number }> = {};
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] !== 0 || pairs[i][1] !== "LWPOLYLINE") continue;
    let layer = "0", closed = false; const xs: number[] = [], ys: number[] = [];
    for (let j = i + 1; j < pairs.length && pairs[j][0] !== 0; j++) {
      const [c, v] = pairs[j];
      if (c === 8) layer = v; else if (c === 70) closed = (parseInt(v, 10) & 1) === 1; else if (c === 10) xs.push(parseFloat(v)); else if (c === 20) ys.push(parseFloat(v));
    }
    if (!closed || xs.length < 3 || xs.length !== ys.length) continue;
    let a = 0; for (let k = 0; k < xs.length; k++) { const n = (k + 1) % xs.length; a += xs[k] * ys[n] - xs[n] * ys[k]; }
    const m2 = Math.abs(a / 2) * toM * toM;
    (byLayer[layer] ||= { area: 0, n: 0 }); byLayer[layer].area += m2; byLayer[layer].n++;
  }
  return Object.entries(byLayer).sort((a, b) => b[1].area - a[1].area)
    .map(([k, v]) => `${k}: ${Math.round(v.area * 100) / 100} m² (${v.n} closed shapes)`).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // The Gmail script proves itself with the link code made in the app (only its fingerprint is stored), or the old INTAKE_SECRET.
    const code = req.headers.get("x-intake-secret") || "";
    const env = Deno.env.get("INTAKE_SECRET");
    const { data: link } = await admin.from("preferences").select("value").eq("key", "gmail_link").maybeSingle();
    const ok = code.length >= 24 && ((env && code === env) || ((link?.value as any)?.hash && (await sha256(code)) === (link?.value as any).hash));
    if (!ok) return json({ error: "Not allowed" }, 401);
    const p = await req.json(); // {source, from_name, from_email, subject, body, message_id, deadline?, attachments:[{name, type, base64}]}
    await admin.from("preferences").upsert({ key: "gmail_seen", value: { at: new Date().toISOString(), action: p.action || "query" }, updated_at: new Date().toISOString() });

    // Replies the owner approved in the app: the script turns them into Gmail drafts, then reports back.
    if (p.action === "outbox") {
      const { data } = await admin.from("email_outbox").select("id, gmail_id, to_email, subject, body").eq("status", "Pending").order("created_at").limit(20);
      return json({ items: data || [] });
    }
    if (p.action === "drafted") {
      await admin.from("email_outbox").update(p.ok ? { status: "Drafted", drafted_at: new Date().toISOString(), error: null } : { status: "Failed", error: String(p.error || "unknown").slice(0, 500) }).eq("id", p.id);
      return json({ ok: true });
    }
    const dedupe = p.message_id || `${(p.from_email || "").toLowerCase()}|${(p.subject || "").toLowerCase().replace(/^(re|fw|fwd):\s*/g, "").trim()}`;
    const { data: dup } = await admin.from("inquiries").select("id, ref").eq("dedupe_key", dedupe).maybeSingle();
    if (dup) return json({ duplicate: true, ref: dup.ref });

    let body = String(p.body || "");
    const atts: { path: string; name: string; type: string }[] = [];
    for (const a of (p.attachments || []).slice(0, 15)) {
      const bytes = b64ToBytes(a.base64);
      if (bytes.length > 20 * 1024 * 1024) continue;
      const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${String(a.name).replace(/[^\w.\-]+/g, "_")}`;
      await admin.storage.from("inbox").upload(path, bytes, { contentType: a.type || "application/octet-stream" });
      atts.push({ path, name: a.name, type: a.type });
      if (/\.dxf$/i.test(a.name)) {
        const t = dxfTakeoff(new TextDecoder().decode(bytes));
        body += `\n\n=== DXF takeoff: ${a.name} (areas of closed shapes per layer) ===\n${t || "No closed shapes found."}`;
      }
      if (/\.dwg$/i.test(a.name)) body += `\n\n=== ${a.name}: DWG cannot be read directly. Ask the client for the same drawing as PDF or DXF. ===`;
      if (/\.(xlsx|xls|csv)$/i.test(a.name)) {
        try {
          const wb = XLSX.read(bytes, { type: "array" });
          for (const sh of wb.SheetNames) body += `\n\n=== ${a.name} / ${sh} ===\n` + XLSX.utils.sheet_to_csv(wb.Sheets[sh], { blankrows: false });
        } catch { body += `\n\n(${a.name} could not be read as a spreadsheet)`; }
      }
    }
    // Files shared as links (Google Drive, Google Sheets, Dropbox) are downloaded and read like attachments.
    for (const l of shareLinks(body)) {
      const f = await fetchShared(l.url, l.label);
      if ("note" in f) { body += `\n\n=== ${f.note} ===`; continue; }
      const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
      await admin.storage.from("inbox").upload(path, f.bytes, { contentType: f.type });
      atts.push({ path, name: f.name, type: f.type });
      if (/\.(xlsx|xls|csv)$/i.test(f.name) || /spreadsheet|excel|csv/i.test(f.type)) {
        try { const wb = XLSX.read(f.bytes, { type: "array" }); for (const sh of wb.SheetNames) body += `\n\n=== ${f.name} / ${sh} ===\n` + XLSX.utils.sheet_to_csv(wb.Sheets[sh], { blankrows: false }); } catch { /* keep the file */ }
      }
      if (/\.dxf$/i.test(f.name)) body += `\n\n=== DXF takeoff: ${f.name} ===\n${dxfTakeoff(new TextDecoder().decode(f.bytes)) || "No closed shapes found."}`;
    }
    const { data, error } = await admin.from("inquiries").insert({
      source: p.source || "email", from_name: p.from_name, from_email: p.from_email, subject: p.subject,
      body: body.slice(0, 200000), attachments: atts, dedupe_key: dedupe, deadline: p.deadline || null,
    }).select("id, ref").single();
    if (error) return json({ error: error.message }, 400);
    // Start the autopilot on the server right away: the AI reads this query and drafts the quotation (app open or not).
    const kick = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")! }, body: JSON.stringify({ task: "autopilot" }) }).catch(() => {});
    // @ts-ignore EdgeRuntime is provided by Supabase
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(kick);
    return json(data);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
