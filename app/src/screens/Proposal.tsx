// Technical proposal for a bid: the AI drafts the sections from the quotation, the tender specs and the company profile;
// the owner checks and edits every section, then makes the PDF. Prices are never in it (they are in the quotation).
import React, { useState } from "react";
import { Platform, View } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { COMPANY } from "../config";
import { useData } from "../lib/data";
import { day, money } from "../lib/fmt";
import { ai, supabase } from "../lib/supabase";
import { Btn, Card, Field, H2, Icon, Pill, Row, Select, Sheet, T, useColors } from "../ui";

const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
/** Small markdown → HTML: ## / ### headings, - bullets, **bold**, paragraphs. */
const mdHtml = (md: string) => String(md || "").replace(/\r/g, "").split(/\n{2,}/).map((b) => {
  const t = b.trim(); if (!t) return "";
  const inl = (x: string) => esc(x).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const h = t.match(/^#{2,4}\s+(.*)$/); if (h) return `<h3>${inl(h[1])}</h3>`;
  if (/^\|.*\|\s*$/m.test(t.split("\n")[0])) { // markdown table
    const rows = t.split("\n").filter((l) => /^\|/.test(l.trim()) && !/^\|[\s:|-]+\|?\s*$/.test(l.trim())).map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
    return `<table>${rows.map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${inl(c)}</th>` : `<td>${inl(c)}</td>`)).join("")}</tr>`).join("")}</table>`;
  }
  if (/^[-*•]\s/m.test(t)) return `<ul>${t.split("\n").map((l) => `<li>${inl(l.replace(/^[-*•]\s*/, ""))}</li>`).join("")}</ul>`;
  return `<p>${inl(t).replace(/\n/g, "<br>")}</p>`;
}).join("");

export function proposalHTML(q: any, p: any, profile: any, lang: string) {
  const dir = lang === "ar" ? "rtl" : "ltr";
  const logo = COMPANY.logoDataUri ? `<img src="${COMPANY.logoDataUri}" style="height:56px">` : "";
  const contact = [profile.phone, profile.email, profile.website].filter(Boolean).join(" · ");
  return `<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><style>
  body{font-family:-apple-system,Roboto,"Noto Sans Arabic","Noto Naskh Arabic",Arial,sans-serif;color:#18211E;margin:36px;font-size:12.5px;line-height:1.55}
  h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;color:#0E6B5C;border-bottom:1px solid #D6DCD7;padding-bottom:4px;margin-top:22px;page-break-after:avoid}
  h3{font-size:13.5px;margin:14px 0 4px}ul{margin:4px 0 8px;padding-${dir === "rtl" ? "right" : "left"}:20px}li{margin:2px 0}
  table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:5px 8px;text-align:${dir === "rtl" ? "right" : "left"}}th{background:#EEF1EF}
  .cover{border:2px solid #0E6B5C;border-radius:10px;padding:22px;margin-bottom:18px}.muted{color:#4F5C57}
  section{page-break-inside:auto}</style></head><body>
  <div class="cover"><div style="display:flex;justify-content:space-between;align-items:center"><div>
    <div class="muted">${esc(lang === "ar" ? "العرض الفني" : "Technical Proposal")}</div><h1>${esc(q.title)}</h1>
    <div>${esc(q.client || "")}</div></div>${logo}</div>
    <div style="margin-top:12px"><b>${esc(profile.name || COMPANY.name)}</b>${lang === "ar" ? " · " + esc(COMPANY.nameAr) : ""}<br><span class="muted">${esc(profile.services || "")}${contact ? "<br>" + esc(contact) : ""}<br>${esc(COMPANY.details.startsWith("[") ? "" : COMPANY.details)}</span></div>
    <div class="muted" style="margin-top:8px">${esc(day(Date.now()))}${q.rfq?.ref ? " · " + esc(q.rfq.ref) : ""}</div></div>
  <h2>${esc(lang === "ar" ? "نطاق العمل" : "Scope of works")}</h2>
  <table><tr><th>#</th><th>${lang === "ar" ? "البند" : "Item"}</th><th>${lang === "ar" ? "الكمية" : "Qty"}</th><th>${lang === "ar" ? "الوحدة" : "Unit"}</th></tr>
  ${(q.lines || []).map((l: any, i: number) => `<tr><td>${i + 1}</td><td>${esc(l.desc)}</td><td>${esc(money(l.qty))}</td><td>${esc(l.unit)}</td></tr>`).join("")}</table>
  ${(p.sections || []).map((s: any) => `<section><h2>${esc(s.title)}</h2>${mdHtml(s.body)}</section>`).join("")}
  <div class="muted" style="margin-top:28px;font-size:10px">${esc(profile.name || COMPANY.name)} · AL-Swati ERP</div></body></html>`;
}

