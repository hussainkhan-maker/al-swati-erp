// Client queries arriving from email and the website. The AI reads each one twice, code runs the gates,
// and only a query with no red gate becomes a quotation.
import React, { useEffect, useState } from "react";
import { Linking, Platform, View } from "react-native";
import { rfqGates } from "../lib/checks";
import { useData } from "../lib/data";
import { signedUrl } from "../lib/files";
import { day, matchItems, money, num, stamp } from "../lib/fmt";
import { ai, API_URL, PUBLIC_ANON_KEY, supabase } from "../lib/supabase";
import { Btn, Card, Empty, Field, H1, H2, Icon, Pill, Row, Screen, Select, Sheet, T, Table, useColors } from "../ui";
import { RfiEditor } from "./RFIs";
import { RequestPrices } from "./Suppliers";
import { projectFromQuote, quoteFromQuery } from "../lib/pipeline";
import { priceHint } from "./Quotes";

const LINK_RE = /https?:\/\/(drive\.google\.com|docs\.google\.com\/spreadsheets|(www\.)?dropbox\.com)\/\S+/i;

/** The Gmail script, filled in with this app's address and the link code (made here, only its fingerprint is stored). */
const gmailScript = (code: string) => `/**
 * Gmail <-> AL-Swati ERP. Paste into script.google.com while signed in with the Gmail that receives client RFQs.
 * Every 5 minutes: (1) sends new emails labelled "RFQ" (with their files) to the app, then labels them "RFQ/Sent to ERP";
 * (2) turns the replies you approved in the app into DRAFTS in this Gmail. Nothing is ever sent without you pressing Send.
 * Setup: run setup() once and allow access. Then in Gmail make a filter that adds the label "RFQ" to client queries.
 */
const ERP_URL = "${API_URL}/functions/v1/inbound-query";
const APP_KEY = "${PUBLIC_ANON_KEY}"; // the app's public key (not a secret)
const LINK_CODE = "${code}"; // keep private: it lets this script talk to your app

function setup() {
  GmailApp.createLabel("RFQ");
  GmailApp.createLabel("RFQ/Sent to ERP");
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("runAll").timeBased().everyMinutes(5).create();
  runAll();
}
function runAll() { pushNewQueries(); pushDrafts(); }
function call_(payload) {
  return UrlFetchApp.fetch(ERP_URL, { method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { "x-intake-secret": LINK_CODE, Authorization: "Bearer " + APP_KEY, apikey: APP_KEY }, payload: JSON.stringify(payload) });
}
function pushNewQueries() {
  const done = GmailApp.getUserLabelByName("RFQ/Sent to ERP");
  const threads = GmailApp.search('label:RFQ -label:"RFQ/Sent to ERP" newer_than:14d', 0, 20);
  threads.forEach((th) => {
    const m = th.getMessages()[0];
    const from = m.getFrom();
    const atts = m.getAttachments({ includeInlineImages: false }).filter((a) => a.getSize() < 15 * 1024 * 1024).slice(0, 10)
      .map((a) => ({ name: a.getName(), type: a.getContentType(), base64: Utilities.base64Encode(a.getBytes()) }));
    const res = call_({ source: /website|form|wordpress|wix/i.test(from) ? "website" : "email",
      from_name: from.replace(/<.*>/, "").trim(), from_email: (from.match(/<(.+)>/) || [, from])[1],
      subject: m.getSubject(), body: m.getPlainBody().slice(0, 100000), message_id: m.getId(), attachments: atts });
    if (res.getResponseCode() < 300) th.addLabel(done); else console.log("ERP refused: " + res.getContentText());
  });
}
function pushDrafts() {
  const res = call_({ action: "outbox" });
  if (res.getResponseCode() >= 300) { console.log("ERP refused: " + res.getContentText()); return; }
  (JSON.parse(res.getContentText()).items || []).forEach((it) => {
    try {
      let msg = null;
      try { if (it.gmail_id) msg = GmailApp.getMessageById(it.gmail_id); } catch (e) {}
      if (msg) msg.createDraftReply(it.body); else GmailApp.createDraft(it.to_email, it.subject, it.body);
      call_({ action: "drafted", id: it.id, ok: true });
    } catch (e) { call_({ action: "drafted", id: it.id, ok: false, error: String(e) }); }
  });
}
`;

