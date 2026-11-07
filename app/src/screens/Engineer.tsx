// Engineer: site progress by subcontractor (filled automatically from supervisors), and drawings with revisions.
import * as DocumentPicker from "expo-document-picker";
import React, { useState } from "react";
import { Linking, View } from "react-native";
import { useFlows } from "../components/Flows";
import { active, pname, useData } from "../lib/data";
import { signedUrl } from "../lib/files";
import { day, money, r2, uid } from "../lib/fmt";
import { Btn, Card, Empty, Field, H1, Icon, Pill, Row, Screen, Select, Sheet, T, useColors } from "../ui";

export function Progress() {
  const { d } = useData(); const flows = useFlows(); const c = useColors();
  return (
    <Screen>
      <H1>Site progress</H1>
      <Row wrap><Btn kind="primary" icon={<Icon name="mic" color={c.accentInk} />} title="Report progress" onPress={() => flows("speak")} /><Btn icon={<Icon name="spark" />} title="Ask your AI" onPress={() => flows("ask")} /></Row>
      {(d.projects || []).map((p: any) => {
        const pr = active(d.progress).filter((x: any) => x.project_id === p.id);
        const by: Record<string, { qty: number; unit: string; works: Set<string> }> = {};
        pr.forEach((x: any) => { const k = x.sub_name; by[k] = by[k] || { qty: 0, unit: x.unit, works: new Set() }; by[k].qty += Number(x.qty); if (x.work) by[k].works.add(x.work); });
        return (
          <Card key={p.id}>
            <Row><T bold size={17} style={{ flex: 1 }}>{p.name}</T><T bold>{money(r2(pr.reduce((s: number, x: any) => s + Number(x.qty), 0)))} installed</T></Row>
            {Object.entries(by).map(([k, v]) => <Row key={k}><T style={{ flex: 1 }}>{k} · {[...v.works].join(", ")}</T><T bold>{money(r2(v.qty))} {v.unit}</T></Row>)}
            {!pr.length && <T muted>No progress reported yet.</T>}
            {pr.slice(0, 4).map((x: any) => <T key={x.id} size={12} muted>{day(x.created_at)} · {x.sub_name} {x.qty} {x.unit} {x.work}</T>)}
          </Card>);
      })}
    </Screen>
  );
}

const STATES = ["Pending", "Approved", "Approved with Comments", "Rejected"];
export function Docs() {
  const { d, insert, update, role } = useData(); const c = useColors();
  const [f, setF] = useState<any>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const docs = d.documents || [];
  const latest = (x: any) => !docs.some((o: any) => o.project_id === x.project_id && o.doc_no === x.doc_no && o.created_at > x.created_at);
  const upload = async () => {
    setBusy(true); setErr("");
    try {
      const ext = (f.file.name.split(".").pop() || "pdf").toLowerCase();
      const path = `${f.project_id}/${uid()}.${ext}`;
      const r = await insert("documents", { project_id: f.project_id, doc_no: f.doc_no.trim(), rev: f.rev || "Rev 0", state: f.state, name: f.file.name }, { bucket: "documents", uri: f.file.uri, field: "file_path", path, contentType: f.file.mimeType || "application/pdf" });
      if (r.queued) setErr("Saved on the phone; it uploads when the internet is back."); else setF(null);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const canEdit = role === "engineer" || role === "admin";
  return (
    <Screen>
      <Row><View style={{ flex: 1 }}><H1>Drawings & documents</H1></View>{canEdit && <Btn kind="primary" icon={<Icon name="plus" color={c.accentInk} />} title="Upload" onPress={() => setF({ project_id: "", doc_no: "", rev: "", state: "Pending", file: null })} />}</Row>
      <T muted size={13}>A new revision of the same drawing number becomes the one supervisors see. Older revisions stay for the record.</T>
      {docs.length ? docs.map((x: any) => (
        <Card key={x.id} style={latest(x) ? undefined : { opacity: 0.55 }}>
          <Row><View style={{ flex: 1 }}><T bold>{x.doc_no} · {x.rev}</T><T muted size={13}>{pname(d, x.project_id)} · {day(x.created_at)} · {x.name}</T></View>
            <Pill kind={x.state === "Approved" ? "good" : x.state === "Rejected" ? "bad" : "warn"} text={x.state} /></Row>
          <Row wrap>
            {latest(x) ? <Pill kind="good" text="Latest" /> : <Pill text="Old revision" />}
            <Btn title="Open" onPress={async () => { const u = await signedUrl("documents", x.file_path); if (u) Linking.openURL(u); }} />
            {canEdit && latest(x) && <Select value={x.state} onChange={(v) => update("documents", x.id, { state: v })} options={STATES.map((s) => ({ value: s, label: s }))} />}
          </Row>
        </Card>)) : <Empty text="No drawings yet." />}
      <Sheet open={!!f} onClose={() => setF(null)} title="Upload drawing or document">
        {f && <>
          <Select label="Project" value={f.project_id} onChange={(v) => setF({ ...f, project_id: v })} options={(d.projects || []).map((p: any) => ({ value: p.id, label: p.name }))} />
          <Row><Field label="Drawing / document no." value={f.doc_no} onChange={(v) => setF({ ...f, doc_no: v })} placeholder="A-101" /><Field label="Revision" value={f.rev} onChange={(v) => setF({ ...f, rev: v })} placeholder="Rev B" /></Row>
          <Select label="Consultant status" value={f.state} onChange={(v) => setF({ ...f, state: v })} options={STATES.map((s) => ({ value: s, label: s }))} />
          <Btn icon={<Icon name="folder" />} title={f.file ? f.file.name : "Choose file (PDF, image, DWG)"} onPress={async () => { const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true }); if (!r.canceled && r.assets?.[0]) setF({ ...f, file: r.assets[0] }); }} />
          {err ? <T color={c.warn}>{err}</T> : null}
          <Btn big kind="primary" title="Upload" busy={busy} disabled={!f.project_id || !f.doc_no || !f.file} onPress={upload} />
        </>}
      </Sheet>
    </Screen>
  );
}
