// RFIs: when the BOQ, drawings and specs do not agree, ask the consultant in writing, follow up until answered,
// then let the AI read the answer and propose the exact quotation changes. Nothing changes until the owner applies it.
import React, { useState } from "react";
import { Linking, View } from "react-native";
import { useData } from "../lib/data";
import { day, stamp } from "../lib/fmt";
import { ai, supabase } from "../lib/supabase";
import { Btn, Card, Empty, Field, H1, H2, Icon, Pill, Row, Screen, Select, Sheet, T, useColors } from "../ui";
import { RequestPrices } from "./Suppliers";

const plusDays = (n: number) => day(Date.now() + n * 864e5);
const overdue = (r: any) => r.status === "Sent" && r.due_date && Date.parse(r.due_date) + 864e5 < Date.now();
const KIND: Record<string, "acc" | "warn" | "good" | "bad" | "plain"> = { Draft: "warn", Sent: "acc", Answered: "warn", Applied: "good", Closed: "plain" };
const openMail = (to: string, subject: string, body: string) => Linking.openURL(`mailto:${to || ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
const waNumber = (n: string) => String(n || "").replace(/\D/g, "").replace(/^0(?=5)/, "966");

/** Write or edit one RFI. Opened from the RFIs page or from a quotation's second-AI check. */
export function RfiEditor({ init, onClose }: { init: any; onClose: () => void }) {
  const { d, profile, reload } = useData(); const c = useColors();
  const [f, setF] = useState<any>(() => ({
    to_name: "", to_email: "", to_phone: "", subject: "", due_date: plusDays(3), lang: "en", letter: "",
    ...init, questions: (init.questions || []).map((q: any) => (typeof q === "string" ? { q, ref: "" } : q)),
  }));
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [tried, setTried] = useState(false);
  const quote = (d.quotes || []).find((q: any) => q.id === f.quote_id);
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const qs = f.questions.filter((q: any) => String(q.q || "").trim());
  const missing = [!f.subject.trim() && "Subject", !qs.length && "At least one question", !f.to_name.trim() && "Who it goes to"].filter(Boolean) as string[];

  const save = async (patch: any = {}) => {
    const row = { quote_id: f.quote_id || null, inquiry_id: f.inquiry_id || null, project_id: f.project_id || null, to_name: f.to_name, to_email: f.to_email, to_phone: f.to_phone,
      subject: f.subject, questions: qs, letter: f.letter, due_date: f.due_date || null, ...patch };
    const r = f.id ? await supabase.from("rfis").update(row).eq("id", f.id).select().single() : await supabase.from("rfis").insert(row).select().single();
    if (r.error) throw new Error(r.error.message);
    setF({ ...f, ...r.data, questions: r.data.questions }); await reload(["rfis"]);
    return r.data;
  };
  const write = async () => {
    setBusy("write"); setErr("");
    try {
      const saved = f.id ? f : await save();
      const r = await ai("rfi_letter", { questions: qs, to_name: f.to_name, project: quote?.title || f.subject, ref: saved.ref, due: f.due_date, lang: f.lang, signature: `${profile.name}, Al-Swati Contracting` });
      setF((x: any) => ({ ...x, ...saved, letter: r.body, mail_subject: r.subject }));
    } catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  };
  const send = async (how: "email" | "whatsapp") => {
    setTried(true); if (missing.length || !f.letter.trim()) return;
    setBusy("send"); setErr("");
    try {
      const r = await save({ status: "Sent", sent_at: new Date().toISOString() });
      const subject = f.mail_subject || `${r.ref} - ${f.subject}`;
      if (how === "email") await openMail(f.to_email, subject, f.letter);
      else await Linking.openURL(`https://wa.me/${waNumber(f.to_phone)}?text=${encodeURIComponent(subject + "\n\n" + f.letter)}`);
      if (f.inquiry_id) await supabase.from("inquiries").update({ status: "RFI Sent" }).eq("id", f.inquiry_id);
      onClose();
    } catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  };

  return (
    <Sheet open onClose={onClose} title={f.ref ? `${f.ref} · ${f.status || "Draft"}` : "New RFI"}>
      <Select label="For quotation (optional)" value={f.quote_id || ""} options={[{ value: "", label: "—" }, ...(d.quotes || []).map((q: any) => ({ value: q.id, label: q.title }))]} onChange={(v) => setF({ ...f, quote_id: v || null, inquiry_id: (d.quotes || []).find((q: any) => q.id === v)?.rfq?.inquiry_id || f.inquiry_id })} />
      <Field required label="Subject" value={f.subject} onChange={(v) => set("subject", v)} placeholder="e.g. Cladding stone thickness and fixing method" />
      <Row wrap>
        <Field required label="To (consultant / PM name)" value={f.to_name} onChange={(v) => set("to_name", v)} />
        <Field label="Email" value={f.to_email} onChange={(v) => set("to_email", v)} />
        <Field label="WhatsApp / phone" value={f.to_phone} onChange={(v) => set("to_phone", v)} style={{ maxWidth: 180 }} />
      </Row>
      <H2>Questions</H2>
      {f.questions.map((q: any, i: number) => (
        <Row key={i} wrap>
          <Field label={`${i + 1}.`} value={q.q} multiline onChange={(v) => set("questions", f.questions.map((x: any, j: number) => (j === i ? { ...x, q: v } : x)))} />
          <Field label="BOQ item / drawing ref" value={q.ref} onChange={(v) => set("questions", f.questions.map((x: any, j: number) => (j === i ? { ...x, ref: v } : x)))} style={{ maxWidth: 180 }} />
          <Btn kind="ghost" title="Remove" onPress={() => set("questions", f.questions.filter((_: any, j: number) => j !== i))} />
        </Row>))}
      <Btn kind="ghost" icon={<Icon name="plus" />} title="Question" onPress={() => set("questions", [...f.questions, { q: "", ref: "" }])} />
      <Row wrap>
        <Field label="Answer needed by" value={f.due_date} onChange={(v) => set("due_date", v)} placeholder="YYYY-MM-DD" style={{ maxWidth: 170 }} />
        <Select label="Letter language" value={f.lang} options={[{ value: "en", label: "English" }, { value: "ar", label: "العربية" }]} onChange={(v) => set("lang", v)} style={{ maxWidth: 170 }} />
      </Row>
      <Btn kind="primary" icon={<Icon name="spark" color={c.accentInk} />} title={f.letter ? "Write the letter again" : "Write the RFI letter"} busy={busy === "write"} disabled={!qs.length} onPress={write} />
      {f.letter ? <Field label="RFI letter (you can change it)" value={f.letter} multiline onChange={(v) => set("letter", v)} /> : null}
      {tried && (missing.length || !f.letter.trim()) ? <T color={c.bad}>Missing: {[...missing, !f.letter.trim() && "the letter"].filter(Boolean).join(", ")}</T> : null}
      {err ? <T color={c.bad}>{err}</T> : null}
      <Row wrap>
        <Btn title="Save draft" onPress={async () => { setTried(true); if (missing.length) return; try { await save(); } catch (e: any) { setErr(e.message); } }} />
        {f.to_email ? <Btn kind="primary" icon={<Icon name="share" color={c.accentInk} />} title="Open in email & mark sent" busy={busy === "send"} onPress={() => send("email")} /> : null}
        {f.to_phone ? <Btn icon={<Icon name="share" />} title="Open in WhatsApp & mark sent" onPress={() => send("whatsapp")} /> : null}
      </Row>
      <T size={12} muted>The email opens in your own mail app with everything filled in. You press send. The reply date is watched and you get a reminder when it passes.</T>
    </Sheet>
  );
}

