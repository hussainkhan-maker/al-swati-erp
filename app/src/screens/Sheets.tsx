// Site sheets: say or type it on site, the app makes the list.
//  • Material order (angles, glue, bolts…) and stone sizes → an Arabic PDF to send to the supplier. Editable until "Final".
//    A final order stays open until its invoice photo is added (the purchase goes to the project's costs).
//  • Subcontractor measurement → length × width − deduction per place, summed; "Final" adds the m² to that subcontractor on the project.
import { say as speak, stopListening } from "../lib/talk";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useFlows } from "../components/Flows";
import { Voice } from "../components/Voice";
import { pname, useData } from "../lib/data";
import { pickPhoto, uploadFile } from "../lib/files";
import { day, money, num, r2, uid } from "../lib/fmt";
import { Doc, docHTML, makeAndShare } from "../lib/pdf";
import { supabase } from "../lib/supabase";
import { Btn, Card, Empty, Field, H1, Icon, Photo, Pill, Rise, Row, Screen, Segmented, Select, Sheet, T, Tile, useColors } from "../ui";

type Kind = "material" | "stone" | "measure" | "pay";
const n0 = (v: any) => { const x = num(v); return Number.isFinite(x) ? x : 0; };
/** m² of one line: stone = length cm × width cm × pieces; measure = length m × width m − deduction. */
export const lineArea = (kind: Kind, l: any) => kind === "stone" ? r2((n0(l.l) * n0(l.w) * n0(l.qty)) / 10000) : kind === "measure" ? r2(Math.max(0, n0(l.l) * n0(l.w) - n0(l.deduct))) : 0;
const SITE_WORDS = ["عمود", "سقف", "جدار", "دیوار", "طول", "عرض", "خصم", "حدید", "سادہ", "چینل", "شانل", "زاویہ", "متر", "میٹر", "في", "ضرب"];
/** What was measured, written the way the team says it (they do not read English): column → عمود, wall → دیوار / جدار… */
const ELEM: [RegExp, string, string][] = [[/seedh|straight|مستقيم|سیدھ/i, "جدار مستقيم", "سیدھی دیوار"], [/amood|amoot|amud|amod|column|pillar|عمود|اموت|امود|ستون/i, "عمود", "عمود"], [/saqaf|saqf|sakaf|ceiling|soffit|سقف|صقف|چھت/i, "سقف", "سقف"], [/beam|kamra|كمرة|بیم/i, "كمرة", "بیم"], [/deewar|diwar|dewar|wall|jidar|جدار|دیوار/i, "جدار", "دیوار"], [/darwaza|door|باب|دروازہ/i, "باب", "دروازہ"], [/khirki|window|شباك|نافذة|کھڑکی/i, "شباك", "کھڑکی"], [/zeena|stair|درج|سیڑھ/i, "درج", "سیڑھی"]];
export const elemWord = (e: any, lang: string) => { const t = String(e || "").trim(); if (!t || lang === "en") return t; const hit = ELEM.find(([re]) => re.test(t)); return hit ? (lang === "ar" ? hit[1] : hit[2]) : t; };
const blank = (kind: Kind) => kind === "material" ? { name: "", size: "", qty: "", unit: "حبة", note: "" } : kind === "stone" ? { place: "", l: "", w: "", qty: "", note: "" } : { place: "", element: "", l: "", w: "", deduct: "", system: "", photo: "" };
const filled = (kind: Kind, l: any) => kind === "material" ? String(l.name || "").trim() : n0(l.l) > 0 && n0(l.w) > 0;

