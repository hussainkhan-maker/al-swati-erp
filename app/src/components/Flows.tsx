// The shared flows every account uses: speak/type an entry → AI understands → code checks → you confirm.
// Also: purchase invoice with receipt, statements as checked PDFs, and the personal AI assistant.
import * as Speech from "expo-speech";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Check, entryChecks, purchaseChecks } from "../lib/checks";
import { active, companiesOf, pname, useData } from "../lib/data";
import { pickPhoto, uploadFile } from "../lib/files";
import { matchItems, money, num, r2, splitIncome, uid } from "../lib/fmt";
import { localAnswer, mentionedProject } from "../lib/localAnswer";
import { speechLang } from "../lib/i18n";
import { buildStatement, Doc, docHTML, makeAndShare, pdfChecks } from "../lib/pdf";
import { ai, supabase } from "../lib/supabase";
import { Btn, Card, Checks, Field, Icon, Photo, Pill, Row, Select, Sheet, T, Table, useColors } from "../ui";
import { Voice } from "./Voice";

type Open = (kind: "speak" | "purchase" | "statement" | "ask", init?: any) => void;
const FlowCtx = createContext<Open>(() => {});
export const useFlows = () => useContext(FlowCtx);

export function FlowProvider({ children }: { children: React.ReactNode }) {
  const [sheet, setSheet] = useState<{ kind: string; init?: any; key: string } | null>(null);
  const open: Open = (kind, init) => setSheet({ kind, init, key: uid() });
  const close = () => setSheet(null);
  return (
    <FlowCtx.Provider value={open}>
      {children}
      {sheet?.kind === "speak" && <SpeakSheet key={sheet.key} init={sheet.init} onClose={close} open={open} />}
      {sheet?.kind === "purchase" && <PurchaseSheet key={sheet.key} init={sheet.init} onClose={close} />}
      {sheet?.kind === "statement" && <StatementSheet key={sheet.key} init={sheet.init} onClose={close} />}
      {sheet?.kind === "ask" && <AskSheet key={sheet.key} init={sheet.init} onClose={close} />}
    </FlowCtx.Provider>
  );
}

const projOpts = (projects: any[]) => [{ value: "", label: "—" }, ...projects.filter((p) => p.status !== "closed").map((p) => ({ value: p.id, label: p.name }))];
const subNames = (d: any) => d.sub_names || (d.subcontractors || []).map((s: any) => s.name);
const METHODS = ["Cash", "Bank transfer", "Cheque", "STC Pay / card", "Other"];
const today = () => new Date().toISOString().slice(0, 10);
const LABEL: Record<string, [string, string, string]> = { income: ["Payment received", "دفعة مستلمة", "وصولی"], loan: ["Loan from company", "قرض من الشركة", "کمپنی سے قرض"], expense: ["Expense", "مصروف", "خرچہ"], subpay: ["Payment to subcontractor", "دفعة لمقاول", "سب کنٹریکٹر کو ادائیگی"], rate: ["Supplier rate", "سعر مورد", "سپلائر ریٹ"], progress: ["Work progress", "تقدم العمل", "کام کی پیشرفت"] };