/** Consultant answered: AI reads it and proposes changes; the owner ticks what to apply. */
function ApplyAnswer({ r, onClose, onAsk }: { r: any; onClose: () => void; onAsk: (items: any[], quote_id: string) => void }) {
  const { d, reload } = useData(); const c = useColors();
  const quote = (d.quotes || []).find((q: any) => q.id === r.quote_id);
  const [ans, setAns] = useState(r.answer || ""), [res, setRes] = useState<any>(r.changes?.proposed || null), [on, setOn] = useState<number[]>([]);
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const read = async () => {
    setBusy("read"); setErr("");
    try {
      await supabase.from("rfis").update({ answer: ans, answered_at: r.answered_at || new Date().toISOString(), status: r.status === "Sent" || r.status === "Draft" ? "Answered" : r.status }).eq("id", r.id);
      const x = await ai("rfi_apply", { questions: r.questions, answer: ans, lines: (quote?.lines || []).map((l: any, i: number) => ({ i, desc: l.desc, qty: l.qty, unit: l.unit })) });
      await supabase.from("rfis").update({ changes: { proposed: x } }).eq("id", r.id);
      setRes(x); setOn((x.changes || []).map((_: any, i: number) => i)); await reload(["rfis"]);
    } catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  };
  const apply = async () => {
    if (!quote) return;
    if (quote.rfq?.lock) { setErr("This quotation is approved & locked. Unlock it first (Quotations → Unlock to change), then apply."); return; }
    setBusy("apply"); setErr("");
    try {
      const picked = (res.changes || []).filter((_: any, i: number) => on.includes(i));
      let lines = [...(quote.lines || [])].map((l: any) => ({ ...l }));
      const drop = new Set<number>();
      for (const ch of picked) {
        if (ch.op === "edit" && lines[ch.i]) lines[ch.i] = { ...lines[ch.i], ...(ch.desc ? { desc: ch.desc } : {}), ...(ch.qty != null ? { qty: ch.qty } : {}), ...(ch.unit ? { unit: ch.unit } : {}) };
        if (ch.op === "remove" && lines[ch.i]) drop.add(ch.i);
        if (ch.op === "add" && ch.desc) lines.push({ desc: ch.desc, qty: ch.qty ?? 0, unit: ch.unit || "sqm", rate: null });
      }
      lines = lines.filter((_: any, i: number) => !drop.has(i));
      const hist = [...(quote.history || []), `${stamp(Date.now())} updated from ${r.ref}: ${picked.length} change(s)`];
      const u = await supabase.from("quotes").update({ lines, history: hist, rfq: { ...(quote.rfq || {}), audit: quote.rfq?.audit ? { ...quote.rfq.audit, stale: true } : quote.rfq?.audit } }).eq("id", quote.id).select("id");
      if (u.error || !u.data?.length) throw new Error(u.error?.message || "Quotation not updated.");
      await supabase.from("rfis").update({ status: (res.still_open || []).length ? "Answered" : "Applied", changes: { proposed: res, applied: picked, at: new Date().toISOString() } }).eq("id", r.id);
      await reload(["rfis", "quotes"]);
      if ((res.supplier_items || []).length) onAsk(res.supplier_items, quote.id); else onClose();
    } catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  };
  return (
    <Sheet open onClose={onClose} title={`${r.ref} · consultant's answer`}>
      <T muted>{r.subject}{quote ? ` · quotation "${quote.title}"` : " · no quotation linked"}</T>
      <Field label="Paste the consultant's reply (email text, or type what they said)" value={ans} multiline onChange={setAns} />
      <Btn kind="primary" icon={<Icon name="spark" color={c.accentInk} />} title="Read the answer" busy={busy === "read"} disabled={!ans.trim()} onPress={read} />
      {res && <>
        {res.summary_ur ? <Card><T>{res.summary_ur}</T></Card> : null}
        {(res.answers || []).map((a: any, i: number) => <Row key={i} wrap><Pill kind={a.clear ? "good" : "warn"} text={a.clear ? "answered" : "unclear"} /><T size={13} style={{ flex: 1 }}>{a.q} → {a.answer}</T></Row>)}
        {(res.still_open || []).length ? <T color={c.bad}>Still open: {res.still_open.join(" · ")} — send a follow-up for these.</T> : null}
        <H2>Changes to the quotation</H2>
        {!(res.changes || []).length && <T muted>No change needed from this answer.</T>}
        {(res.changes || []).map((ch: any, i: number) => { const sel = on.includes(i); const cur = quote?.lines?.[ch.i];
          return <Card key={i} onPress={() => setOn(sel ? on.filter((x) => x !== i) : [...on, i])} style={{ borderColor: sel ? c.accent : c.line, borderWidth: sel ? 2 : 1 }}>
            <Row><Pill kind={ch.op === "remove" ? "bad" : ch.op === "add" ? "acc" : "warn"} text={`${sel ? "✓ " : ""}${ch.op}`} /><T bold style={{ flex: 1 }}>{ch.op === "add" ? ch.desc : `Line ${ch.i + 1}: ${cur?.desc || "?"}`}</T></Row>
            {ch.op === "edit" && <T size={13}>{[ch.desc && `→ ${ch.desc}`, ch.qty != null && `qty ${cur?.qty ?? "?"} → ${ch.qty}`, ch.unit && `unit → ${ch.unit}`].filter(Boolean).join(" · ")}</T>}
            <T size={12} muted>{ch.why}</T>
          </Card>; })}
        {(res.supplier_items || []).length ? <T size={13}>Material changed — after applying, you can ask suppliers for: {res.supplier_items.map((x: any) => x.desc).join(", ")}</T> : null}
        {err ? <T color={c.bad}>{err}</T> : null}
        {quote && (res.changes || []).length > 0 && <Btn big kind="primary" title={`Apply ${on.length} change(s) to the quotation`} busy={busy === "apply"} disabled={!on.length} onPress={apply} />}
        <T size={12} muted>Rates and costs are never changed here. After applying, open the quotation, check the prices, run the second AI check again and Approve & Lock.</T>
      </>}
      {!res && err ? <T color={c.bad}>{err}</T> : null}
    </Sheet>
  );
}

