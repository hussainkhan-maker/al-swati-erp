// What every AI agent and code check is doing, in one place. Each agent's numbers are counted from the real data.
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { active, useData } from "../lib/data";
import { ageDays, stamp } from "../lib/fmt";
import { supabase } from "../lib/supabase";
import { Btn, Card, Checks, Field, H1, H2, Icon, Pill, Row, Screen, T, useColors } from "../ui";
import AiTools from "./AiTools";
import { pref } from "./Quotes";
import WebsiteTeam from "./WebsiteTeam";

export default function Agents() {
  const { d, reload, role } = useData(); const c = useColors();
  const inq = d.inquiries || [], tx = active(d.txns), pr = active(d.progress), reqs = d.supplier_requests || [], rep = (d.agent_reports || [])[0];
  const flagged = [...tx, ...pr].filter((x: any) => (x.flags || []).length);
  const noRate = (d.subcontractors || []).filter((s: any) => !(Number(s.rate) > 0));
  const stale = (d.prices || []).filter((p: any) => p.kind === "cost" && ageDays(p.created_at) > 30);
  const waiting = reqs.filter((r: any) => r.status === "Sent" && ageDays(r.sent_at) >= 2);
  const blankQuotes = (d.quotes || []).filter((q: any) => ["Draft", "Abu Review"].includes(q.status) && (q.lines || []).some((l: any) => !(Number(l.rate) > 0)));

  const A = ({ icon, name, job, status, s }: { icon: string; name: string; job: string; status: string; s: "good" | "warn" | "bad" }) => (
    <Card>
      <Row><Icon name={icon} color={c.accent} /><View style={{ flex: 1 }}><T bold>{name}</T><T muted size={13}>{job}</T></View><Pill kind={s} text={s === "good" ? "OK" : s === "warn" ? "Check" : "Action"} /></Row>
      <T>{status}</T>
    </Card>
  );
  return (
    <Screen>
      <H1>Tools & settings</H1>
      {role === "admin" && <AiTools />}
      {role === "admin" && <Prefs />}
    </Screen>
  );
}

/** Your preferences. The advisor and the checks follow them, and they are saved for every device. */
function Prefs() {
  const { d, reload } = useData(); const c = useColors();
  const m = pref(d, "margin", { target: 20, minimum: 12, round_to: 5 }), q = pref(d, "quote_terms", { validity_days: 15, payment: "", notes: "" });
  const cos = (pref(d, "companies", { list: [] }).list || []).join("\n");
  const [f, setF] = useState<any>({ ...m, ...q, cos }), [msg, setMsg] = useState("");
  useEffect(() => { setF({ ...m, ...q, cos }); }, [d.preferences]);
  const n = (v: any) => Number(String(v).replace(/[^\d.]/g, ""));
  const bad = !(n(f.minimum) > 0) || n(f.minimum) > n(f.target) || !(n(f.round_to) > 0) || !(n(f.validity_days) > 0);
  const save = async () => {
    const now = new Date().toISOString();
    const { error } = await supabase.from("preferences").upsert([
      { key: "margin", value: { target: n(f.target), minimum: n(f.minimum), round_to: n(f.round_to) }, updated_at: now },
      { key: "quote_terms", value: { validity_days: n(f.validity_days), payment: f.payment || "", notes: f.notes || "" }, updated_at: now },
      { key: "companies", value: { list: String(f.cos || "").split(/\n|,/).map((x: string) => x.trim()).filter(Boolean) }, updated_at: now }]);
    setMsg(error ? error.message : "Saved. The advisor uses these from now on."); if (!error) reload(["preferences"]);
  };
  return (
    <Card>
      <Row><Icon name="tag" color={c.accent} /><H2>My preferences</H2></Row>
      <Row><Field label="Target margin %" numeric value={String(f.target)} onChange={(v) => setF({ ...f, target: v })} /><Field label="Never below %" numeric value={String(f.minimum)} onChange={(v) => setF({ ...f, minimum: v })} /></Row>
      <Row><Field label="Round rates to (SAR)" numeric value={String(f.round_to)} onChange={(v) => setF({ ...f, round_to: v })} /><Field label="Quotation valid (days)" numeric value={String(f.validity_days)} onChange={(v) => setF({ ...f, validity_days: v })} /></Row>
      <Field label="Payment terms on quotations" value={f.payment} onChange={(v) => setF({ ...f, payment: v })} />
      <Field label="Notes on quotations" value={f.notes} multiline onChange={(v) => setF({ ...f, notes: v })} />
      <Field label="Our companies (bills and VAT are in these names), one per line" value={f.cos} multiline onChange={(v) => setF({ ...f, cos: v })} />
      {bad && <T color={c.bad}>Minimum must be above 0 and not more than the target.</T>}
      {msg ? <T color={c.accent}>{msg}</T> : null}
      <Btn kind="primary" title="Save preferences" disabled={bad} onPress={save} />
    </Card>
  );
}

/** Where the AI tokens go this month, per job. Simple questions answered from the app's own numbers never appear here: they cost nothing. */
function AiUsage() {
  const c = useColors();
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    const from = new Date(); from.setDate(1); from.setHours(0, 0, 0, 0);
    supabase.from("ai_usage").select("task, model, input_tokens, output_tokens, cache_read, files, at").gte("at", from.toISOString()).limit(5000).then(({ data }) => setRows(data || []));
  }, []);
  if (!rows) return null;
  const by: Record<string, { calls: number; inp: number; out: number; cache: number; model: string }> = {};
  rows.forEach((r) => { const k = r.task || "other"; const x = (by[k] ||= { calls: 0, inp: 0, out: 0, cache: 0, model: "" }); x.calls++; x.inp += r.input_tokens; x.out += r.output_tokens; x.cache += r.cache_read; x.model = String(r.model || "").replace("claude-", ""); });
  const list = Object.entries(by).sort((a, b) => b[1].inp + b[1].out * 5 - (a[1].inp + a[1].out * 5));
  const k = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n));
  const tot = list.reduce((s, [, x]) => ({ calls: s.calls + x.calls, inp: s.inp + x.inp, out: s.out + x.out, cache: s.cache + x.cache }), { calls: 0, inp: 0, out: 0, cache: 0 });
  return (
    <Card>
      <H2>AI use this month</H2>
      <Row wrap><Pill text={`${tot.calls} calls`} /><Pill text={`${k(tot.inp)} tokens read`} /><Pill text={`${k(tot.out)} tokens written`} />{tot.cache ? <Pill kind="good" text={`${k(tot.cache)} from cache (90% cheaper)`} /> : null}</Row>
      {list.slice(0, 12).map(([task, x]) => (
        <Row key={task}><T style={{ flex: 1 }}>{task}</T><T size={13} muted>{x.calls}× · {k(x.inp)} in · {k(x.out)} out · {x.model}</T></Row>))}
      {!list.length && <T muted>No AI calls yet this month.</T>}
      <T size={12} muted>Money questions ("Prime ka kharcha?") are answered from your own numbers without AI. PDFs with text are sent as text, drawings as files. Emails and reminders use the small model; reading BOQs, receipts and checks use the strong ones.</T>
    </Card>
  );
}
