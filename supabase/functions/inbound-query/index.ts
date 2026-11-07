// Edge Function "inbound-query": receives client RFQs from the Gmail script or the website form.
// Saves attachments, turns Excel/CSV into text the AI can read, and drops repeats.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import * as XLSX from "npm:xlsx@0.18.5";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-intake-secret" };
const b64ToBytes = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

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
  if (req.headers.get("x-intake-secret") !== Deno.env.get("INTAKE_SECRET")) return json({ error: "Not allowed" }, 401);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const p = await req.json(); // {source, from_name, from_email, subject, body, message_id, deadline?, attachments:[{name, type, base64}]}
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
    const { data, error } = await admin.from("inquiries").insert({
      source: p.source || "email", from_name: p.from_name, from_email: p.from_email, subject: p.subject,
      body: body.slice(0, 200000), attachments: atts, dedupe_key: dedupe, deadline: p.deadline || null,
    }).select("id, ref").single();
    if (error) return json({ error: error.message }, 400);
    return json(data);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