function FollowUp({ r, onClose }: { r: any; onClose: () => void }) {
  const { profile, reload } = useData(); const c = useColors();
  const [m, setM] = useState<any>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const write = async () => {
    setBusy(true); setErr("");
    try { setM(await ai("rfi_followup", { ref: r.ref, subject: r.subject, sent_on: day(r.sent_at || r.created_at), to_name: r.to_name, n: (r.follow_ups || []).length + 1, questions: (r.questions || []).map((q: any) => q.q), signature: `${profile.name}, Al-Swati Contracting` })); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const send = async (how: "email" | "whatsapp") => {
    if (how === "email") await openMail(r.to_email, m.subject, m.body); else await Linking.openURL(`https://wa.me/${waNumber(r.to_phone)}?text=${encodeURIComponent(m.body)}`);
    await supabase.from("rfis").update({ follow_ups: [...(r.follow_ups || []), { at: new Date().toISOString(), text: m.body }], due_date: plusDays(2) }).eq("id", r.id);
    await reload(["rfis"]); onClose();
  };
  return (
    <Sheet open onClose={onClose} title={`Follow-up · ${r.ref}`}>
      <T muted>Sent {day(r.sent_at || r.created_at)} to {r.to_name} · {(r.follow_ups || []).length} follow-up(s) so far.</T>
      {!m && <Btn kind="primary" icon={<Icon name="spark" color={c.accentInk} />} title="Write a polite follow-up" busy={busy} onPress={write} />}
      {m && <>
        <Field label="Subject" value={m.subject} onChange={(v) => setM({ ...m, subject: v })} />
        <Field label="Message" value={m.body} multiline onChange={(v) => setM({ ...m, body: v })} />
        <Row wrap>
          {r.to_email ? <Btn kind="primary" icon={<Icon name="share" color={c.accentInk} />} title="Open in email" onPress={() => send("email")} /> : null}
          {r.to_phone ? <Btn icon={<Icon name="share" />} title="Open in WhatsApp" onPress={() => send("whatsapp")} /> : null}
        </Row>
        <T size={12} muted>The new reply date is set 2 days from now.</T>
      </>}
      {err ? <T color={c.bad}>{err}</T> : null}
    </Sheet>
  );
}

export default function RFIs() {
  const { d, reload } = useData(); const c = useColors();
  const [ed, setEd] = useState<any>(null), [ap, setAp] = useState<any>(null), [fu, setFu] = useState<any>(null), [ask, setAsk] = useState<any>(null);
  const [show, setShow] = useState("open");
  const list = (d.rfis || []).filter((r: any) => show === "all" || (show === "open" ? !["Applied", "Closed"].includes(r.status) : r.status === show));
  const qTitle = (id: string) => (d.quotes || []).find((q: any) => q.id === id)?.title;
  return (
    <Screen>
      <Row><View style={{ flex: 1 }}><H1>RFIs</H1></View><Btn kind="primary" icon={<Icon name="plus" color="#fff" />} title="New RFI" onPress={() => setEd({})} /></Row>
      <T muted>Questions to the consultant when the BOQ, drawings and specs don't match. Make them from a quotation's "Second AI check", or here.</T>
      <Row wrap>{[["open", "Open"], ["Sent", "Waiting"], ["Answered", "Answered"], ["all", "All"]].map(([k, l]) => <Btn key={k} kind={show === k ? "primary" : "ghost"} title={l} onPress={() => setShow(k)} />)}</Row>
      {!list.length && <Empty text="No RFIs here." />}
      {list.map((r: any) => (
        <Card key={r.id}>
          <Row>
            <View style={{ flex: 1 }}><T bold>{r.ref} · {r.subject}</T><T size={13} muted>To {r.to_name || "—"}{qTitle(r.quote_id) ? ` · quotation "${qTitle(r.quote_id)}"` : ""} · {(r.questions || []).length} question(s)</T></View>
            {overdue(r) && <Pill kind="bad" text="answer overdue" />}
            <Pill kind={KIND[r.status]} text={r.status} />
          </Row>
          <T size={13} muted>{r.sent_at ? `Sent ${day(r.sent_at)}` : "Not sent yet"}{r.due_date ? ` · reply by ${r.due_date}` : ""}{(r.follow_ups || []).length ? ` · ${r.follow_ups.length} follow-up(s)` : ""}{r.answered_at ? ` · answered ${day(r.answered_at)}` : ""}</T>
          <Row wrap>
            {r.status === "Draft" && <Btn kind="primary" title="Open & send" onPress={() => setEd(r)} />}
            {r.status === "Sent" && <Btn kind={overdue(r) ? "primary" : "default"} title="Follow-up" onPress={() => setFu(r)} />}
            {["Sent", "Answered"].includes(r.status) && <Btn kind={r.status === "Answered" ? "primary" : "default"} title={r.status === "Answered" ? "Read answer & update quotation" : "Answer received"} onPress={() => setAp(r)} />}
            {r.status !== "Closed" && r.status !== "Draft" && <Btn kind="ghost" title="Close" onPress={async () => { await supabase.from("rfis").update({ status: "Closed" }).eq("id", r.id); reload(["rfis"]); }} />}
            {r.status === "Draft" && <Btn kind="ghost" title="Delete" onPress={async () => { await supabase.from("rfis").delete().eq("id", r.id); reload(["rfis"]); }} />}
          </Row>
        </Card>))}
      {ed && <RfiEditor init={ed} onClose={() => setEd(null)} />}
      {ap && <ApplyAnswer r={ap} onClose={() => setAp(null)} onAsk={(items, quote_id) => { setAp(null); setAsk({ items, quote_id }); }} />}
      {fu && <FollowUp r={fu} onClose={() => setFu(null)} />}
      {ask && <RequestPrices init={ask} onClose={() => setAsk(null)} />}
    </Screen>
  );
}