// ───────────────────────── speak / type an entry ─────────────────────────
function SpeakSheet({ init, onClose, open }: { init?: any; onClose: () => void; open: Open }) {
  const { t, lang, d, role, insert, profile } = useData(); const c = useColors();
  const [text, setText] = useState(init?.text || "");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [o, setO] = useState<any>(null), [parsed, setParsed] = useState<any>(null), [mrn, setMrn] = useState<Doc | null>(null);
  const [tried, setTried] = useState(false); // problems are listed only after Save is pressed
  const L = (k: string) => (LABEL[k] || [k, k, k])[lang === "ar" ? 1 : lang === "ur" ? 2 : 0];
  const projects = d.projects || [];
  const hints = [...projects.map((p: any) => p.name), ...subNames(d)];

  const understand = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr(""); setO(null); setMrn(null);
    try {
      const a = await ai("parse", { text, lang, context: { projects: projects.map((p: any) => ({ id: p.id, name: p.name, company: p.company })), subcontractors: subNames(d), companies: companiesOf(d), today: new Date().toISOString().slice(0, 10) } });
      setParsed(a);
      if (a.heard && role !== "admin") Speech.speak(a.heard, { language: speechLang(lang) });
      if (a.intent === "purchase") { onClose(); setTimeout(() => open("purchase", { voice: a, text }), 350); return; }
      if (a.intent === "statement") { onClose(); setTimeout(() => open("statement", a.statement || {}), 350); return; }
      if (a.intent === "mrn") {
        const lines = a.lines || [];
        setMrn({ title: t("mrn") + " · " + pname(d, a.project_id), cols: [t("material"), t("qty"), t("unit")], rows: lines.map((l: any) => [l.name, Number(l.qty) || 0, l.unit || ""]), numCols: [1], sum: [[t("item"), String(lines.length)]], check: { col: 1, total: r2(lines.reduce((s: number, l: any) => s + (Number(l.qty) || 0), 0)) } });
        return;
      }
      if (!LABEL[a.intent] || (role === "supervisor" && !["progress", "expense"].includes(a.intent))) { setErr(t("notUnderstood")); return; }
      setO({ intent: a.intent, project_id: a.project_id || "", amount: a.amount ?? "", loan: a.loan ?? 0, sub_name: a.sub_name || "", material: a.lines?.[0]?.name || "", supplier: a.supplier || "", unit: a.lines?.[0]?.unit || "sqm", description: a.description || "", photo: null,
        rows: (a.progress || []).map((p: any) => ({ sub_name: p.sub_name, qty: p.qty, unit: p.unit || "sqm", work: p.work || "" })) });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  // Fill the form by hand, without the AI (also works when the AI is off). Picks up a number and a known name from the typed text.
  const kinds = role === "supervisor" ? ["progress", "expense"] : ["subpay", "income", "expense", "loan", "rate", "progress"];
  const byHand = (intent: string, pid?: string, subName?: string) => {
    const low = text.toLowerCase(), n = (text.match(/\d[\d,]*(\.\d+)?/) || [""])[0].replace(/,/g, "");
    const sub = subName || subNames(d).find((s: string) => s && low.includes(String(s).toLowerCase())) || "";
    const proj = pid || projects.find((p: any) => p.name && low.includes(String(p.name).toLowerCase()))?.id || (projects.length === 1 ? projects[0].id : "");
    setErr(""); setMrn(null); setParsed({ heard: text.trim() });
    // Work done: one line for every subcontractor on that project, so each one's m² is typed in one go.
    const onP = proj ? (d.subcontractors || []).filter((x: any) => (x.projects || []).includes(proj)).map((x: any) => x.name) : [];
    const rows = intent !== "progress" ? [] : onP.length > 1 && !subName ? onP.map((nm: string) => ({ sub_name: nm, qty: "", unit: "sqm", work: "" })) : [{ sub_name: sub || onP[0] || "", qty: n, unit: "sqm", work: "" }];
    setO({ intent, date: today(), method: "Cash", note: "", kindChosen: false, project_id: proj, amount: intent === "progress" ? "" : n, loan: 0, sub_name: sub, material: "", supplier: "", unit: "sqm", description: intent === "expense" ? text.trim() : "", photo: null, rows });
  };

  // Opened from a project's buttons: go straight to the right form with the project (and subcontractor) filled in.
  useEffect(() => { if (init?.intent) byHand(init.intent, init.project_id, init.sub_name); }, []);

  // Lines left empty (a subcontractor who did not work that day) are skipped.
  const form = o ? { ...o, amount: num(o.amount), loan: num(o.loan || 0), rows: (o.rows || []).filter((r: any) => String(r.qty ?? "").trim() !== "").map((r: any) => ({ ...r, qty: num(r.qty) })) } : null;
  const checks: Check[] = form ? entryChecks(t, form, { projects, txns: d.txns || [], subs: subNames(d), ledger: d.project_ledger || [], raw: text }) : [];
  const blocked = checks.some((x) => x.s === "bad");
  const P = form ? projects.find((p: any) => p.id === form.project_id) : null;
  const sp = form?.intent === "income" && P && form.amount > 0 ? splitIncome(form.amount, Number(P.fee_pct), form.loan) : null;
  const set = (k: string, v: any) => setO((x: any) => ({ ...x, [k]: v }));
  const setRow = (i: number, k: string, v: any) => setO((x: any) => ({ ...x, rows: x.rows.map((r: any, j: number) => (j === i ? { ...r, [k]: v } : r)) }));

  // Date and how it was paid. If the database does not have these columns yet, they are kept in the note instead.
  const when = (form?.date || today()), how = form?.method || "Cash", memo = String(form?.note || "").trim() || null;
  const ins = async (table: string, row: any, file?: any) => {
    try { return await insert(table, row, file); }
    catch (e: any) {
      if (!/paid_on|method|work_date/.test(String(e.message))) throw e;
      const { paid_on, method, work_date, ...rest } = row;
      const note = [method, paid_on || work_date].filter(Boolean).join(" · ");
      if (table === "progress") rest.work = [rest.work, note].filter(Boolean).join(" · "); else rest.description = [rest.description, note].filter(Boolean).join(" · ");
      return await insert(table, rest, file);
    }
  };

  const save = async () => {
    if (!form || blocked) return; // the red lines above say what is missing
    setBusy(true); setErr("");
    const flags = checks.filter((x) => x.s === "warn").map((x) => x.text);
    try {
      let queued = false;
      const q = (r: any) => { if (r.queued) queued = true; };
      if (form.intent === "progress") for (const r of form.rows) q(await ins("progress", { project_id: form.project_id, sub_name: r.sub_name, qty: r.qty, unit: r.unit, work: r.work, work_date: when, heard: text, flags }));
      else if (form.intent === "income") q(await ins("txns", { type: "income", project_id: form.project_id, gross: form.amount, loan: form.loan || 0, paid_on: when, method: how, description: [form.relRet ? "Retention release" : null, memo].filter(Boolean).join(" · ") || null, heard: text, flags }));
      else if (form.intent === "loan") q(await ins("txns", { type: "loan", project_id: form.project_id, amount: form.amount, paid_on: when, method: how, description: memo, heard: text, flags }));
      else if (form.intent === "subpay") q(await ins("txns", { type: "subpay", project_id: form.project_id, amount: form.amount, sub_name: form.sub_name, paid_on: when, method: how, description: memo, heard: text, flags }));
      else if (form.intent === "expense") q(await ins("txns", { type: "expense", project_id: form.project_id, amount: form.amount, description: [form.description, memo].filter(Boolean).join(" · "), paid_on: when, method: how, heard: text, flags }));
      else if (form.intent === "rate") {
        let itemId = matchItems(form.material, d.items || []).find((m) => m.score >= 0.75)?.item.id;
        if (!itemId) { const { data, error } = await supabase.from("items").insert({ name: form.material, unit: form.unit }).select().single(); if (error) throw error; itemId = data.id; }
        q(await insert("prices", { item_id: itemId, price: form.amount, kind: "cost", source: "abu", supplier: form.supplier }));
      }
      Speech.stop();
      setErr(queued ? t("queued") : ""); if (!queued) onClose();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Sheet open onClose={onClose} title={o ? L(o.intent) : t("speak")}>
      {!o && !mrn && <>
        <Voice value={text} onChange={setText} hints={hints} />
        <Btn big kind="primary" title={t("understand")} onPress={understand} busy={busy} disabled={!text.trim()} />
        <T muted size={14}>{t("byHand")}</T>
        <Row wrap>{kinds.map((k) => <Btn key={k} title={L(k)} onPress={() => byHand(k)} />)}</Row>
      </>}
      {err ? <Card style={{ backgroundColor: c.warnSoft, borderColor: c.warnSoft }}><T color={c.warn}>{err}</T></Card> : null}

      {mrn && (() => { const html = docHTML(mrn, lang, profile.name), ch = pdfChecks(t, mrn, html); return <>
        <T size={17}>{parsed?.heard}</T><Checks title={t("checks")} list={ch} /><Table cols={mrn.cols} rows={mrn.rows} numeric={[1]} />
        <Btn big kind="primary" icon={<Icon name="share" color={c.accentInk} />} title={t("pdf")} disabled={ch.some((x) => x.s === "bad")} onPress={() => makeAndShare(mrn, html)} />
        <Btn title={t("no")} onPress={() => setMrn(null)} />
      </>; })()}

      {o && <Card>
        {parsed?.heard ? <Row wrap><T size={16} style={{ flex: 1 }}>“{parsed.heard}”</T><Btn kind="ghost" title={t("readBack")} onPress={() => Speech.speak(parsed.heard, { language: speechLang(lang) })} /></Row> : null}
        {o.intent === "expense" && <Select label="Type of expense *" value="small" options={[{ value: "small", label: "Small expense (no photo): transport, food, tools…" }, { value: "material", label: "Material purchase (invoice photo; AI reads items, VAT, invoice no.)" }]}
          onChange={(v) => { if (v === "material") { const pid = o.project_id; onClose(); setTimeout(() => open("purchase", { voice: { project_id: pid } }), 350); } }} />}
        {(parsed?.questions || []).filter(Boolean).map((qq: string, i: number) => <Card key={i} style={{ backgroundColor: c.warnSoft, borderColor: c.warnSoft }}><T color={c.warn}>{t("question")}: {qq}</T></Card>)}
        <Select label={t("project") + " *"} value={o.project_id} options={projOpts(projects)} onChange={(v) => set("project_id", v)} />
        {o.intent !== "rate" && <Row wrap>
          <Field label={o.intent === "progress" ? "Date of work (YYYY-MM-DD)" : "Date paid (YYYY-MM-DD)"} value={o.date ?? today()} onChange={(v) => set("date", v)} style={{ maxWidth: 220 }} />
          {o.intent !== "progress" && <Select label="Paid by" value={o.method || "Cash"} options={METHODS.map((m) => ({ value: m, label: m }))} onChange={(v) => set("method", v)} />}
        </Row>}
        {o.intent !== "rate" && o.intent !== "progress" && <Field label="Note (for your memory, optional)" value={o.note || ""} onChange={(v) => set("note", v)} placeholder="e.g. 2nd payment for ground floor, cheque no. 1452" />}
        {o.intent === "progress" ? o.rows.map((r: any, i: number) => (
          <Row key={i} wrap>
            <Field label={t("sub")} value={r.sub_name} onChange={(v) => setRow(i, "sub_name", v)} />
            <Field label={t("qty")} value={r.qty} numeric onChange={(v) => setRow(i, "qty", v)} style={{ maxWidth: 110 }} />
            <Field label={t("unit")} value={r.unit} onChange={(v) => setRow(i, "unit", v)} style={{ maxWidth: 90 }} />
            <Field label={t("work")} value={r.work} onChange={(v) => setRow(i, "work", v)} />
          </Row>)).concat([<Btn key="add" kind="ghost" icon={<Icon name="plus" />} title="Add another subcontractor line" onPress={() => set("rows", [...o.rows, { sub_name: "", qty: "", unit: "sqm", work: "" }])} />,
            <T key="sum" bold>Total today: {money((form?.rows || []).reduce((s2: number, r: any) => s2 + (r.qty || 0), 0))} m²</T>]) : <>
          <Field required label={t("amount")} value={o.amount} numeric onChange={(v) => set("amount", v)} />
          {o.intent === "income" && <Field label={t("loanDeduct")} value={o.loan} numeric onChange={(v) => set("loan", v)} />}
          {o.intent === "income" && (() => { const ret = Number((((d.preferences || []).find((q: any) => q.key === "project_terms")?.value || {})[o.project_id] || {}).retention) || 0; return <>
            <Btn kind={o.relRet ? "primary" : "default"} title={(o.relRet ? "✓ " : "") + "This payment is the retention being released"} onPress={() => set("relRet", !o.relRet)} />
            {ret > 0 && !o.relRet && num(o.amount) > 0 && <T muted size={13}>Retention {ret}%: the client keeps about {money(r2(num(o.amount) / 1.15 / (1 - ret / 100) * ret / 100))} SAR more on this payment (shown in the project's client account).</T>}
          </>; })()}
          {o.intent === "subpay" && (() => { const onP = (d.subcontractors || []).filter((x: any) => (x.projects || []).includes(o.project_id)).map((x: any) => x.name), names = onP.length ? [...onP, ...subNames(d).filter((n: string) => !onP.includes(n))] : subNames(d);
            return <Select label={t("sub")} value={o.sub_name} options={names.map((n: string) => ({ value: n, label: onP.includes(n) ? n + " ✓" : n }))} onChange={(v) => set("sub_name", v)} />; })()}
          {o.intent === "rate" && <Row wrap><Field label={t("material")} value={o.material} onChange={(v) => set("material", v)} /><Field label={t("unit")} value={o.unit} onChange={(v) => set("unit", v)} style={{ maxWidth: 100 }} /><Field label={t("supplier")} value={o.supplier} onChange={(v) => set("supplier", v)} /></Row>}
          {o.intent === "expense" && <Field label="What was it for (transport, food, small tools…)" value={o.description} onChange={(v) => set("description", v)} />}
        </>}
        {sp && <Table cols={["", "SAR"]} numeric={[1]} rows={[[t("received") + " · " + (P.company || ""), money(sp.gross)], ["VAT 15%", "−" + money(sp.vat)], [`${t("fee")} ${P.fee_pct}% · ${money(sp.base)}`, "−" + money(sp.fee)], [t("loanDeduct"), "−" + money(sp.loan)], [t("inHand"), money(sp.net)]]} />}
        {tried || checks.some((x) => x.s === "warn") ? <Checks list={tried ? checks : checks.filter((x) => x.s === "warn")} /> : null}
        <Row wrap>
          <Btn big kind="primary" icon={<Icon name="check" color={c.accentInk} />} title={t("save")} onPress={() => { setTried(true); save(); }} busy={busy} />
          <Btn big kind="ghost" title={t("no")} onPress={() => { setO(null); setTried(false); Speech.stop(); }} />
        </Row>
      </Card>}
    </Sheet>
  );
}

// ───────────────────────── purchase invoice / expense with receipt ─────────────────────────
function PurchaseSheet({ init, onClose }: { init?: any; onClose: () => void }) {
  const { t, d, role, insert, profile, online } = useData(); const c = useColors();
  const v = init?.voice || {};
  const projects = role === "supervisor" ? (d.projects || []) : (d.projects || []);
  const [photo, setPhoto] = useState<string | null>(null), [path, setPath] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [reading, setReading] = useState(false), [note, setNote] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [f, setF] = useState<any>({
    supplier: v.supplier || "", subtotal: "", vat: v.vat_amount ?? "", total: v.amount ?? "", company: v.vat_company || "",
    lines: (v.lines || []).map((l: any) => ({ name: l.name, qty: l.qty ?? "", unit: l.unit || "", price: l.price ?? "" })),
    split: (v.split?.length ? v.split : [{ project_id: v.project_id || "", pct: 100 }]).concat([{ project_id: "", pct: "" }, { project_id: "", pct: "" }]).slice(0, 3),
    splitOn: (v.split?.length || 0) > 1, otherCo: "", inv: v.invoice_no || "",
  });
  const set = (k: string, val: any) => setF((x: any) => ({ ...x, [k]: val }));

  const takePhoto = async (cam: boolean) => {
    const u = await pickPhoto(cam); if (!u) return;
    setPhoto(u); setPath(null); setNote("");
    if (!online) return;
    setReading(true);
    try {
      const p = `${profile.id}/${uid()}.jpg`; await uploadFile("receipts", p, u); setPath(p);
      const r = await ai("receipt", { path: p });
      setNote(`${r.confidence || ""} ${r.notes || ""}`.trim());
      setF((x: any) => ({ ...x, supplier: r.supplier || x.supplier, subtotal: r.subtotal ?? x.subtotal, vat: r.vat ?? x.vat, total: r.total ?? x.total, inv: r.invoice_no || x.inv,
        company: r.buyer && companiesOf(d).find((n) => String(r.buyer).toLowerCase().includes(n.toLowerCase())) || x.company,
        lines: (r.lines || []).map((l: any) => ({ name: l.name, qty: l.qty ?? "", unit: l.unit || "", price: l.price ?? "" })) }));
    } catch (e: any) { setNote(e.message); } finally { setReading(false); }
  };

  const x = useMemo(() => {
    const lines = f.lines.filter((l: any) => l.name).map((l: any) => ({ name: l.name, qty: num(l.qty), unit: l.unit, price: num(l.price), total: r2(num(l.qty) * num(l.price)) }));
    // Most invoices go to one project (100%); splitting is only when the purchase is shared.
    const split = !f.splitOn ? (f.split[0]?.project_id ? [{ project_id: f.split[0].project_id, pct: 100 }] : [])
      : f.split.filter((s: any) => s.project_id && num(s.pct) > 0).map((s: any) => ({ project_id: s.project_id, pct: num(s.pct) }));
    const company = f.company === "__other" ? String(f.otherCo || "").trim() : f.company;
    return { photo: !!photo, supplier: f.supplier, lines, subtotal: num(f.subtotal), vat: num(f.vat || 0) || 0, total: num(f.total), split, company };
  }, [f, photo]);
  const checks = purchaseChecks(t, x, { txns: d.txns || [], pname: (id) => pname(d, id) });
  const blocked = checks.some((k) => k.s === "bad");

  const save = async () => {
    if (blocked) return; setBusy(true); setErr("");
    try {
      const isExpense = !x.lines.length && role === "supervisor" && !(x.vat > 0);
      const row = isExpense
        ? { type: "expense", project_id: x.split[0].project_id, split: x.split, amount: x.total, description: x.supplier, heard: init?.text || null, flags: checks.filter((k) => k.s === "warn").map((k) => k.text) }
        : { type: "purchase", supplier: x.supplier, lines: x.lines, subtotal: Number.isFinite(x.subtotal) ? x.subtotal : r2(x.total - x.vat), vat_amount: x.vat, vat_company: x.vat > 0 ? x.company : null, total: x.total, split: x.split, project_id: x.split[0].project_id, heard: init?.text || null, flags: checks.filter((k) => k.s === "warn").map((k) => k.text) };
      const inv = String(f.inv || "").trim();
      const full: any = inv ? { ...row, invoice_no: inv } : row;
      const put = (rw: any) => path ? insert("txns", { ...rw, receipt_path: path }) : insert("txns", rw, { bucket: "receipts", uri: photo!, field: "receipt_path", path: `${profile.id}/${uid()}.jpg` });
      // Until the database has the invoice-number column, the number is kept in the note.
      const r = await put(full).catch((e: any) => { if (!/invoice_no/.test(String(e.message))) throw e; return put({ ...row, description: [row.description, "Invoice " + inv].filter(Boolean).join(" · ") }); });
      if (r.queued) setErr(t("queued")); else onClose();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const companies = [{ value: "", label: t("noVat") }, ...companiesOf(d).map((n) => ({ value: n, label: n })), { value: "__other", label: t("otherCompany") }];

  return (
    <Sheet open onClose={onClose} title={t("purchase")}>
      {v.heard ? <T size={17} muted>{v.heard}</T> : null}
      <Card>
        <T bold>{t("photo")}</T>
        <Row wrap>
          <Btn big kind="primary" icon={<Icon name="camera" color={c.accentInk} />} title={t("takePhoto")} onPress={() => takePhoto(true)} style={{ flex: 1 }} />
          <Btn big title={t("choosePhoto")} onPress={() => takePhoto(false)} style={{ flex: 1 }} />
        </Row>
        {photo ? <Row>{path ? <Photo path={path} size={56} /> : <Pill kind="good" text="✓" />}<T muted style={{ flex: 1 }}>{reading ? t("reading") : note}</T></Row> : null}
      </Card>
      <Card>
        <Row wrap>
          <Field label={t("supplier")} value={f.supplier} onChange={(val) => set("supplier", val)} />
          <Field label="Invoice number" value={f.inv} onChange={(val) => set("inv", val)} style={{ maxWidth: 200 }} />
        </Row>
        {(x.vat > 0 || f.inv) && <Row wrap>
          {f.inv ? <Pill kind="acc" text={"Invoice " + f.inv} /> : null}
          {x.vat > 0 ? <Pill kind="good" text={`VAT ${money(x.vat)} SAR → ${x.company || "choose company"}`} /> : null}
        </Row>}
        {f.lines.map((l: any, i: number) => (
          <Row key={i} wrap>
            <Field label={t("item")} value={l.name} onChange={(val) => set("lines", f.lines.map((y: any, j: number) => (j === i ? { ...y, name: val } : y)))} />
            <Field label={t("qty")} value={l.qty} numeric onChange={(val) => set("lines", f.lines.map((y: any, j: number) => (j === i ? { ...y, qty: val } : y)))} style={{ maxWidth: 100 }} />
            <Field label={t("unit")} value={l.unit} onChange={(val) => set("lines", f.lines.map((y: any, j: number) => (j === i ? { ...y, unit: val } : y)))} style={{ maxWidth: 90 }} />
            <Field label={t("rate")} value={l.price} numeric onChange={(val) => set("lines", f.lines.map((y: any, j: number) => (j === i ? { ...y, price: val } : y)))} style={{ maxWidth: 110 }} />
          </Row>))}
        <Btn kind="ghost" icon={<Icon name="plus" />} title={t("addLine")} onPress={() => set("lines", [...f.lines, { name: "", qty: "", unit: "", price: "" }])} />
        <Row wrap>
          <Field label={t("beforeVat")} value={f.subtotal} numeric onChange={(val) => set("subtotal", val)} />
          <Field label={t("vat")} value={f.vat} numeric onChange={(val) => set("vat", val)} />
          <Field label={t("total")} value={f.total} numeric onChange={(val) => set("total", val)} />
        </Row>
      </Card>
      <Card>
        <T bold>{t("project")}</T>
        {(f.splitOn ? f.split : f.split.slice(0, 1)).map((s: any, i: number) => (
          <Row key={i}>
            <Select value={s.project_id} options={projOpts(projects)} onChange={(val) => set("split", f.split.map((y: any, j: number) => (j === i ? { ...y, project_id: val } : y)))} />
            {f.splitOn && <Field value={s.pct} numeric placeholder="%" onChange={(val) => set("split", f.split.map((y: any, j: number) => (j === i ? { ...y, pct: val } : y)))} style={{ maxWidth: 90, minWidth: 80 }} />}
          </Row>))}
        <Btn kind="ghost" title={f.splitOn ? t("noSplit") : t("split")} onPress={() => set("splitOn", !f.splitOn)} />
        {x.vat > 0 && <Select label={t("company")} value={f.company} options={companies} onChange={(val) => set("company", val)} />}
        {x.vat > 0 && f.company === "__other" && <Field label={t("companyName")} value={f.otherCo} onChange={(val) => set("otherCo", val)} />}
      </Card>
      {tried || checks.some((k) => k.s === "warn") ? <Checks list={tried ? checks : checks.filter((k) => k.s === "warn")} /> : null}
      {err ? <T color={c.warn}>{err}</T> : null}
      <Btn big kind="primary" icon={<Icon name="check" color={c.accentInk} />} title={t("save")} onPress={() => { setTried(true); save(); }} busy={busy} disabled={reading} />
    </Sheet>
  );
}

// ───────────────────────── statements → checked PDF → share ─────────────────────────
function StatementSheet({ init, onClose }: { init?: any; onClose: () => void }) {
  const { t, d, role, lang, profile } = useData(); const c = useColors();
  const kinds = role === "supervisor" ? ["project", "sub"] : role === "engineer" ? ["project"] : ["project", "received", "sub", "expenses", "purchases", "supplier", "material", "vat"];
  const KL: Record<string, string> = { project: "Whole project", received: "Payments I received (dates)", sub: "Subcontractor (money + m²)", expenses: "Small expenses only", purchases: "Material purchases (VAT, invoice)", supplier: t("supplier"), material: t("material"), vat: t("vat") };
  const [kind, setKind] = useState(kinds.includes(init?.kind) ? init.kind : "project");
  const [target, setTarget] = useState(init?.target || "");
  const [pid, setPid] = useState(init?.project_id || "");
  const [busy, setBusy] = useState(false);
  const noName = ["vat", "expenses", "purchases", "received"].includes(kind);
  const doc = useMemo(() => (noName || target ? buildStatement(d, role, lang, kind, target, kind === "project" ? "" : pid) : null), [kind, target, pid, d]);
  const html = doc ? docHTML(doc, lang, profile.name) : "";
  const checks = doc ? pdfChecks(t, doc, html) : [];
  const chips = kind === "project" ? (d.projects || []).map((p: any) => p.name) : kind === "sub" ? subNames(d) : kind === "supplier" ? [...new Set(active(d.txns).filter((x: any) => x.supplier).map((x: any) => x.supplier))] : kind === "material" ? (d.items || []).map((i: any) => i.name) : [];
  return (
    <Sheet open onClose={onClose} title={t("statement")}>
      <Select label={t("kind")} value={kind} options={kinds.map((k) => ({ value: k, label: KL[k] }))} onChange={(v) => { setKind(v); setTarget(""); }} />
      {["sub", "expenses", "purchases", "received"].includes(kind) && <Select label="Project" value={pid} options={[{ value: "", label: "All projects" }, ...(d.projects || []).map((p: any) => ({ value: p.id, label: p.name }))]} onChange={setPid} />}
      {!noName && <Field label={t("name")} value={target} onChange={setTarget} />}
      {!noName && <Row wrap>{(chips as string[]).slice(0, 12).map((n) => <Btn key={n} title={n} kind={n === target ? "primary" : "default"} onPress={() => setTarget(n)} />)}</Row>}
      {doc ? <>
        <Checks title={t("checks")} list={checks} />
        <Table cols={doc.cols} rows={doc.rows.map((r) => r.map((v, i) => (doc.numCols.includes(i) ? money(v) : v)))} numeric={doc.numCols} />
        <Card>{doc.sum.map(([k, v], i) => <Row key={i}><T style={{ flex: 1 }}>{k}</T><T bold>{v}</T></Row>)}</Card>
        <Btn big kind="primary" icon={<Icon name="share" color={c.accentInk} />} title={t("pdf")} busy={busy} disabled={checks.some((x) => x.s === "bad")}
          onPress={async () => { setBusy(true); try { await makeAndShare(doc, html); } finally { setBusy(false); } }} />
      </> : target ? <T muted>{t("nothing")}</T> : null}
    </Sheet>
  );
}

// ───────────────────────── personal AI assistant (every account) ─────────────────────────
// Opened from the AI button on every page: it knows which page you are on, and checks entries for mistakes.
function AskSheet({ init, onClose }: { init?: any; onClose: () => void }) {
  const { t, d, role, lang } = useData(); const c = useColors();
  const [q, setQ] = useState(""), [a, setA] = useState(""), [busy, setBusy] = useState(false), [free, setFree] = useState(false);
  const page = init?.page || "";
  const W = (en: string, ar: string, ur: string) => (lang === "ar" ? ar : lang === "ur" ? ur : en);
  const quick = page ? [W("What do I do on this page, step by step?", "ماذا أفعل في هذه الصفحة خطوة بخطوة؟", "اس صفحے پر قدم بہ قدم کیا کروں؟"),
    W("Check my latest entries for mistakes and tell me what to correct", "راجع آخر إدخالاتي وقل لي ما الذي يجب تصحيحه", "میری تازہ اینٹریاں چیک کرو، کیا غلط ہے اور کیسے ٹھیک کروں"),
    W("What should I do next?", "ما الخطوة التالية؟", "اب اگلا کام کیا ہے؟")] : [];
  const ask = async (asked?: string) => {
    const qq = (asked ?? q).trim(); if (!qq) return; if (asked) setQ(asked); setBusy(true); setA(""); setFree(false);
    // 1) Token saver: simple money / m² questions are answered from the app's own numbers, with no AI call.
    if (!quick.includes(qq)) {
      const local = localAnswer(d, qq, lang);
      if (local) { setA(local.text); setFree(true); setBusy(false); if (role !== "admin") Speech.speak(local.text, { language: speechLang(lang) }); return; }
    }
    // 2) Otherwise send the AI only what the question needs (one project's entries, not everything).
    const pr = mentionedProject(d, qq), inP = (x: any) => !pr || x.project_id === pr.id || (x.split || []).some((s: any) => s.project_id === pr.id);
    const about = (re: RegExp) => re.test(qq.toLowerCase()) || re.test(page.toLowerCase());
    const data: any = { projects: (d.projects || []).filter((p: any) => !pr || p.id === pr.id).map((p: any) => ({ id: p.id, name: p.name, company: p.company, fee_pct: p.fee_pct })) };
    if (d.project_ledger) data.ledger = (d.project_ledger as any[]).filter((l) => !pr || l.project_id === pr.id);
    if (d.sub_ledger) data.subcontractors = d.sub_ledger;
    data.progress = active(d.progress).filter(inP).slice(0, pr ? 150 : 80).map((p: any) => ({ date: p.created_at?.slice(0, 10), project: pname(d, p.project_id), sub: p.sub_name, qty: p.qty, unit: p.unit, work: p.work }));
    if (d.txns) data.entries = active(d.txns).filter(inP).slice(0, pr ? 150 : 80).map((x: any) => ({ date: x.created_at?.slice(0, 10), type: x.type, project: pname(d, x.project_id), amount: x.amount ?? x.total ?? x.gross, net: x.net, supplier: x.supplier, sub: x.sub_name, vat: x.vat_amount, vat_company: x.vat_company }));
    if (d.vat_by_company && about(/vat|ضريب|tax|ٹیکس/)) data.vat_by_company = d.vat_by_company;
    if (d.quotes && about(/quot|عرض|کوٹیشن|price|rate|ریٹ|سعر/)) data.quotes = d.quotes.slice(0, 15).map((x: any) => ({ title: x.title, status: x.status, lines: (x.lines || []).slice(0, 30).map((l: any) => ({ desc: l.desc, qty: l.qty, unit: l.unit, rate: l.rate })) }));
    if (d.documents && about(/doc|drawing|مخطط|ڈرائنگ|submittal/)) data.documents = d.documents.slice(0, 60).map((x: any) => ({ project: pname(d, x.project_id), no: x.doc_no, rev: x.rev, state: x.state, date: x.created_at?.slice(0, 10) }));
    if (d.inquiries && about(/quer|rfq|enquir|inquir|استفسار|کوئری|client/)) data.queries = d.inquiries.slice(0, 40).map((x: any) => ({ ref: x.ref, subject: x.subject, status: x.status, deadline: x.deadline }));
    if (d.supplier_requests && about(/supplier|مورد|سپلائر/)) data.supplier_requests = d.supplier_requests.slice(0, 40).map((x: any) => ({ supplier: (d.suppliers || []).find((s: any) => s.id === x.supplier_id)?.name, status: x.status, sent: x.sent_at }));
    const question = page ? `[The person is on the "${page}" page of the app. Explain how to use that page, point out entries that look wrong (missing project, wrong amount, VAT, duplicate, unknown subcontractor) and say exactly how to correct them.] ${qq}` : qq;
    try { const r = await ai("ask", { question, data }); setA(r.text); if (role !== "admin") Speech.speak(r.text, { language: speechLang(lang) }); }
    catch (e: any) { setA(/401|ANTHROPIC|api key/i.test(e.message) ? W("The AI is not switched on yet. Super-Admin adds the ANTHROPIC_API_KEY in Supabase → Edge Functions → Secrets.", "الذكاء الاصطناعي غير مفعّل بعد. يضيف المدير مفتاح ANTHROPIC_API_KEY في Supabase.", "AI ابھی چالو نہیں۔ Super-Admin کو Supabase → Edge Functions → Secrets میں ANTHROPIC_API_KEY ڈالنی ہے۔") : e.message); } finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={() => { Speech.stop(); onClose(); }} title={(lang === "ar" ? "مساعدك" : lang === "ur" ? "آپ کا مددگار" : "Your assistant") + (page ? " · " + page : "")}>
      {quick.length ? <View style={{ gap: 8 }}>{quick.map((x) => <Btn key={x} title={x} onPress={() => ask(x)} disabled={busy} />)}</View> : null}
      <Voice value={q} onChange={setQ} placeholder={lang === "en" ? "How much has Uzair done on Malqa, and what do we owe him?" : ""} />
      <Btn big kind="primary" icon={<Icon name="spark" color={c.accentInk} />} title={lang === "ar" ? "اسأل" : lang === "ur" ? "پوچھیں" : "Ask"} onPress={() => ask()} busy={busy} disabled={!q.trim()} />
      {a ? <Card style={{ backgroundColor: c.accentSoft, borderColor: c.accentSoft }}><T size={17}>{a}</T>{free ? <T size={12} muted>{lang === "ar" ? "من أرقامك مباشرة — بدون ذكاء اصطناعي" : lang === "ur" ? "سیدھا آپ کے حساب سے — AI استعمال نہیں ہوا" : "Straight from your numbers — no AI used"}</T> : null}</Card> : null}
    </Sheet>
  );
}
