// Edge Function "daily-report": the main agent. Every morning it collects every account's open issues
// (checked by code), asks Claude for a short Urdu summary, and saves it for Super-Admin's dashboard.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

Deno.serve(async (req) => {
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ error: "Not allowed" }, 401);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const items: { level: "bad" | "warn"; text: string }[] = [];
  const since = new Date(Date.now() - 2 * 864e5).toISOString();

  const [{ data: ledger }, { data: subs }, { data: quotes }, { data: inq }, { data: reqs }, { data: txns }, { data: prog }] = await Promise.all([
    db.from("project_ledger").select("*"),
    db.from("subcontractors").select("name, rate"),
    db.from("quotes").select("title, status, lines, updated_at"),
    db.from("inquiries").select("ref, subject, status, deadline, created_at"),
    db.from("supplier_requests").select("status, sent_at, suppliers(name)").eq("status", "Sent"),
    db.from("txns").select("type, flags, created_at, amount, total, gross").gte("created_at", since).eq("status", "active"),
    db.from("progress").select("sub_name, flags, created_at").gte("created_at", since).eq("status", "active"),
  ]);

  (ledger || []).forEach((l: any) => { if (Number(l.profit) < 0 && Number(l.gross) > 0) items.push({ level: "bad", text: `${l.name}: loss ${l.profit} SAR` }); if (Number(l.sub_due) > 0) items.push({ level: "warn", text: `${l.name}: subcontractors due ${l.sub_due} SAR` }); });
  (subs || []).filter((s: any) => !(Number(s.rate) > 0)).forEach((s: any) => items.push({ level: "bad", text: `Subcontractor ${s.name} has no rate` }));
  (quotes || []).filter((q: any) => ["Draft", "Abu Review"].includes(q.status)).forEach((q: any) => { const n = (q.lines || []).filter((l: any) => !(Number(l.rate) > 0)).length; if (n) items.push({ level: "warn", text: `Quotation "${q.title}": ${n} lines without a rate` }); });
  (inq || []).forEach((q: any) => {
    if (q.status === "New") items.push({ level: "warn", text: `Query ${q.ref} "${q.subject}" not reviewed yet` });
    if (q.deadline && !["Sent", "Won", "Lost"].includes(q.status)) { const d = Math.ceil((Date.parse(q.deadline) - Date.now()) / 864e5); if (d <= 2) items.push({ level: "bad", text: `Query ${q.ref} is due in ${d} day(s)` }); }
  });
  (reqs || []).forEach((r: any) => { if (r.sent_at && Date.now() - Date.parse(r.sent_at) > 2 * 864e5) items.push({ level: "warn", text: `${r.suppliers?.name ?? "Supplier"} has not replied for 2 days` }); });
  (txns || []).forEach((x: any) => (x.flags || []).forEach((f: string) => items.push({ level: "warn", text: `${x.type} ${x.amount ?? x.total ?? x.gross}: ${f}` })));
  (prog || []).forEach((p: any) => (p.flags || []).forEach((f: string) => items.push({ level: "warn", text: `Progress ${p.sub_name}: ${f}` })));

  let summary = items.length ? `${items.filter((i) => i.level === "bad").length} urgent, ${items.filter((i) => i.level === "warn").length} to check.` : "Sab theek hai. Koi khula masla nahi.";
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: Deno.env.get("AI_MODEL") ?? "claude-sonnet-5-5", max_tokens: 600, messages: [{ role: "user", content:
        `You are the main agent of a stone and flooring contractor's ERP in Saudi Arabia. Write the owner's morning summary in simple Roman Urdu, at most 6 short lines, most urgent first, with numbers as digits. Use only these items: ${JSON.stringify(items.slice(0, 80))}` }] }),
    });
    if (r.ok) { const j = await r.json(); summary = j.content?.[0]?.text || summary; }
  } catch { /* keep the plain summary */ }
  await db.from("agent_reports").insert({ for_role: "admin", summary, items });
  return json({ ok: true, items: items.length });
});
