// Extra AI helpers for Super-Admin: contract check, compare supplier quotations, and teach the AI a rule.
// The AI only reads and suggests; nothing is saved to the accounts from here.
import * as DocumentPicker from "expo-document-picker";
import React, { useState } from "react";
import { View } from "react-native";
import { useData } from "../lib/data";
import { uid } from "../lib/fmt";
import { uploadFile } from "../lib/files";
import { ai } from "../lib/supabase";
import { Btn, Card, Field, H2, Icon, Pill, Row, T, Table, useColors } from "../ui";
import { pref } from "./Quotes";

const friendly = (m: string) => (/401|ANTHROPIC|api key/i.test(m) ? "The AI is not switched on yet: add ANTHROPIC_API_KEY in Supabase → Edge Functions → Secrets." : m);

async function pickAndUpload(): Promise<{ path: string; name: string } | null> {
  const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: ["application/pdf", "image/*"] });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0], ext = (a.name.split(".").pop() || "pdf").toLowerCase();
  const path = `ai/${uid()}.${ext}`;
  await uploadFile("documents", path, a.uri, a.mimeType || (ext === "pdf" ? "application/pdf" : "image/jpeg"));
  return { path, name: a.name };
}

export default function AiTools() {
  return <><Contract /><Compare /><Teach /></>;
}

function Contract() {
  const c = useColors();
  const [file, setFile] = useState<{ path: string; name: string } | null>(null), [text, setText] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [res, setRes] = useState<any>(null);
  const run = async () => {
    setBusy(true); setErr(""); setRes(null);
    try { setRes(await ai("contract", { path: file?.path, text })); } catch (e: any) { setErr(friendly(e.message)); } finally { setBusy(false); }
  };
  return (
    <Card>
      <Row><Icon name="doc" color={c.accent} /><View style={{ flex: 1 }}><H2>Contract check (Arabic muqawala)</H2><T muted size={13}>Reads a contract, agreement or client quotation; lists penalties, retention, hidden costs and what to ask for instead.</T></View></Row>
      <Row wrap>
        <Btn icon={<Icon name="folder" />} title={file ? file.name : "Choose PDF or photo"} onPress={async () => { setErr(""); try { const f = await pickAndUpload(); if (f) setFile(f); } catch (e: any) { setErr(e.message); } }} />
      </Row>
      <Field label="…or paste the contract text" value={text} multiline onChange={setText} />
      <Btn kind="primary" icon={<Icon name="spark" color={c.accentInk} />} title="Check the contract" busy={busy} disabled={!file && !text.trim()} onPress={run} />
      {err ? <T color={c.bad}>{err}</T> : null}
      {res && <View style={{ gap: 10 }}>
        <T bold>Summary</T><T>{res.summary_ur}</T><T muted size={13}>{res.summary_en}</T>
        {(res.terms || []).length > 0 && <Table cols={["Term", "As written"]} rows={res.terms.map((x: any) => [x.term, x.value])} />}
        <T bold>Risks</T>
        {(res.risks || []).map((x: any, i: number) => (
          <Card key={i} style={{ backgroundColor: x.level === "high" ? c.badSoft : c.warnSoft, borderColor: "transparent" }}>
            <Pill kind={x.level === "high" ? "bad" : "warn"} text={x.level === "high" ? "High risk" : "Medium"} />
            <T size={14} style={{ writingDirection: "rtl", textAlign: "right" }}>{x.clause}</T>
            <T>{x.risk}</T>
            <T bold color={c.good}>Ask for: {x.counter}</T>
          </Card>))}
      </View>}
    </Card>
  );
}

function Compare() {
  const c = useColors();
  const [files, setFiles] = useState<{ path: string; name: string }[]>([]), [text, setText] = useState(""), [need, setNeed] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [res, setRes] = useState<any>(null);
  const run = async () => {
    setBusy(true); setErr(""); setRes(null);
    try { setRes(await ai("compare_quotes", { paths: files.map((f) => f.path), text, need })); } catch (e: any) { setErr(friendly(e.message)); } finally { setBusy(false); }
  };
  return (
    <Card>
      <Row><Icon name="truck" color={c.accent} /><View style={{ flex: 1 }}><H2>Compare supplier quotations</H2><T muted size={13}>Side by side: price, VAT, stock, delivery, payment terms and hidden costs; names the best value.</T></View></Row>
      <Field label="What is it for (e.g. Travertine 60×60, 2 cm, 800 m²)" value={need} onChange={setNeed} />
      <Row wrap>
        <Btn icon={<Icon name="plus" />} title="Add a quotation file" disabled={files.length >= 6} onPress={async () => { setErr(""); try { const f = await pickAndUpload(); if (f) setFiles([...files, f]); } catch (e: any) { setErr(e.message); } }} />
        {files.map((f) => <Pill key={f.path} kind="acc" text={f.name} />)}
      </Row>
      <Field label="…or paste the quotations (WhatsApp messages, emails)" value={text} multiline onChange={setText} />
      <Btn kind="primary" icon={<Icon name="spark" color={c.accentInk} />} title="Compare" busy={busy} disabled={!files.length && !text.trim()} onPress={run} />
      {err ? <T color={c.bad}>{err}</T> : null}
      {res && <View style={{ gap: 10 }}>
        <Table cols={["Supplier", "Item", "Unit price", "Total", "VAT", "Stock", "Delivery", "Payment", "Not included"]} numeric={[2, 3]}
          rows={(res.rows || []).map((x: any) => [x.supplier, x.item, x.unit_price ?? "—", x.total ?? "—", x.vat, x.stock, x.delivery, x.payment, (x.hidden || []).join(", ") || "—"])} />
        {res.best && <Card style={{ backgroundColor: c.goodSoft, borderColor: "transparent" }}><T bold color={c.good}>Best value: {res.best.supplier}</T><T>{res.best.why}</T></Card>}
        {(res.recommendations || []).map((x: string, i: number) => <T key={i}>• {x}</T>)}
      </View>}
    </Card>
  );
}

function Teach() {
  const c = useColors(); const { d, reload } = useData();
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const rules = (pref(d, "rules", { list: [] }).list || []).slice().reverse();
  const run = async () => {
    setBusy(true); setErr("");
    try { await ai("learn", { text }); setText(""); await reload(["preferences"]); } catch (e: any) { setErr(friendly(e.message)); } finally { setBusy(false); }
  };
  return (
    <Card>
      <Row><Icon name="spark" color={c.accent} /><View style={{ flex: 1 }}><H2>Teach your AI</H2><T muted size={13}>Tell it once, every agent follows it: e.g. “Al-Ajlan for travertine, not Al-Fozan” or “Riyadh margin never below 18%”.</T></View></Row>
      <Field label="Your rule or feedback" value={text} onChange={setText} />
      <Btn kind="primary" title="Save rule" busy={busy} disabled={!text.trim()} onPress={run} />
      {err ? <T color={c.bad}>{err}</T> : null}
      {rules.slice(0, 12).map((r: any, i: number) => <T key={i} size={14}>• <T bold size={14}>{r.category}</T> — {r.observed_rule} <T muted size={13}>→ {r.action_for_agents}</T></T>)}
    </Card>
  );
}
