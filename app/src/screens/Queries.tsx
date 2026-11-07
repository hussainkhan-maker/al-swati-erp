// Client queries arriving from email and the website. The AI reads each one twice, code runs the gates,
// and only a query with no red gate becomes a quotation.
import React, { useState } from "react";
import { Linking, Share, View } from "react-native";
import { rfqGates } from "../lib/checks";
import { useData } from "../lib/data";
import { signedUrl } from "../lib/files";
import { day, matchItems, money, num, stamp } from "../lib/fmt";
import { ai } from "../lib/supabase";
import { Btn, Card, Empty, Field, H1, H2, Icon, Pill, Row, Screen, Select, Sheet, T, Table, useColors } from "../ui";
import { RequestPrices } from "./Suppliers";

const STATUSES = ["New", "Under Review", "RFI Sent", "Priced", "Sent", "Won", "Lost"];

export default function Queries() {
  const { d, insert, update } = useData(); const c = useColors();
  const [open, setOpen] = useState<any>(null), [add, setAdd] = useState<any>(null), [filter, setFilter] = useState("open");
  const list = (d.inquiries || []).filter((q: any) => filter === "all" || (filter === "open" ? !["Sent", "Won", "Lost"].includes(q.status) : q.status === filter));
  return (
    <Screen>
      <Row><View style={{ flex: 1 }}><H1>Client queries</H1></View><Btn icon={<Icon name="plus" />} title="Paste one" onPress={() => setAdd({ subject: "", from_name: "", body: "" })} /></Row>
      <T muted size={13}>Emails labelled RFQ in Gmail and website form messages arrive here by themselves, with their Excel, PDF and drawing files.</T>
      <Select value={filter} onChange={setFilter} options={[{ value: "open", label: "Open" }, { value: "all", label: "All" }, ...STATUSES.map((s) => ({ value: s, label: s }))]} />
      {list.length ? list.map((q: any) => {
        const due = q.deadline ? Math.ceil((Date.parse(q.deadline) - Date.now()) / 864e5) : null;
        return (
          <Card key={q.id} onPress={() => setOpen(q)}>
            <Row><View style={{ flex: 1 }}><T bold>{q.ref} · {q.subject || "(no subject)"}</T><T muted size={13}>{q.from_name || q.from_email || q.source} · {day(q.created_at)} · {(q.attachments || []).length} files</T></View>
              <Pill kind={q.status === "New" ? "warn" : q.status === "Won" ? "good" : q.status === "Lost" ? "bad" : "acc"} text={q.status} /></Row>
            {due != null && !["Sent", "Won", "Lost"].includes(q.status) && <Pill kind={due <= 2 ? "bad" : "plain"} text={`Due in ${due} day(s)`} />}
          </Card>);
      }) : <Empty text="No queries here. New ones appear as soon as they reach Gmail." />}
      {open && <QuerySheet q={(d.inquiries || []).find((x: any) => x.id === open.id) || open} onClose={() => setOpen(null)} />}
      <Sheet open={!!add} onClose={() => setAdd(null)} title="Paste a query">
        {add && <>
          <Field label="Client" value={add.from_name} onChange={(v) => setAdd({ ...add, from_name: v })} />
          <Field label="Project / subject" value={add.subject} onChange={(v) => setAdd({ ...add, subject: v })} />
          <Field label="BOQ text" value={add.body} multiline onChange={(v) => setAdd({ ...add, body: v })} placeholder={"1. Supply & install Crema Marfil 60x60 polished floor — 450 Sqm\n2. Granite facade cladding 30mm with SS anchors — 320 Sqm"} />
          <Btn big kind="primary" title="Save" disabled={!add.body.trim()} onPress={async () => { await insert("inquiries", { ...add, source: "manual", dedupe_key: "manual-" + Date.now() }); setAdd(null); }} />
        </>}
      </Sheet>
    </Screen>
  );
}