/** Outlook (Microsoft 365): linked once with Microsoft's own sign-in. The server then reads new inbox emails every 30 minutes
 *  (app open or not), the AI keeps the client queries, and approved replies go to Outlook Drafts. Nothing is sent by itself. */
async function mail(action: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke("inbound-query", { body: { action, ...extra } });
  if (error) { let m = error.message; try { const j = await (error as any).context?.json?.(); if (j?.error) m = j.error; } catch { /* keep the first message */ } throw new Error(m); }
  if (data?.error) throw new Error(data.error);
  return data;
}
export function OutlookLink() {
  const { reload } = useData(); const c = useColors();
  const [st, setSt] = useState<any>(null), [waiting, setWaiting] = useState(false), [msg, setMsg] = useState(""), [busy, setBusy] = useState("");
  const load = () => mail("outlook_status").then((x) => { setSt(x); return x; }).catch((e) => { setMsg(e.message); return null; });
  // Back from Microsoft's sign-in page (…?code=…&state=…): hand the one-time code to the server, then look at the inbox.
  useEffect(() => {
    const u = Platform.OS === "web" ? new URLSearchParams(globalThis.location?.search || "") : null;
    const back = u?.get("state") ? { code: u.get("code") || "", state: u.get("state") || "", error: u.get("error") || "", error_description: u.get("error_description") || "" } : null;
    if (back) try { globalThis.history?.replaceState(null, "", globalThis.location.pathname); } catch { /* keep the address */ }
    if (!back) { load(); return; }
    setBusy("start");
    mail("outlook_finish", back).then(async (r) => { const x = await load(); if (r.done && x?.linked) { setMsg(`Connected to ${r.account}. Checking your inbox now…`); check(); } })
      .catch((e) => { setMsg(e.message); load(); }).finally(() => setBusy(""));
  }, []);
  // Signed in on the phone's browser: keep asking until the server has the link.
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => { const x = await load(); if (x?.linked) { setWaiting(false); setMsg(`Connected to ${x.account}.`); check(); } }, 5000);
    return () => clearInterval(t);
  }, [waiting]);
  const start = async () => {
    setBusy("start"); setMsg("");
    try {
      const { url } = await mail("outlook_start");
      if (Platform.OS === "web") globalThis.location.assign(url); // Microsoft's page, then back here
      else { setWaiting(true); Linking.openURL(url); }
    } catch (e: any) { setMsg(e.message); } finally { setBusy(""); }
  };
  const check = async () => {
    setBusy("check"); setMsg("");
    try { const r = await mail("outlook_pull"); setMsg(r.busy ? "Already checking, give it a minute." : `Looked at ${r.checked ?? 0} new email${r.checked === 1 ? "" : "s"}: ${r.taken ?? 0} client quer${r.taken === 1 ? "y" : "ies"} added${r.drafted ? `, ${r.drafted} reply draft(s) put in Outlook` : ""}.${r.more ? " More are waiting: press Check now again." : ""}`); await reload(["inquiries", "email_outbox"]); await load(); }
    catch (e: any) { setMsg(e.message); await load(); } finally { setBusy(""); }
  };
  const mins = st?.last_pull ? Math.round((Date.now() - Date.parse(st.last_pull)) / 60000) : null;
  return (
    <Card>
      <Row><T bold style={{ flex: 1 }}>Outlook email</T>
        {st == null ? null : st.linked ? <Pill kind={st.last_error ? "bad" : "good"} text={st.last_error ? "needs attention" : mins == null ? `connected · ${st.account}` : `connected · checked ${mins} min ago`} /> : <Pill kind="warn" text="not connected" />}
      </Row>
      <T size={13} muted>{st?.linked
        ? `${st.account}: the AI reads each new email in your inbox and brings client queries here with their files (${st.taken} so far, from ${st.checked} emails looked at). They get the category "AL-Swati ERP" in Outlook. Replies you approve go to your Outlook Drafts; nothing is sent by itself.`
        : "Link your Outlook once. The server then reads new emails every 30 minutes, even with the app closed: the AI keeps the client queries (with their files) and makes draft quotations. Replies you approve go to your Outlook Drafts; nothing is sent by itself."}</T>
      {st?.last_error ? <T size={13} color={c.bad}>{st.last_error}</T> : null}
      {waiting ? <T size={13}>Finish the sign-in on Microsoft's page, then come back here. This card updates by itself.</T> : null}
      <Row wrap>
        {st?.linked ? <><Btn kind="primary" title="Check now" busy={busy === "check"} onPress={check} />
          <Btn kind="ghost" title="Disconnect" onPress={async () => { try { await mail("outlook_disconnect"); setMsg("Disconnected. The app no longer reads your Outlook."); load(); } catch (e: any) { setMsg(e.message); } }} /></>
          : <Btn kind="primary" title="Sign in with Microsoft" busy={busy === "start"} onPress={start} />}
      </Row>
      {!st?.linked ? <T size={12} muted>Microsoft asks you once to allow "AL-Swati ERP mail" to read and write your mail: that is this app.</T> : null}
      {msg ? <T size={13} color={/^(Connected|Looked|Disconnected|Already)/.test(msg) ? c.ink : c.bad}>{msg}</T> : null}
    </Card>
  );
}