export default function Sheets() {
  const { d, lang, role, profile, reload } = useData(); const c = useColors();
  const [want, setWant] = useState(""), [wBusy, setWBusy] = useState(false), [wMsg, setWMsg] = useState("");
  // Voice first: say it, the app works out which sheet it is, fills it and reads back what it understood.
  const [say, setSay] = useState(""), [sBusy, setSBusy] = useState(false), [sMsg, setSMsg] = useState("");
  const [pend, setPend] = useState<any>(null);
  const openSheet = (r: any, text: string, proj: string) => {
    const k = r.kind as Kind;
    if (k === "pay" && role === "supervisor") { const m = L("Payments are written by the owner or Abu, not here.", "الدفعات يسجلها المالك أو أبو، ليس هنا.", "ادائیگی مالک یا ابو لکھتے ہیں، یہاں نہیں۔"); setSMsg(m); try { speak(m, { language: lang === "ur" ? "ur-PK" : lang === "ar" ? "ar-SA" : "en-US" }); } catch { /* no voice */ } return; }
    if (k === "measure") r = { ...r, lines: (r.lines || []).map((l: any) => ({ ...l, element: elemWord(l.element, lang) })) };
    setEdit(k === "pay" ? { kind: "pay", project_id: proj, party: r.party, amount: r.amount ?? "", lines: [{ method: r.method || "Cash", note: "" }], status: "draft", n: Date.now() }
      : { kind: k, project_id: proj, party: r.party, rate: r.rate ?? "", lines: (r.lines || []).map((l: any) => ({ ...blank(k), ...l })), status: "draft", heard: text, n: Date.now() });
    const total = k === "pay" ? 0 : (r.lines || []).reduce((t: number, l: any) => t + lineArea(k, l), 0);
    const back = k === "pay" ? L(`Payment to ${r.party}: ${r.amount} riyal. Check and save.`, `دفعة إلى ${r.party}: ${r.amount} ريال. راجع ثم احفظ.`, `${r.party} کو ادائیگی: ${r.amount} ریال۔ دیکھ کر محفوظ کریں۔`)
      : L(`${KIND[k][0]}: ${(r.lines || []).length} lines${total ? ", " + money(total) + " square metres" : ""}. Check and save.`, `${KIND[k][0]}: ${(r.lines || []).length} بنود${total ? "، " + money(total) + " متر مربع" : ""}. راجع ثم احفظ.`, `${KIND[k][0]}: ${(r.lines || []).length} لائن${total ? "، " + money(total) + " میٹر" : ""}۔ دیکھ کر محفوظ کریں۔`);
    const said = r.ask ? back + " " + r.ask : back;
    try { speak(said, { language: lang === "ur" ? "ur-PK" : lang === "ar" ? "ar-SA" : "en-US" }); } catch { /* no voice on this device */ }
    setSMsg(r.ask ? String(r.ask) : "");
  };
  /** The staff member said yes: the new project is made (Abu's side), he is put on it, and the owner is told. */
  const makeProject = async () => {
    if (!pend) return;
    setSBusy(true); setSMsg("");
    try {
      const { data, error } = await supabase.functions.invoke("site", { body: { action: "make_project", name: pend.r.new_project, lang } });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message);
      await reload(["projects"]);
      const p = pend; setPend(null); openSheet(p.r, p.text, (data as any).id);
    } catch (e: any) { setSMsg(e.message); }
    setSBusy(false);
  };
  const understandAll = async () => {
    const text = say.trim(); if (!text) return;
    stopListening(); setSBusy(true); setSMsg("");
    try {
      const names = [...new Set([...(d.sub_names || (d.subcontractors || []).map((x: any) => x.name) || []).map((x: any) => (typeof x === "string" ? x : x?.name)), ...Object.keys(owed)])].filter(Boolean).slice(0, 80);
      const { data, error } = await supabase.functions.invoke("site", { body: { action: "route", text, lang, projects: (d.projects || []).map((p: any) => p.name), names } });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message);
      const r = data as any;
      const hit = (d.projects || []).find((p: any) => r.project && String(p.name).toLowerCase() === String(r.project).toLowerCase())?.id || "";
      // He named a project the app does not have yet: ask him, and make it on his yes (the owner is told).
      if (!hit && String(r.new_project || "").trim()) {
        setPend({ r, text });
        const q = L(`"${r.new_project}" is not in the app yet. Shall I add it as a new project?`, `"${r.new_project}" غير موجود في التطبيق. هل أضيفه كمشروع جديد؟`, `"${r.new_project}" ایپ میں نہیں ہے۔ نیا پراجیکٹ بنا دوں؟`);
        setSMsg(q); try { speak(q, { language: lang === "ur" ? "ur-PK" : lang === "ar" ? "ar-SA" : "en-US" }); } catch { /* no voice */ }
        setSay(""); setSBusy(false); return;
      }
      openSheet(r, text, hit || pid || (d.projects || [])[0]?.id || "");
      setSay("");
    } catch (e: any) { setSMsg(e.message); }
    setSBusy(false);
  };
  const mine = role === "admin" ? [] : ((d.agent_inbox || []) as any[]).filter((x) => x.source === "staff").slice(0, 5);
  const sendWant = async () => {
    const text = want.trim(); if (!text) return;
    setWBusy(true); setWMsg("");
    const { error } = await supabase.from("agent_inbox").insert({ source: "staff", kind: "request", area: "site", status: "waiting", title: `${profile.name}: ${text.split("\n")[0].slice(0, 90)}`, body: text, data: { from: profile.name, role } });
    setWBusy(false);
    if (error) { setWMsg(error.message); return; }
    setWant(""); setWMsg(L("Saved. The owner will see it and answer here.", "تم الحفظ. سيراه المالك ويرد هنا.", "محفوظ۔ مالک دیکھ کر یہیں جواب دے گا۔")); reload(["agent_inbox"]);
  };
  const L = (en: string, ar: string, ur: string) => (lang === "ar" ? ar : lang === "ur" ? ur : en);
  const KIND: Record<Kind, [string, string, string]> = {
    material: [L("Order materials", "طلب مواد", "سامان کا آرڈر"), L("Angles, glue, bolts, any accessory", "زوايا، غراء، مسامير، أي إكسسوار", "زاویہ، گلو، بولٹ، کوئی بھی سامان"), "truck"],
    stone: [L("Stone sizes", "مقاسات الحجر", "پتھر کے سائز"), L("30×60, 20 pieces, for which place", "30×60، 20 حبة، لأي مكان", "30×60، 20 پتھر، کس جگہ کے لیے"), "tag"],
    pay: [L("Pay a stone supplier", "دفع لمورد الحجر", "پتھر والے کو ادائیگی"), L("Cash or hawala, no invoice needed", "نقدًا أو حوالة، بدون فاتورة", "نقد یا حوالہ، بل کے بغیر"), "cash"],
    measure: [L("Measure a contractor's work", "قياس أعمال المقاول", "ٹھیکیدار کی پیمائش"), L("Length × width per place, deduction, total m²", "الطول × العرض لكل مكان، الخصم، المجموع", "ہر جگہ کا طول × عرض، خصم، کل میٹر"), "ruler"],
  };
  const rows = ((d.site_sheets || []) as any[]).filter((x) => x.status !== "cancelled");
  const [pid, setPid] = useState(""), [edit, setEdit] = useState<any | null>(null);
  const list = rows.filter((x) => !pid || x.project_id === pid);
  const owing = rows.filter((x) => x.kind === "material" && x.status === "final");
  // Stone on credit: what arrived (m² × rate) is owed to each supplier, less what was paid to him.
  const owed: Record<string, number> = {};
  rows.forEach((x) => { const k = String(x.party || "").trim(); if (!k) return; if (x.kind === "stone" && ["received", "paid"].includes(x.status)) owed[k] = (owed[k] || 0) + (Number(x.amount) || 0); if (x.kind === "pay") owed[k] = (owed[k] || 0) - (Number(x.amount) || 0); });
  const owedList = Object.entries(owed).filter(([, v]) => Math.abs(v) > 0.5).sort((a, b) => b[1] - a[1]);
  const ST: Record<string, [string, "plain" | "good" | "warn" | "acc"]> = { draft: [L("Draft", "مسودة", "ڈرافٹ"), "plain"], final: [L("Final", "نهائي", "فائنل"), "acc"], paid: [L("Done", "تم", "مکمل"), "good"], received: [L("On the supplier's account", "على حساب المورد", "سپلائر کے کھاتے میں"), "acc"] };
  return (
    <Screen>
      <H1>{L("Orders & measurements", "الطلبات والقياسات", "آرڈر اور پیمائش")}</H1>
      <Card style={{ gap: 10 }}>
        <T bold center size={17}>{L("Just say it", "قلها فقط", "بس بول دیں")}</T>
        <Voice value={say} onChange={setSay} hints={[...SITE_WORDS, ...(d.projects || []).flatMap((p: any) => [p.name, ...(p.site?.aka || [])])]} placeholder={role === "supervisor" ? L("Order, stone sizes, or a contractor's measurement", "طلب، مقاسات حجر، أو قياس مقاول", "آرڈر، پتھر کے سائز، یا ٹھیکیدار کی پیمائش") : L("Order, stone sizes, a contractor's measurement, or a payment to the stone supplier", "طلب، مقاسات حجر، قياس مقاول، أو دفعة لمورد الحجر", "آرڈر، پتھر کے سائز، ٹھیکیدار کی پیمائش، یا پتھر والے کو ادائیگی")} />
        <Btn big kind="primary" title={L("Understand", "افهم", "سمجھو")} busy={sBusy} disabled={!say.trim()} onPress={understandAll} style={{ alignSelf: "stretch" }} />
        {sMsg ? <T color={c.warn}>{sMsg}</T> : null}
        {pend ? <Row style={{ gap: 8 }}>
          <Btn big kind="primary" title={L("Yes, add it", "نعم، أضفه", "ہاں، بنا دو")} busy={sBusy} onPress={makeProject} style={{ flex: 1 }} />
          <Btn big title={L("No", "لا", "نہیں")} onPress={() => { const p = pend; setPend(null); openSheet(p.r, p.text, pid || ""); }} style={{ flex: 1 }} />
        </Row> : null}
      </Card>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {(Object.keys(KIND) as Kind[]).filter((k) => k !== "pay" || role !== "supervisor").map((k) => <Tile key={k} icon={KIND[k][2]} title={KIND[k][0]} sub={KIND[k][1]} onPress={() => setEdit({ kind: k, project_id: pid || (d.projects || [])[0]?.id || "", party: "", lines: [], status: "draft" })} />)}
      </View>
      {owing.length ? (
        <Card style={{ borderColor: c.warn, backgroundColor: c.warnSoft, gap: 6 }}>
          <T bold color={c.warn}>{L(`${owing.length} order(s) placed: the invoice photo is still missing`, `${owing.length} طلب: صورة الفاتورة غير موجودة`, `${owing.length} آرڈر: بل کی تصویر ابھی نہیں آئی`)}</T>
          {owing.slice(0, 5).map((x) => <Pressable key={x.id} onPress={() => setEdit(x)} style={{ paddingVertical: 4, cursor: "pointer" } as any}><T size={14}>{pname(d, x.project_id)} · {KIND[x.kind as Kind][0]}{x.party ? " · " + x.party : ""} · {day(x.final_at || x.created_at)}</T></Pressable>)}
        </Card>) : null}
      {owedList.length && role !== "supervisor" ? (
        <Card style={{ gap: 4 }}>
          <T bold>{L("Stone suppliers: still to pay", "موردو الحجر: المتبقي", "پتھر والے: باقی رقم")}</T>
          {owedList.map(([name, v], i) => (
            <Pressable key={name} onPress={() => setEdit({ kind: "pay", project_id: pid || (d.projects || [])[0]?.id || "", party: name, lines: [], status: "draft" })} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderColor: c.line, cursor: "pointer" } as any}>
              <T style={{ flex: 1 }}>{name}</T><T bold color={v > 0 ? c.warn : c.good}>{money(v)} SAR</T>
            </Pressable>))}
        </Card>) : null}
      {(d.projects || []).length > 1 ? <Select label={L("Project", "المشروع", "پراجیکٹ")} value={pid} onChange={setPid} options={[{ value: "", label: L("All projects", "كل المشاريع", "تمام پراجیکٹ") }, ...(d.projects || []).map((p: any) => ({ value: p.id, label: p.name }))]} /> : null}
      {list.length ? list.map((x, i) => (
        <Rise key={x.id} i={i}>
          <Card onPress={() => setEdit(x)}>
            <Row>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }}><Icon name={KIND[x.kind as Kind][2]} size={20} color={c.accent} /></View>
              <View style={{ flex: 1 }}>
                <T bold>{KIND[x.kind as Kind][0]}{x.party ? " · " + x.party : ""}</T>
                <T size={13} muted>{pname(d, x.project_id)} · {day(x.created_at)} · {x.kind === "pay" ? `${money(x.amount)} SAR` : `${(x.lines || []).length} ${L("lines", "بنود", "لائن")}${x.kind !== "material" ? ` · ${money(x.total)} m²` : ""}${x.kind === "stone" && Number(x.amount) > 0 ? ` · ${money(x.amount)} SAR` : ""}`}</T>
              </View>
              <Pill kind={x.kind === "measure" && x.status === "final" ? "warn" : (ST[x.status] || ST.draft)[1]} text={x.kind === "measure" && x.status === "final" ? L("Waiting for approval", "بانتظار الاعتماد", "منظوری کا انتظار") : (ST[x.status] || ST.draft)[0]} />
            </Row>
          </Card>
        </Rise>)) : <Empty icon="doc" title={L("Nothing yet", "لا يوجد شيء بعد", "ابھی کچھ نہیں")} text={L("Choose one of the three buttons above and say what you need.", "اختر أحد الأزرار الثلاثة أعلاه وقل ما تحتاجه.", "اوپر تین بٹنوں میں سے ایک دبائیں اور بولیں کیا چاہیے۔")} />}
      {role !== "admin" ? (
        <Card style={{ gap: 10 }}>
          <T bold>{L("Need something this app does not do yet?", "تحتاج شيئًا غير موجود في التطبيق؟", "کوئی ایسا کام جو ایپ میں نہیں؟")}</T>
          <Voice value={want} onChange={setWant} placeholder={L("Say or type what you need.", "قل أو اكتب ما تحتاجه.", "بولیں یا لکھیں کیا چاہیے۔")} />
          <Btn kind="primary" title={L("Send to the owner", "أرسل إلى المالك", "مالک کو بھیجیں")} busy={wBusy} disabled={!want.trim()} onPress={sendWant} />
          {wMsg ? <T size={13} color={c.accent}>{wMsg}</T> : null}
          {mine.map((x) => <View key={x.id} style={{ borderTopWidth: 1, borderColor: c.line, paddingTop: 8, gap: 2 }}><T size={14}>{x.body}</T><T size={12} muted>{x.status === "done" ? (x.result || L("Done", "تم", "ہو گیا")) : L("With the owner", "عند المالك", "مالک کے پاس ہے")}</T></View>)}
        </Card>) : null}
      {edit && edit.kind === "pay" ? <PayEditor key={edit.id || "pay" + edit.party + (edit.n || "")} init={edit} onClose={() => setEdit(null)} L={L} title={KIND.pay[0]} suppliers={Object.keys(owed)} /> : null}
      {edit && edit.kind !== "pay" ? <Editor key={edit.id || edit.kind + (edit.n || "")} init={edit} onClose={() => setEdit(null)} L={L} title={KIND[edit.kind as Kind][0]} canReopen={role !== "supervisor"} /> : null}
    </Screen>
  );
}