function QuerySheet({ q, onClose }: { q: any; onClose: () => void }) {
  const { d, insert, update } = useData(); const c = useColors();
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [ask, setAsk] = useState<any>(null), [made, setMade] = useState("");
  const r = q.reading;
  const hasPrice = (desc: string) => !!matchItems(desc, d.items || [])[0];
  const gates = r ? rfqGates(q.body || "", r.a || {}, r.b || {}, hasPrice) : [];
  const red = gates.some((g) => g.s === "bad");
  const lines = (r?.a?.lines || []) as any[];
  const read = async () => { setBusy(true); setErr(""); try { await ai("rfq", { inquiry_id: q.id }); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const makeQuote = async () => {
    const res = await insert("quotes", { title: q.subject || q.ref, client: q.from_name, owner: "admin", lines: lines.map((l) => ({ desc: (l.ref ? l.ref + " · " : "") + l.desc, qty: num(l.qty) || 0, unit: l.unit, rate: null })), history: [`${stamp(Date.now())} made from ${q.ref}`], rfq: { inquiry_id: q.id, ref: q.ref } });
    await update("inquiries", q.id, { status: "Priced", quote_id: res.data?.id || null });
    setMade("Quotation made. Open the Quotations tab to fill the rates.");
  };
  return (
    <Sheet open onClose={onClose} title={`${q.ref} · ${q.subject || ""}`}>
      <Row wrap><Select label="Status" value={q.status} onChange={(v) => update("inquiries", q.id, { status: v })} options={STATUSES.map((s) => ({ value: s, label: s }))} />
        <Field label="Deadline (YYYY-MM-DD)" value={q.deadline || ""} onChange={(v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && update("inquiries", q.id, { deadline: v })} /></Row>
      <Card><T muted size={13}>{q.from_name} {q.from_email ? `<${q.from_email}>` : ""}</T><T numberOfLines={12}>{q.body}</T></Card>
      {(q.attachments || []).length > 0 && <Card><T bold>Files</T>{q.attachments.map((a: any) => <Btn key={a.path} kind="ghost" title={a.name} onPress={async () => { const u = await signedUrl("inbox", a.path); if (u) Linking.openURL(u); }} />)}</Card>}
      <Btn big kind="primary" icon={<Icon name="spark" color={c.accentInk} />} title={r ? "Read again and check" : "Read with AI and check"} busy={busy} onPress={read} />
      {busy && <T muted>Two AI readers are going through the BOQ, drawings and Excel separately. This takes about a minute.</T>}
      {err ? <T color={c.bad}>{err}</T> : null}
      {r && <>
        <H2>Risk report</H2>
        {gates.map((g) => (
          <Card key={g.n} style={{ borderColor: g.s === "bad" ? c.bad : g.s === "warn" ? c.warn : c.line }}>
            <Row><Pill kind={g.s === "bad" ? "bad" : g.s === "warn" ? "warn" : "good"} text={`Gate ${g.n}`} /><T bold style={{ flex: 1 }}>{g.name}</T></Row>
            {g.d.map((x, i) => <T key={i} size={14}>• {x}</T>)}
          </Card>))}
        {(r.a?.siteChecks || []).length > 0 && <Card><T bold>Site checks before work</T>{r.a.siteChecks.map((x: string, i: number) => <T key={i}>• {x}</T>)}</Card>}
        <Table cols={["Ref", "Description", "Qty", "Unit"]} numeric={[2]} rows={lines.map((l) => [l.ref || "", l.desc, l.qty == null ? "?" : money(l.qty), l.unit])} />
        {(r.a?.rfis || []).length > 0 && <Btn icon={<Icon name="share" />} title="Share questions with the consultant" onPress={() => Share.share({ message: `${q.ref} · ${q.subject}\n\nQuestions:\n` + r.a.rfis.map((x: string, i: number) => `${i + 1}. ${x}`).join("\n") })} />}
        <Btn icon={<Icon name="truck" />} title="Ask suppliers for prices" onPress={() => setAsk({ inquiry_id: q.id, items: lines.map((l) => ({ desc: l.desc, qty: l.qty, unit: l.unit })) })} />
        <Btn big kind="primary" title="Make quotation" disabled={red || !lines.length || !!q.quote_id} onPress={makeQuote} />
        {red && <T color={c.bad}>Red gates must be fixed first. Check the files, or paste the corrected BOQ as a new query.</T>}
        {(made || q.quote_id) ? <T color={c.accent}>{made || "A quotation already exists for this query."}</T> : null}
      </>}
      {ask && <RequestPrices init={ask} onClose={() => setAsk(null)} />}
    </Sheet>
  );
}