/** Connect Gmail: makes a private link code, shows the ready script to paste into script.google.com. */
function GmailLink() {
  const { d, reload } = useData(); const c = useColors();
  const pref = (k: string) => (d.preferences || []).find((p: any) => p.key === k)?.value;
  const link = pref("gmail_link"), seen = pref("gmail_seen");
  const [script, setScript] = useState(""), [msg, setMsg] = useState(""), [show, setShow] = useState(false);
  const make = async () => {
    setMsg("");
    try {
      if (Platform.OS !== "web" || !globalThis.crypto?.subtle) { setMsg("Do this once on the laptop."); return; }
      const b = new Uint8Array(24); globalThis.crypto.getRandomValues(b);
      const code = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
      const hash = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(code))), (x) => x.toString(16).padStart(2, "0")).join("");
      const { error } = await supabase.from("preferences").upsert({ key: "gmail_link", value: { hash, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      await reload(["preferences"]); setScript(gmailScript(code)); setShow(true);
    } catch (e: any) { setMsg(e.message); }
  };
  const minsAgo = seen?.at ? Math.round((Date.now() - Date.parse(seen.at)) / 60000) : null;
  return (
    <Card>
      <Row><T bold style={{ flex: 1 }}>Gmail</T>
        {link ? <Pill kind={minsAgo != null && minsAgo < 30 ? "good" : "warn"} text={minsAgo == null ? "script not running yet" : minsAgo < 30 ? `connected · checked ${minsAgo} min ago` : `last checked ${day(seen.at)}`} /> : <Pill kind="warn" text="not connected" />}
        <Btn kind="ghost" title={show ? "Hide" : link ? "Set up again" : "Connect Gmail"} onPress={() => (show ? setShow(false) : make())} /></Row>
      {!show && <T size={13} muted>Client emails labelled RFQ arrive here with their files, and the replies you approve go into your Gmail as drafts.</T>}
      {msg ? <T color={c.bad}>{msg}</T> : null}
      {show && script ? <>
        <T size={14}>1. Open script.google.com with the Gmail that gets client queries → New project.</T>
        <T size={14}>2. Delete what is there, press "Copy script" below and paste it. Save.</T>
        <T size={14}>3. Choose "setup" at the top and press Run. Google asks to allow access to your Gmail: allow it (it is your own script).</T>
        <T size={14}>4. In Gmail, make a filter that adds the label "RFQ" to client queries (e.g. words BOQ, RFQ, quotation, عرض سعر, or your website form address).</T>
        <Row wrap><Btn kind="primary" title="Copy script" onPress={async () => { try { await (navigator as any).clipboard.writeText(script); setMsg("Copied. Paste it in script.google.com."); } catch { setMsg("Copy did not work: select the text below and copy it."); } }} />
          <Btn title="Open script.google.com" onPress={() => Linking.openURL("https://script.google.com/home/projects/create")} /></Row>
        <T size={12} muted>The script holds a private code that lets it talk to this app. Making a new code here stops the old script; then paste the new one.</T>
        <Field label="Script" value={script} multiline onChange={() => {}} />
      </> : null}
    </Card>
  );
}