function Editor({ init, onClose, L, title, canReopen }: { init: any; onClose: () => void; L: (en: string, ar: string, ur: string) => string; title: string; canReopen: boolean }) {
  const { d, profile, insert, update, reload, lang } = useData(); const c = useColors(); const flows = useFlows();
  const kind = init.kind as Kind;
  const [f, setF] = useState<any>({ ...init, lines: (init.lines || []).length ? init.lines : [blank(kind)] });
  const [text, setText] = useState(""), [busy, setBusy] = useState(""), [msg, setMsg] = useState(""), [sure, setSure] = useState(false);
  const locked = f.status !== "draft"; const added = useRef(false);
  // Every message is also said aloud, so someone who does not read is led to the next step: check, Final, then the photo.
  useEffect(() => { if (!msg) return; try { speak(msg, { language: lang === "ur" ? "ur-PK" : lang === "ar" ? "ar-SA" : "en-US" }); } catch { /* no voice on this device */ } }, [msg]);
  const subs: string[] = (d.sub_names || (d.subcontractors || []).map((s: any) => s.name) || []).map((s: any) => (typeof s === "string" ? s : s?.name)).filter(Boolean);
  const lines = (f.lines as any[]).filter((l) => filled(kind, l));
  const total = r2(lines.reduce((s, l) => s + lineArea(kind, l), 0));
  const pieces = kind === "stone" ? lines.reduce((s, l) => s + n0(l.qty), 0) : 0;
  // A subcontractor may have one rate for work on C-channel and another for work fixed on the wall: the m² are kept apart.
  const bySystem = (["wall", "channel", ""] as const).map((k) => ({ k, m2: r2(lines.filter((l) => (l.system || "") === k).reduce((t, l) => t + lineArea(kind, l), 0)), n: lines.filter((l) => (l.system || "") === k).length })).filter((g) => g.m2 > 0);
  const sysName = (k: string) => (k === "channel" ? "C-channel" : k === "wall" ? "Wall" : "");
  const setLine = (i: number, k: string, v: any) => setF((x: any) => ({ ...x, lines: x.lines.map((l: any, j: number) => (j === i ? { ...l, [k]: v } : l)) }));

  /** What the reader returned goes into the sheet. It says aloud what it wrote and asks back when something is unclear. */
  const take = (data: any, heard: string) => {
    const got = (data.lines || []).map((l: any) => ({ ...blank(kind), ...l, ...(kind === "measure" ? { element: elemWord(l.element, lang) } : {}) }));
    if (!got.length) throw new Error(data.ask || L("Nothing understood. Say it again, one item at a time.", "لم أفهم. قلها مرة أخرى، بندًا بندًا.", "سمجھ نہیں آیا۔ دوبارہ بولیں، ایک ایک چیز۔"));
    setF((x: any) => ({ ...x, party: x.party || data.party || "", heard: [x.heard, heard].filter(Boolean).join(" | "), lines: [...x.lines.filter((l: any) => filled(kind, l)), ...got] }));
    const sum = r2(got.reduce((t: number, l: any) => t + lineArea(kind, l), 0));
    const parts = [
      kind === "material" ? L(`${got.length} items added.`, `أضيف ${got.length} بنود.`, `${got.length} چیزیں لکھ دیں۔`) : L(`${got.length} lines added, ${money(sum)} square metres.`, `أضيف ${got.length} بنود، ${money(sum)} متر مربع.`, `${got.length} لائنیں لکھ دیں، ${money(sum)} میٹر۔`),
      data.ask ? String(data.ask) : "",
    ].filter(Boolean);
    setMsg(parts.join(" "));
  };
  const understand = async () => {
    if (!text.trim()) return;
    stopListening(); setBusy("read"); setMsg("");
    try {
      const { data, error } = await supabase.functions.invoke("site", { body: { kind, text, lang, names: subs.slice(0, 60) } });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message);
      take(data, text); setText("");
    } catch (e: any) { setMsg(e.message); }
    setBusy("");
  };
  const rate = kind === "stone" ? n0(f.rate) : 0, amount = kind === "stone" && rate > 0 ? r2(total * rate) : null;
  const row = (status: string) => ({ project_id: f.project_id, kind, party: String(f.party || "").trim(), lines, total, status, ...(kind === "stone" ? { rate: rate || null, amount } : {}), heard: f.heard || null, updated_at: new Date().toISOString(), ...(status === "final" && !f.final_at ? { final_at: new Date().toISOString() } : {}) });
  const save = async (status: string) => {
    if (!f.project_id) { setMsg(L("Choose the project.", "اختر المشروع.", "پراجیکٹ چنیں۔")); return null; }
    if (!lines.length) { setMsg(L("Add at least one line.", "أضف بندًا واحدًا على الأقل.", "کم از کم ایک لائن ڈالیں۔")); return null; }
    setBusy(status); setMsg("");
    try {
      let id = f.id;
      if (id) await update("site_sheets", id, row(status));
      else { const r = await insert("site_sheets", row(status)); id = r.data?.id; }
      setF((x: any) => ({ ...x, id, status }));
      await reload(["site_sheets"]);
      setBusy(""); return id as string;
    } catch (e: any) { setMsg(e.message); setBusy(""); return null; }
  };
  const finish = async () => {
    if (!sure) { setSure(true); return; }
    setSure(false);
    if (kind === "measure" && !canReopen) {
      // A supervisor's measurement waits for Abu or the owner: the m² are added when one of them approves.
      if (!String(f.party || "").trim()) { setMsg(L("Choose the subcontractor.", "اختر المقاول.", "ٹھیکیدار چنیں۔")); return; }
      if (await save("final")) setMsg(L("Sent for approval. The m² are added when Abu or the owner approves.", "أُرسل للاعتماد. تضاف الأمتار بعد الموافقة.", "منظوری کے لیے بھیج دیا۔ منظوری کے بعد میٹر جڑیں گے۔"));
      return;
    }
    if (kind === "measure") {
      if (!String(f.party || "").trim()) { setMsg(L("Choose the subcontractor.", "اختر المقاول.", "ٹھیکیدار چنیں۔")); return; }
      if (!(total > 0)) { setMsg(L("The total is 0.", "المجموع صفر.", "کل میٹر صفر ہے۔")); return; }
      setBusy("final");
      // The measured m² become the subcontractor's work on this project (the same entry as "speak the meters").
      try {
        if (!added.current) for (const g of bySystem) await insert("progress", { project_id: f.project_id, sub_name: String(f.party).trim(), qty: g.m2, unit: "sqm", kind: g.k || null, work: `Measured${g.k ? ", " + sysName(g.k) : ""}, ${g.n} places`, work_date: new Date().toISOString().slice(0, 10), heard: f.heard || null, flags: [] });
        added.current = true;
      }
      catch (e: any) { setMsg(e.message); setBusy(""); return; }
    }
    if (await save(kind === "measure" ? "paid" : "final")) { if (f.heard) supabase.functions.invoke("site", { body: { action: "learn", kind, heard: f.heard, lines } }).catch(() => {}); setMsg(kind === "measure" ? L(`Saved: ${money(total)} m² added to ${f.party}.`, `تم الحفظ: ${money(total)} م² أضيفت إلى ${f.party}.`, `محفوظ: ${money(total)} میٹر ${f.party} کے کھاتے میں۔`) : L("Final. Send the PDF. When it is paid, add the invoice photo here.", "نهائي. أرسل الملف. عند الدفع أضف صورة الفاتورة هنا.", "فائنل۔ PDF بھیجیں۔ ادائیگی پر بل کی تصویر یہاں ڈالیں۔")); }
  };
  // The stone has arrived: its value goes to the project's costs and onto the supplier's account (no invoice needed).
  const arrived = async () => {
    if (!sure) { setSure(true); return; }
    setSure(false);
    if (!String(f.party || "").trim()) { setMsg(L("Write the supplier's name.", "اكتب اسم المورد.", "سپلائر کا نام لکھیں۔")); return; }
    if (!(rate > 0)) { setMsg(L("Write the supplier's rate per m².", "اكتب سعر المورد للمتر المربع.", "سپلائر کا ریٹ فی میٹر لکھیں۔")); return; }
    setBusy("arr"); setMsg("");
    try {
      let tid = f.txn_id || null;
      if (!added.current) { const r = await insert("txns", { type: "expense", project_id: f.project_id, split: [{ project_id: f.project_id, pct: 100 }], amount, description: `Stone on credit · ${String(f.party).trim()} · ${money(total)} m² × ${money(rate)}`, paid_on: new Date().toISOString().slice(0, 10), method: "Other", heard: f.heard || null, flags: [] }); added.current = true; tid = r.data?.id ?? null; }
      await update("site_sheets", f.id, { ...row("received"), txn_id: tid });
      setF((x: any) => ({ ...x, status: "received", txn_id: tid })); await reload(["site_sheets"]);
      setMsg(L(`${money(amount)} SAR is now on ${f.party}'s account and in the project's costs.`, `${money(amount)} ريال على حساب ${f.party} وفي تكاليف المشروع.`, `${money(amount)} ریال ${f.party} کے کھاتے اور پراجیکٹ کے خرچے میں۔`));
    } catch (e: any) { setMsg(e.message); }
    setBusy("");
  };
  const share = async () => {
    setBusy("pdf"); setMsg("");
    try {
      const p = pname(d, f.project_id), who = String(f.party || "").trim();
      const doc: Doc = kind === "material"
        ? { title: `طلب مواد - ${p}${who ? " - " + who : ""}`, cols: ["#", "الصنف", "المقاس / النوع", "الكمية", "الوحدة", "ملاحظات"], rows: lines.map((l, i) => [String(i + 1), l.name, l.size || "", String(l.qty ?? ""), l.unit || "", l.note || ""]), sum: [["عدد البنود", String(lines.length)]], numCols: [] }
        : kind === "stone"
          ? { title: `مقاسات الحجر - ${p}${who ? " - " + who : ""}`, cols: ["#", "المكان", "الطول سم", "العرض سم", "العدد", "ملاحظات", "م²"], rows: lines.map((l, i) => [String(i + 1), l.place || "", String(l.l), String(l.w), String(l.qty), l.note || "", lineArea(kind, l)]), sum: [["عدد القطع", String(pieces)], ["المجموع م²", money(total)]], numCols: [6] }
          : (() => {
            // The subcontractor's sheet: what was measured, length, width, length × width, the deduction if any, the area, then the totals.
            const AR: [RegExp, string][] = [[/seedh|straight|مستقيم|سیدھ/i, "جدار مستقيم"], [/amood|amud|column|pillar|عمود|ستون/i, "عمود"], [/saqaf|saqf|ceiling|soffit|سقف|چھت/i, "سقف"], [/beam|kamra|كمرة|بیم/i, "كمرة"], [/deewar|diwar|dewar|wall|jidar|جدار|دیوار/i, "جدار"], [/darwaza|door|باب|دروازہ/i, "باب"], [/khirki|window|شباك|نافذة|کھڑکی/i, "شباك"], [/zeena|stair|درج|سیڑھ/i, "درج"]];
            const what = (l: any) => { const e = String(l.element || "").trim(); const ar = AR.find(([re]) => re.test(e))?.[1] || e; return [ar, String(l.place || "").trim()].filter(Boolean).join(" - ") || "-"; };
            const sysAr = (k: string) => (k === "channel" ? "على القناة (حديد)" : k === "wall" ? "على الجدار (سادة)" : "");
            const anyDed = lines.some((l) => n0(l.deduct) > 0), anySys = lines.some((l) => l.system);
            const cols = ["#", "البند", ...(anySys ? ["النوع"] : []), "الطول م", "العرض م", "الطول × العرض", ...(anyDed ? ["الخصم م²"] : []), "المساحة م²"];
            const rows = lines.map((l, i) => [String(i + 1), what(l), ...(anySys ? [sysAr(l.system || "")] : []), String(l.l), String(l.w), money(r2(n0(l.l) * n0(l.w))), ...(anyDed ? [n0(l.deduct) ? money(n0(l.deduct)) : ""] : []), lineArea(kind, l)]);
            const sum: [string, string][] = [...(anySys ? bySystem.map((g) => [`مجموع ${sysAr(g.k) || "غير محدد"} م²`, money(g.m2)] as [string, string]) : []), ["المجموع م²", money(total)]];
            return { title: `قياس أعمال - ${who || "-"} - ${p}`, cols, rows, sum, numCols: [cols.length - 1] } as Doc;
          })();
      await makeAndShare(doc, docHTML(doc, "ar", profile.name));
    } catch (e: any) { setMsg(e.message); }
    setBusy("");
  };
  const photo = async (i: number) => {
    const u = await pickPhoto(true); if (!u) return;
    setBusy("photo" + i);
    try { const p = `${profile.id}/${uid()}.jpg`; await uploadFile("receipts", p, u); setLine(i, "photo", p); } catch (e: any) { setMsg(e.message); }
    setBusy("");
  };
  const F = (i: number, k: string, label: string, w?: number, numeric?: boolean) => locked
    ? <View key={k} style={{ flex: w ? undefined : 1, minWidth: w || 120 }}><T size={12} muted>{label}</T><T>{String(f.lines[i][k] ?? "") || "—"}</T></View>
    : <Field key={k} label={label} value={f.lines[i][k]} numeric={numeric} onChange={(v) => setLine(i, k, v)} style={w ? { maxWidth: w, minWidth: Math.min(w, 84) } : undefined} />;

  return (
    <Sheet open onClose={onClose} title={title}>
      <Card>
        <Row wrap>
          {locked ? <View style={{ flex: 1 }}><T size={12} muted>{L("Project", "المشروع", "پراجیکٹ")}</T><T bold>{pname(d, f.project_id)}</T></View>
            : <Select label={L("Project", "المشروع", "پراجیکٹ")} value={f.project_id} onChange={(v) => setF((x: any) => ({ ...x, project_id: v }))} options={(d.projects || []).filter((p: any) => p.status !== "closed").map((p: any) => ({ value: p.id, label: p.name }))} />}
          {locked ? <View style={{ flex: 1 }}><T size={12} muted>{kind === "measure" ? L("Subcontractor", "المقاول", "ٹھیکیدار") : L("Supplier", "المورد", "سپلائر")}</T><T bold>{f.party || "—"}</T></View>
            : kind === "measure" && subs.length ? <Select label={L("Subcontractor", "المقاول", "ٹھیکیدار")} value={f.party} onChange={(v) => setF((x: any) => ({ ...x, party: v }))} options={[{ value: "", label: "—" }, ...subs.map((s) => ({ value: s, label: s }))]} />
              : <Field label={kind === "measure" ? L("Subcontractor", "المقاول", "ٹھیکیدار") : L("Supplier (if known)", "المورد (إن وجد)", "سپلائر (اگر معلوم ہو)")} value={f.party} onChange={(v) => setF((x: any) => ({ ...x, party: v }))} />}
          {kind === "stone" && ["draft", "final"].includes(f.status) ? <Field label={L("Supplier's rate, SAR per m²", "سعر المورد، ريال للمتر", "سپلائر کا ریٹ، ریال فی میٹر")} numeric value={f.rate ?? ""} onChange={(v) => setF((x: any) => ({ ...x, rate: v }))} style={{ maxWidth: 220 }} /> : null}
        </Row>
        {kind === "stone" && amount ? <T size={14}>{money(total)} m² × {money(rate)} = <T bold size={14}>{money(amount)} SAR</T></T> : null}
      </Card>
      {!locked ? <Card>
        <Voice value={text} onChange={setText} hints={[...SITE_WORDS, ...subs]} placeholder={kind === "material" ? "زاوية 5×5 مئة حبة، غراء أبو جمال 10 كرتون، مسمار 10×100 مئتين"
          : kind === "stone" ? "30×60 عشرين حبة للمدخل، 30×80 أربعين حبة للواجهة" : "عمود طول 3.2 عرض 0.6، سقف 4 في 2 خصم 0.5، جدار 6 في 3"} />
        <Btn big kind="primary" title={L("Understand", "افهم", "سمجھو")} busy={busy === "read"} disabled={!text.trim()} onPress={understand} style={{ alignSelf: "stretch" }} />
      </Card> : null}
      <Card style={{ gap: 12 }}>
        {(f.lines as any[]).map((l, i) => (
          <View key={i} style={{ gap: 6, paddingTop: i ? 12 : 0, borderTopWidth: i ? 1 : 0, borderColor: c.line }}>
            <Row wrap style={{ alignItems: "flex-end" }}>
              {kind === "material" ? [F(i, "name", L("Item", "الصنف", "چیز")), F(i, "size", L("Size / type", "المقاس / النوع", "سائز"), 150), F(i, "qty", L("Qty", "الكمية", "تعداد"), 90, true), F(i, "unit", L("Unit", "الوحدة", "یونٹ"), 90)]
                : kind === "stone" ? [F(i, "place", L("Place", "المكان", "جگہ")), F(i, "l", L("Length cm", "الطول سم", "طول cm"), 100, true), F(i, "w", L("Width cm", "العرض سم", "عرض cm"), 100, true), F(i, "qty", L("Pieces", "العدد", "تعداد"), 90, true)]
                  : [F(i, "place", L("Place", "المكان", "جگہ")), F(i, "element", L("Column, ceiling, wall…", "عمود، سقف، جدار…", "عمود، سقف، دیوار…"), 150), F(i, "l", L("Length m", "الطول م", "طول m"), 96, true), F(i, "w", L("Width m", "العرض م", "عرض m"), 96, true), F(i, "deduct", L("Deduct m²", "الخصم م²", "خصم m²"), 96, true)]}
            </Row>
            <Row wrap>
              {kind !== "measure" ? <View style={{ flex: 1, minWidth: 160 }}>{F(i, "note", L("Note", "ملاحظات", "نوٹ"))}</View> : null}
              {kind === "measure" ? (locked ? <T muted size={13} style={{ minWidth: 90 }}>{l.system === "channel" ? L("On C-channel (steel)", "على القناة (حديد)", "چینل پر (حدید)") : l.system === "wall" ? L("On the wall (plain)", "على الجدار (سادة)", "دیوار پر (سادہ)") : ""}</T>
                : <View style={{ minWidth: 190 }}><Segmented value={l.system || ""} onChange={(v) => setLine(i, "system", v)} options={[["wall", L("On the wall (plain)", "على الجدار (سادة)", "دیوار پر (سادہ)")], ["channel", L("On C-channel (steel)", "على القناة (حديد)", "چینل پر (حدید)")]]} /></View>) : null}
              {kind !== "material" ? <T bold style={{ minWidth: 90 }}>{money(lineArea(kind, l))} m²</T> : null}
              {kind === "measure" ? (l.photo ? <Photo path={l.photo} size={40} /> : !locked ? <Btn kind="ghost" icon={<Icon name="camera" size={16} color={c.accent} />} title={L("Photo", "صورة", "تصویر")} busy={busy === "photo" + i} onPress={() => photo(i)} /> : null) : null}
              {!locked && f.lines.length > 1 ? <Btn kind="ghost" title="✕" onPress={() => setF((x: any) => ({ ...x, lines: x.lines.filter((_: any, j: number) => j !== i) }))} /> : null}
            </Row>
          </View>))}
        {!locked ? <Btn kind="ghost" icon={<Icon name="plus" size={16} color={c.accent} />} title={L("Add a line", "أضف بندًا", "لائن ڈالیں")} onPress={() => setF((x: any) => ({ ...x, lines: [...x.lines, blank(kind)] }))} /> : null}
        {kind !== "material" ? <Row style={{ borderTopWidth: 1, borderColor: c.line, paddingTop: 10 }}><T bold style={{ flex: 1 }}>{L("Total", "المجموع", "کل")}{kind === "stone" ? ` · ${pieces} ${L("pieces", "حبة", "پتھر")}` : ""}</T><T bold size={20}>{money(total)} m²</T></Row> : null}
        {kind === "measure" && bySystem.some((g) => g.k) ? <T muted size={14}>{bySystem.map((g) => `${g.k === "channel" ? L("On C-channel (steel)", "على القناة (حديد)", "چینل پر (حدید)") : g.k === "wall" ? L("On the wall (plain)", "على الجدار (سادة)", "دیوار پر (سادہ)") : L("Not chosen", "غير محدد", "نہیں چنا")}: ${money(g.m2)} m²`).join("  ·  ")}</T> : null}
      </Card>
      {msg ? <T color={c.warn}>{msg}</T> : null}
      <Row wrap>
        {!locked ? <Btn title={L("Save draft", "حفظ مسودة", "ڈرافٹ محفوظ")} busy={busy === "draft"} onPress={() => save("draft")} /> : null}
        <Btn icon={<Icon name="share" size={16} />} title={L("PDF / share", "PDF / مشاركة", "PDF / شیئر")} busy={busy === "pdf"} disabled={!lines.length} onPress={share} />
        {!locked ? <Btn kind="primary" title={sure ? L("Tap again: this is final", "اضغط مرة أخرى: نهائي", "دوبارہ دبائیں: یہ فائنل ہے") : kind === "measure" ? (canReopen ? L("Final: add the m²", "نهائي: أضف الأمتار", "فائنل: میٹر ڈال دیں") : L("Final: send for approval", "نهائي: أرسل للاعتماد", "فائنل: منظوری کے لیے بھیجیں")) : L("Final: order placed", "نهائي: تم الطلب", "فائنل: آرڈر ہو گیا")} busy={busy === "final"} onPress={finish} /> : null}
        {f.status === "final" && kind === "stone" && f.id ? <Btn kind="primary" title={sure ? L("Tap again: the stone has arrived", "اضغط مرة أخرى: وصل الحجر", "دوبارہ دبائیں: پتھر آ گیا") : L("Stone arrived: put it on the supplier's account", "وصل الحجر: سجله على حساب المورد", "پتھر آ گیا: سپلائر کے کھاتے میں ڈالیں")} busy={busy === "arr"} onPress={arrived} /> : null}
        {f.status === "final" && kind === "material" ? <Btn kind="primary" icon={<Icon name="camera" size={16} color={c.accentInk} />} title={L("Paid: add the invoice photo", "تم الدفع: أضف صورة الفاتورة", "ادائیگی ہو گئی: بل کی تصویر")} onPress={() => { onClose(); flows("purchase", { voice: { supplier: f.party, project_id: f.project_id }, sheet_id: f.id }); }} /> : null}
        {f.status === "final" && kind === "measure" && canReopen ? <Btn kind="primary" title={sure ? L("Tap again: add the m²", "اضغط مرة أخرى: أضف الأمتار", "دوبارہ دبائیں: میٹر ڈالیں") : L(`Approve: add ${money(total)} m²`, `اعتماد: أضف ${money(total)} م²`, `منظور: ${money(total)} میٹر ڈالیں`)} busy={busy === "paid" || busy === "final"} onPress={finish} /> : null}
        {f.status === "final" && kind !== "measure" && canReopen ? <Btn title={L("Change the order", "تعديل الطلب", "آرڈر بدلیں")} onPress={() => setF((x: any) => ({ ...x, status: "draft" }))} /> : null}
      </Row>
    </Sheet>
  );
}