const FIXING = ["As per specification", "Mechanical dry-fix (stainless steel anchors)", "Ventilated facade on aluminium sub-frame", "Wet fix (adhesive / mortar)", "Mixed: dry-fix facade, wet-fix floors"];
const ORIGIN = ["As per specification", "Local (Riyadh stone, Saudi granite)", "Imported (Italy / Spain / Turkey / Egypt / India / China)", "Mixed local and imported"];

export function ProposalSheet({ q, onClose }: { q: any; onClose: () => void }) {
  const { d, reload } = useData(); const c = useColors();
  const profile = { name: COMPANY.name, ...((d.preferences || []).find((x: any) => x.key === "company_profile")?.value || {}) };
  const saved = q.rfq?.proposal;
  const [opt, setOpt] = useState<any>(saved?.opt || { fixing: FIXING[0], origin: ORIGIN[0], start: "On award", team: "", notes: "", lang: "en" });
  const [p, setP] = useState<any>(saved?.p || null), [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const save = async (np: any) => {
    const { error } = await supabase.from("quotes").update({ rfq: { ...(q.rfq || {}), proposal: { opt, p: np, at: new Date().toISOString() } } }).eq("id", q.id);
    if (error) throw new Error(error.message);
    await reload(["quotes"]);
  };
  const write = async () => {
    setBusy("write"); setErr("");
    try { const r = await ai("tech_proposal", { quote_id: q.id, ...opt }); setP(r); await save(r); } catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  };
  const pdf = async () => {
    setBusy("pdf"); setErr("");
    try {
      await save(p);
      const html = proposalHTML(q, p, profile, opt.lang);
      if (Platform.OS === "web") await Print.printAsync({ html });
      else { const { uri } = await Print.printToFileAsync({ html }); if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "Technical proposal" }); }
    } catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  };
  return (
    <Sheet open onClose={onClose} title={`Technical proposal · ${q.title}`}>
      <T size={13} muted>The AI writes the method statement, materials, programme, quality and safety sections from this quotation, the tender specs and your company profile. Read every section before sending.</T>
      <Row wrap>
        <Select label="Fixing method" value={opt.fixing} options={FIXING.map((x) => ({ value: x, label: x }))} onChange={(v) => setOpt({ ...opt, fixing: v })} />
        <Select label="Stone origin" value={opt.origin} options={ORIGIN.map((x) => ({ value: x, label: x }))} onChange={(v) => setOpt({ ...opt, origin: v })} />
      </Row>
      <Row wrap>
        <Field label="Start" value={opt.start} onChange={(v) => setOpt({ ...opt, start: v })} style={{ maxWidth: 200 }} />
        <Field label="Site team (e.g. 1 supervisor, 2 gangs of 4 fixers)" value={opt.team} onChange={(v) => setOpt({ ...opt, team: v })} />
        <Select label="Language" value={opt.lang} options={[{ value: "en", label: "English" }, { value: "ar", label: "العربية" }]} onChange={(v) => setOpt({ ...opt, lang: v })} style={{ maxWidth: 150 }} />
      </Row>
      <Field label="Anything else to say (warranty, samples, mock-up, special requests)" value={opt.notes} multiline onChange={(v) => setOpt({ ...opt, notes: v })} />
      <Btn kind="primary" icon={<Icon name="spark" color={c.accentInk} />} title={p ? "Write it again" : "Write the technical proposal"} busy={busy === "write"} onPress={write} />
      {busy === "write" && <T muted>The senior AI is writing all sections. This takes about a minute.</T>}
      {err ? <T color={c.bad}>{err}</T> : null}
      {p && <>
        {(p.open_points || []).length ? <Card><T bold color={c.warn}>Confirm before sending</T>{p.open_points.map((x: string, i: number) => <T key={i} size={14}>• {x}</T>)}</Card> : null}
        {(p.sections || []).map((s: any, i: number) => (
          <View key={i} style={{ gap: 6 }}>
            <H2>{s.title}</H2>
            <Field label="Text (## heading, - bullet, **bold**)" value={s.body} multiline onChange={(v) => setP({ ...p, sections: p.sections.map((x: any, j: number) => (j === i ? { ...x, body: v } : x)) })} />
          </View>))}
        <Row wrap>
          <Btn title="Save changes" onPress={async () => { try { await save(p); setErr(""); } catch (e: any) { setErr(e.message); } }} />
          <Btn kind="primary" icon={<Icon name="share" color={c.accentInk} />} title="Make PDF" busy={busy === "pdf"} onPress={pdf} />
        </Row>
        {saved?.at ? <Pill text={`saved ${day(saved.at)}`} /> : null}
        <T size={12} muted>On the laptop the print window opens: choose "Save as PDF". Send it together with the quotation PDF.</T>
      </>}
    </Sheet>
  );
}