const STATUSES = ["New", "Under Review", "RFI Sent", "Priced", "Sent", "Won", "Lost"];

export default function Queries() {
  const { d, insert, update } = useData(); const c = useColors();
  const [open, setOpen] = useState<any>(null), [add, setAdd] = useState<any>(null), [filter, setFilter] = useState("open");
  const list = (d.inquiries || []).filter((q: any) => filter === "all" || (filter === "open" ? !["Sent", "Won", "Lost"].includes(q.status) : q.status === filter));
  return (
    <Screen>
      <Row><View style={{ flex: 1 }}><H1>Client queries</H1></View><Btn icon={<Icon name="plus" />} title="Paste one" onPress={() => setAdd({ subject: "", from_name: "", body: "" })} /></Row>
      <OutlookLink />
      <GmailLink />
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
          <Field label="Client email (for the reply)" value={add.from_email || ""} onChange={(v) => setAdd({ ...add, from_email: v.trim() })} />
          <Field label="BOQ text" value={add.body} multiline onChange={(v) => setAdd({ ...add, body: v })} placeholder={"1. Supply & install Crema Marfil 60x60 polished floor — 450 Sqm\n2. Granite facade cladding 30mm with SS anchors — 320 Sqm"} />
          <Field label="File links (Google Drive, Google Sheets, Dropbox — one per line)" value={add.links || ""} multiline onChange={(v) => setAdd({ ...add, links: v })} />
          <T size={12} muted>Linked files are downloaded and read with the query. They must be shared as "Anyone with the link". DWG cannot be read: ask for PDF or DXF.</T>
          {add.err ? <T color={c.bad}>{add.err}</T> : null}
          <Btn big kind="primary" title={add.busy ? "Saving…" : "Save"} disabled={!add.body.trim() || add.busy} onPress={async () => {
            setAdd({ ...add, busy: true, err: "" });
            try {
              const { links, busy, err, ...row } = add;
              const body = row.body + (links?.trim() ? "\n\nFiles: " + links.trim() : "");
              const r: any = await insert("inquiries", { ...row, body, source: "manual", dedupe_key: "manual-" + Date.now() });
              if (r?.data?.id && LINK_RE.test(body)) await ai("attach_links", { inquiry_id: r.data.id });
              setAdd(null);
            } catch (e: any) { setAdd({ ...add, busy: false, err: e.message }); }
          }} />
        </>}
      </Sheet>
    </Screen>
  );
}