/** One payment to a stone supplier (cash, hawala…): it comes off what he is owed. No invoice. */
function PayEditor({ init, onClose, L, title, suppliers }: { init: any; onClose: () => void; L: (en: string, ar: string, ur: string) => string; title: string; suppliers: string[] }) {
  const { d, insert, reload } = useData(); const c = useColors();
  const [f, setF] = useState<any>({ project_id: init.project_id, party: init.party || "", amount: init.amount ?? "", method: init.lines?.[0]?.method || "Cash", note: init.lines?.[0]?.note || "" });
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const done = !!init.id;
  const save = async () => {
    const amt = n0(f.amount);
    if (!String(f.party || "").trim() || !(amt > 0) || !f.project_id) { setMsg(L("Supplier, amount and project are needed.", "المورد والمبلغ والمشروع مطلوبة.", "سپلائر، رقم اور پراجیکٹ ضروری ہیں۔")); return; }
    setBusy(true); setMsg("");
    try { await insert("site_sheets", { project_id: f.project_id, kind: "pay", party: String(f.party).trim(), lines: [{ method: f.method, note: f.note }], total: 0, amount: r2(amt), status: "paid", final_at: new Date().toISOString() }); await reload(["site_sheets"]); onClose(); }
    catch (e: any) { setMsg(e.message); setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} title={title}>
      <Card>
        {suppliers.length && !done ? <Select label={L("Supplier", "المورد", "سپلائر")} value={suppliers.includes(f.party) ? f.party : ""} onChange={(v) => setF((x: any) => ({ ...x, party: v }))} options={[{ value: "", label: "—" }, ...suppliers.map((s2) => ({ value: s2, label: s2 }))]} /> : null}
        <Field label={L("Supplier's name", "اسم المورد", "سپلائر کا نام")} value={f.party} onChange={(v) => setF((x: any) => ({ ...x, party: v }))} />
        <Row wrap>
          <Field label={L("Amount paid, SAR", "المبلغ المدفوع، ريال", "دی گئی رقم، ریال")} numeric value={f.amount} onChange={(v) => setF((x: any) => ({ ...x, amount: v }))} />
          <Select label={L("How", "الطريقة", "کیسے")} value={f.method} onChange={(v) => setF((x: any) => ({ ...x, method: v }))} options={["Cash", "Hawala", "Bank transfer", "Other"].map((m) => ({ value: m, label: m }))} />
        </Row>
        <Select label={L("Project", "المشروع", "پراجیکٹ")} value={f.project_id} onChange={(v) => setF((x: any) => ({ ...x, project_id: v }))} options={(d.projects || []).map((p: any) => ({ value: p.id, label: p.name }))} />
        <Field label={L("Note", "ملاحظات", "نوٹ")} value={f.note} onChange={(v) => setF((x: any) => ({ ...x, note: v }))} />
      </Card>
      {msg ? <T color={c.warn}>{msg}</T> : null}
      {!done ? <Btn big kind="primary" title={L("Save the payment", "احفظ الدفعة", "ادائیگی محفوظ کریں")} busy={busy} onPress={save} /> : <T muted>{L("Saved.", "تم الحفظ.", "محفوظ ہے۔")}</T>}
    </Sheet>
  );
}