function QuerySheet({ q, onClose }: { q: any; onClose: () => void }) {
  const { d, insert, update, reload } = useData(); const c = useColors();
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [ask, setAsk] = useState<any>(null), [made, setMade] = useState("");
  const [rfi, setRfi] = useState<any>(null), [reply, setReply] = useState<any>(null), [links, setLinks] = useState("");
  const r = q.reading;
  const hasPrice = (desc: string) => !!matchItems(desc, d.items || [])[0];
  const gates = r && !r.error ? rfqGates(q.body || "", r.a || {}, r.b || {}, hasPrice) : [];
  const red = gates.some((g) => g.s === "bad");
  const lines = (r?.a?.lines || []) as any[];
  const read = async () => { setBusy(true); setErr(""); try { await ai("rfq", { inquiry_id: q.id }); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const makeQuote = async () => {
    try { await quoteFromQuery(q, d, insert, update, priceHint); } catch (e: any) { setErr(e.message); return; }
    setMade("Quotation made. Open Quotations to check the rates (some may be filled from earlier quotations).");
  };
  return (
    <Sheet open onClose={onClose} title={`${q.ref} · ${q.subject || ""}`}>
      <Row wrap><Select label="Status" value={q.status} onChange={async (v) => {
        await update("inquiries", q.id, { status: v });
        // Marked Won here: the quotation is approved and the project opens by itself.
        const qt = (d.quotes || []).find((x: any) => x.id === q.quote_id);
        if (v === "Won" && qt && !qt.project_id) { try { await projectFromQuote(qt, d, reload); setMade("Won: the project is open under Projects."); } catch (e: any) { setErr(e.message); } }
      }} options={STATUSES.map((s) => ({ value: s, label: s }))} />
        <Field label="Deadline (YYYY-MM-DD)" value={q.deadline || ""} onChange={(v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && update("inquiries", q.id, { deadline: v })} /></Row>
      <Card><T muted size={13}>{q.from_name} {q.from_email ? `<${q.from_email}>` : ""}</T><T numberOfLines={12}>{q.body}</T></Card>
      {LINK_RE.test(q.body || "") && <Btn icon={<Icon name="folder" />} title={links || "Download the linked files (Drive / Dropbox)"} onPress={async () => { setLinks("Downloading…"); try { const r = await ai("attach_links", { inquiry_id: q.id }); setLinks(`${r.added} file(s) added${r.notes?.length ? " · " + r.notes.join(" · ") : ""}`); } catch (e: any) { setLinks(e.message); } }} />}
      {(q.attachments || []).length > 0 && <Card><T bold>Files</T>{q.attachments.map((a: any) => <Btn key={a.path} kind="ghost" title={a.name} onPress={async () => { const u = await signedUrl("inbox", a.path); if (u) Linking.openURL(u); }} />)}</Card>}
      <Btn big kind="primary" icon={<Icon name="spark" color={c.accentInk} />} title={r ? "Read again and check" : "Read with AI and check"} busy={busy} onPress={read} />
      {busy && <T muted>Two AI readers are going through the BOQ, drawings and Excel separately. This takes about a minute.</T>}
      {err ? <T color={c.bad}>{err}</T> : null}
      {r?.error ? <T color={c.bad}>The automatic reading did not work ({r.error}). Press "Read again and check".</T> : null}
      {r && !r.error && <>
        <H2>Risk report</H2>
        {gates.map((g) => (
          <Card key={g.n} style={{ borderColor: g.s === "bad" ? c.bad : g.s === "warn" ? c.warn : c.line }}>
            <Row><Pill kind={g.s === "bad" ? "bad" : g.s === "warn" ? "warn" : "good"} text={`Gate ${g.n}`} /><T bold style={{ flex: 1 }}>{g.name}</T></Row>
            {g.d.map((x, i) => <T key={i} size={14}>• {x}</T>)}
          </Card>))}
        {(r.a?.category || (r.a?.documents || []).length > 0) && <Card><T bold>Organized pack{r.a?.category ? ` · ${r.a.category}` : ""}</T>
          {(r.a?.documents || []).map((x: any, i: number) => <Row key={i}><Pill kind="acc" text={x.kind || "file"} /><View style={{ flex: 1 }}><T size={14} bold>{x.name}</T><T size={13} muted>{x.summary}</T></View></Row>)}</Card>}
        {(r.a?.specs || []).length > 0 && <Card><T bold>Specification points</T>{r.a.specs.map((x: any, i: number) => <T key={i} size={14}>• {typeof x === "string" ? x : JSON.stringify(x)}</T>)}</Card>}
        {(r.a?.drawingQuantities || []).length > 0 && <Card><T bold>Quantities from drawings (vs BOQ)</T>
          <Table cols={["Area / element", "Qty", "Unit", "From"]} numeric={[1]} rows={r.a.drawingQuantities.map((x: any) => [x.what || x.desc || "", x.qty == null ? "?" : money(x.qty), x.unit || "", x.source || ""])} />
          <T size={12} muted>Differences above 3% are added to the questions for the consultant.</T></Card>}
        {(r.a?.siteChecks || []).length > 0 && <Card><T bold>Site checks before work</T>{r.a.siteChecks.map((x: string, i: number) => <T key={i}>• {x}</T>)}</Card>}
        <Table cols={["Ref", "Description", "Qty", "Unit"]} numeric={[2]} rows={lines.map((l) => [l.ref || "", l.desc, l.qty == null ? "?" : money(l.qty), l.unit])} />
        {(r.a?.rfis || []).length > 0 && <Btn icon={<Icon name="share" />} title={`Make RFI (${r.a.rfis.length} questions)`} onPress={() => setRfi({ inquiry_id: q.id, quote_id: q.quote_id || null, subject: `${q.subject || q.ref} - clarifications`, to_name: q.from_name || "", to_email: q.from_email || "", questions: r.a.rfis })} />}
        <Btn icon={<Icon name="truck" />} title="Ask suppliers for prices" onPress={() => setAsk({ inquiry_id: q.id, items: lines.map((l) => ({ desc: l.desc, qty: l.qty, unit: l.unit })) })} />
        <Btn big kind="primary" title="Make quotation" disabled={red || !lines.length || !!q.quote_id} onPress={makeQuote} />
        {red && <T color={c.bad}>Red gates must be fixed first. Check the files, or paste the corrected BOQ as a new query.</T>}
        {(made || q.quote_id) ? <T color={c.accent}>{made || "A quotation already exists for this query."}</T> : null}
      </>}
      <ReplyBox q={q} gates={gates} rfis={r?.a?.rfis || []} />
      {ask && <RequestPrices init={ask} onClose={() => setAsk(null)} />}
      {rfi && <RfiEditor init={rfi} onClose={() => setRfi(null)} />}
    </Sheet>
  );
}

/** Reply to the client: the owner picks what to say, the AI writes it, it goes into his Gmail as a draft (or opens in email). */
function ReplyBox({ q, gates, rfis }: { q: any; gates: any[]; rfis: string[] }) {
  const { d, profile, reload } = useData(); const c = useColors();
  const quote = (d.quotes || []).find((x: any) => x.id === q.quote_id);
  const missing = gates.filter((g: any) => g.s !== "good").flatMap((g: any) => g.d).slice(0, 8);
  const preset: Record<string, string> = {
    received: q.deadline ? `We will send the quotation by ${q.deadline}.` : "",
    missing: missing.map((x: string) => "- " + x).join("\n"),
    rfi: rfis.map((x, i) => `${i + 1}. ${x}`).join("\n"),
    quotation: quote?.rfq?.lock ? `Total before VAT ${money(quote.rfq.lock.total)} SAR, with 15% VAT ${money(quote.rfq.lock.total * 1.15)} SAR. Payment: ${quote.rfq.lock.terms?.payment || ""}. Valid ${quote.rfq.lock.terms?.validity_days || 15} days.` : "",
    decline: "", custom: "",
  };
  const [kind, setKind] = useState("received"), [details, setDetails] = useState(preset.received), [lang, setLang] = useState("en");
  const [m, setM] = useState<any>(null), [busy, setBusy] = useState(""), [msg, setMsg] = useState("");
  const sent = (d.email_outbox || []).filter((o: any) => o.inquiry_id === q.id);
  const gmailId = q.dedupe_key && !String(q.dedupe_key).startsWith("manual-") && !String(q.dedupe_key).includes("|") ? q.dedupe_key : null;
  const write = async () => {
    setBusy("write"); setMsg("");
    try { setM(await ai("query_reply", { inquiry_id: q.id, kind, details, lang, signature: `${profile.name}, Al-Swati Contracting` })); } catch (e: any) { setMsg(e.message); } finally { setBusy(""); }
  };
  const toDrafts = async () => {
    setBusy("draft"); setMsg("");
    const { error } = await supabase.from("email_outbox").insert({ inquiry_id: q.id, gmail_id: gmailId, to_email: q.from_email, subject: m.subject, body: m.body });
    setBusy(""); if (error) { setMsg(error.message); return; }
    // With Outlook linked, the server makes the draft right away; with the Gmail script, within 5 minutes.
    const ol = await supabase.functions.invoke("inbound-query", { body: { action: "outlook_pull" } }).then((r) => r.data?.linked).catch(() => false);
    await reload(["email_outbox"]); setM(null);
    setMsg(ol ? "Saved. It is in your Outlook Drafts" + (gmailId ? " as a reply in the same thread" : "") + " (if not yet, within 30 minutes). Open Outlook and press Send."
      : "Saved. Within 5 minutes it appears in your Gmail Drafts" + (gmailId ? " as a reply in the same thread." : ".") + " Open Gmail and press Send.");
  };
  return (
    <Card>
      <T bold>Reply to {q.from_name || q.from_email || "the client"}</T>
      <Row wrap>
        <Select label="What to say" value={kind} onChange={(v) => { setKind(v); setDetails(preset[v] || ""); setM(null); }} options={[
          { value: "received", label: "Received, we are pricing" }, { value: "missing", label: "Ask for missing documents" }, { value: "rfi", label: "Technical questions (RFI)" },
          { value: "quotation", label: "Send quotation" }, { value: "decline", label: "Decline politely" }, { value: "custom", label: "Something else" }]} />
        <Select label="Language" value={lang} onChange={setLang} options={[{ value: "en", label: "English" }, { value: "ar", label: "العربية" }]} style={{ maxWidth: 150 }} />
      </Row>
      {kind === "quotation" ? <T size={13} color={quote?.rfq?.lock ? c.muted : c.warn}>{quote?.rfq?.lock ? "Attach the quotation PDF (and technical proposal) to the draft in Gmail before you send." : "The quotation is not approved & locked yet: lock it first so the numbers are final."}</T> : null}
      <Field label="Details to include (the AI will not change these)" value={details} multiline onChange={setDetails} />
      <Btn kind="primary" icon={<Icon name="spark" color={c.accentInk} />} title={m ? "Write again" : "Write the reply"} busy={busy === "write"} onPress={write} />
      {m && <>
        <Field label="Subject" value={m.subject} onChange={(v) => setM({ ...m, subject: v })} />
        <Field label="Reply (change anything)" value={m.body} multiline onChange={(v) => setM({ ...m, body: v })} />
        <Row wrap>
          {q.from_email ? <Btn kind="primary" title="Put in my Gmail drafts" busy={busy === "draft"} onPress={toDrafts} /> : null}
          {q.from_email ? <Btn title="Open in email" onPress={() => Linking.openURL(`mailto:${q.from_email}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`)} /> : <T color={c.warn}>No client email on this query.</T>}
        </Row>
      </>}
      {msg ? <T size={13} color={/Saved/.test(msg) ? c.accent : c.bad}>{msg}</T> : null}
      {sent.map((o: any) => <T key={o.id} size={12} muted>{stamp(o.created_at)} · {o.subject} · {o.status === "Pending" ? "waiting for the Gmail script" : o.status === "Drafted" ? "in Gmail drafts" : `failed: ${o.error || ""}`}</T>)}
    </Card>
  );
}
