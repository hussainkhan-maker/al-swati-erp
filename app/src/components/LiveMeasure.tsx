// Live measurement: the supervisor stands at the wall with the tape and only talks. He taps the microphone once; after
// that every place he says ("amood 3.2 by 0.6", "deewar 6 by 3 khasam 1") becomes a line in front of him, is said back so
// he hears it is right, and is saved at once. He never presses "save" between places. "Ghalat" takes the last line away,
// "bas" ends the listening. Sending it for approval is one button at the end: that step is never done by voice alone.
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useData } from "../lib/data";
import { money, num, r2 } from "../lib/fmt";
import { speechLang } from "../lib/i18n";
import { mQty, measureDoc } from "../lib/measure";
import { mArea } from "../lib/measure";
import { docHTML, makeAndShare } from "../lib/pdf";
import { supabase } from "../lib/supabase";
import { hush, isSpeaking, say, stopListening } from "../lib/talk";
import { Btn, Card, Field, Icon, Row, Select, Sheet, T, useColors } from "../ui";

const n0 = (v: any) => { const x = num(v); return Number.isFinite(x) ? x : 0; };
const area = mArea;
const WORDS = ["عمود", "سقف", "جدار", "دیوار", "طول", "عرض", "خصم", "حدید", "سادہ", "چینل", "شانل", "ضرب", "في", "میٹر", "غلط", "بس"];
const ELEM: [RegExp, string, string][] = [[/seedh|straight|مستقيم|سیدھ/i, "جدار مستقيم", "سیدھی دیوار"], [/amood|amoot|amud|amod|column|pillar|عمود|اموت|امود|ستون/i, "عمود", "عمود"], [/saqaf|saqf|sakaf|ceiling|soffit|سقف|صقف|چھت/i, "سقف", "سقف"], [/beam|kamra|كمرة|بیم/i, "كمرة", "بیم"], [/deewar|diwar|dewar|wall|jidar|جدار|دیوار/i, "جدار", "دیوار"], [/darwaza|door|باب|دروازہ/i, "باب", "دروازہ"], [/khirki|window|شباك|نافذة|کھڑکی/i, "شباك", "کھڑکی"], [/zeena|stair|درج|سیڑھ/i, "درج", "سیڑھی"]];
const elemWord = (e: any, lang: string) => { const t = String(e || "").trim(); if (!t || lang === "en") return t; const hit = ELEM.find(([re]) => re.test(t)); return hit ? (lang === "ar" ? hit[1] : hit[2]) : t; };
const UNDO = /(غلط|ghalat|galat|مٹا|mita|ہٹا|hata|wrong|delete|undo|احذف|امسح|خطأ|کاٹ)/i;
const STOP = /^\s*(bas|بس|khatam|ختم|ho gaya|ہو گیا|خلاص|خلص|finish|done|stop|رک جا|ruk)/i;

/** The sheet's columns, written the way the subcontractors' paper is: item, length, width, length × width. */
const HEAD: [string, number][] = [["#", 0.5], ["البند", 2], ["العدد", 0.8], ["الطول", 1], ["العرض", 1], ["م²", 1.2], ["", 0.5]];
const CELL: any = { paddingVertical: 8, paddingHorizontal: 6, justifyContent: "center", borderLeftWidth: 1 };

export function LiveMeasure({ init, onClose }: { init?: any; onClose: () => void }) {
  const { d, lang, role, profile, insert, update, reload } = useData(); const c = useColors();
  const L = (en: string, ar: string, ur: string) => (lang === "ar" ? ar : lang === "ur" ? ur : en);
  const projects = (d.projects || []).filter((p: any) => p.status !== "closed");
  const subs: string[] = (d.sub_names || (d.subcontractors || []).map((s: any) => s.name) || []).map((s: any) => (typeof s === "string" ? s : s?.name)).filter(Boolean);
  const [pid, setPid] = useState<string>(init?.project_id || (projects.length === 1 ? projects[0].id : ""));
  const [party, setParty] = useState<string>(init?.party || "");
  const [lines, setLines] = useState<any[]>([]);
  const [on, setOn] = useState(false), [hearing, setHearing] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const [typed, setTyped] = useState(""), [sent, setSent] = useState(false), [sure, setSure] = useState(false), [ending, setEnding] = useState(false);
  const want = useRef(false), queue = useRef<string[]>([]), working = useRef(false), sheetId = useRef<string | null>(null), sys = useRef(""), kept = useRef(""), errs = useRef(0), started = useRef(0);
  const now = useRef({ pid, party, lines }); now.current = { pid, party, lines };
  const sl = lang === "ur" ? "ur-PK" : lang === "ar" ? "ar-SA" : "en-US";
  const total = r2(lines.reduce((t, l) => t + area(l), 0));
  const part = (k: string) => r2(lines.filter((l) => (l.system || "") === k).reduce((t, l) => t + area(l), 0));
  const sysName = (k: string) => (k === "channel" ? L("C-channel (steel)", "قناة (حديد)", "چینل (حدید)") : k === "wall" ? L("Wall (plain)", "جدار (سادة)", "دیوار (سادہ)") : "");

  const listen = () => {
    if (!want.current || isSpeaking() || working.current) return;
    try { ExpoSpeechRecognitionModule.start({ lang: speechLang(lang), interimResults: true, continuous: false, contextualStrings: [...WORDS, ...subs].slice(0, 100) } as any); setOn(true); } catch { /* already listening */ }
  };
  /** Say it aloud. The microphone stays off until he taps it for the next place. */
  const tell = (text: string) => { setMsg(text); say(text, { language: sl }); };

  const save = async (next: any[], status = "draft") => {
    const { pid: P, party: W } = now.current;
    if (!P) { setMsg(L("Choose the project.", "اختر المشروع.", "پراجیکٹ چنیں۔")); return false; }
    const row: any = { project_id: P, kind: "measure", party: String(W || "").trim(), lines: next, total: r2(next.reduce((t, l) => t + area(l), 0)), status, heard: next.map((l) => l.heard).filter(Boolean).join(" | ").slice(0, 3000) || null, updated_at: new Date().toISOString(), ...(status === "final" ? { final_at: new Date().toISOString() } : {}) };
    try {
      if (sheetId.current) await update("site_sheets", sheetId.current, row);
      else { const r = await insert("site_sheets", row); sheetId.current = r.data?.id || null; }
      return true;
    } catch (e: any) { setMsg(e.message); return false; }
  };

  const handle = async (text: string) => {
    const short = text.trim().length < 40;
    if (short && STOP.test(text)) { want.current = false; stopListening(); setOn(false); const T = r2(now.current.lines.reduce((t, l) => t + area(l), 0)); setMsg(""); say(L(`Stopped. ${now.current.lines.length} lines, ${money(T)} square metres. Check them, then press Final.`, `توقفت. ${now.current.lines.length} بنود، ${money(T)} متر مربع. راجعها ثم اضغط نهائي.`, `رک گیا۔ ${now.current.lines.length} لائنیں، ${money(T)} میٹر۔ دیکھ کر فائنل دبائیں۔`), { language: sl }); return; }
    if (short && UNDO.test(text)) {
      const cur = now.current.lines; if (!cur.length) { tell(L("Nothing to remove.", "لا يوجد ما يحذف.", "ہٹانے کو کچھ نہیں۔")); return; }
      const next = cur.slice(0, -1); setLines(next); now.current.lines = next; await save(next);
      tell(L(`Last line removed. Total ${money(r2(next.reduce((t, l) => t + area(l), 0)))}.`, `حذف آخر بند. المجموع ${money(r2(next.reduce((t, l) => t + area(l), 0)))}.`, `آخری لائن ہٹا دی۔ کل ${money(r2(next.reduce((t, l) => t + area(l), 0)))} میٹر۔`)); return;
    }
    const { data, error } = await supabase.functions.invoke("site", { body: { kind: "measure", text, lang, names: subs.slice(0, 60) } });
    if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message);
    const r = data as any;
    const said = r.party ? subs.find((x) => x.toLowerCase() === String(r.party).toLowerCase()) : "";
    if (said && now.current.party && said !== now.current.party) switchParty(said);
    if (r.party && !now.current.party) { const hit = subs.find((s) => s.toLowerCase() === String(r.party).toLowerCase()) || String(r.party); setParty(hit); now.current.party = hit; }
    const got = (r.lines || []).map((l: any) => { if (l.system) sys.current = l.system; return { place: l.place || "", element: elemWord(l.element, "ar"), qty: n0(l.qty) > 1 ? n0(l.qty) : 1, l: l.l, w: l.w, deduct: n0(l.deduct) || 0, system: l.system || sys.current || "", photo: "", heard: text }; }).filter((l: any) => n0(l.l) > 0 && n0(l.w) > 0);
    if (!got.length) { tell(/\d/.test(text) ? L("Say the length and the width.", "قل الطول والعرض.", "لمبائی اور چوڑائی بولیں۔") : L(`Ready${now.current.party ? ", " + now.current.party : ""}. Say each place.`, `جاهز${now.current.party ? "، " + now.current.party : ""}. قل كل مكان.`, `تیار${now.current.party ? "، " + now.current.party : ""}۔ ہر جگہ بولتے جائیں۔`)); return; }
    const next = [...now.current.lines, ...got]; setLines(next); now.current.lines = next;
    await save(next);
    const T = r2(next.reduce((t, l) => t + area(l), 0));
    const back = got.map((l: any) => `${mQty(l) > 1 ? mQty(l) + " " : ""}${l.element || l.place || ""} ${l.l} ${L("by", "في", "ضرب")} ${l.w}${n0(l.deduct) ? ` ${L("minus", "خصم", "خصم")} ${l.deduct}` : ""}، ${money(area(l))}`).join("۔ ");
    tell(`${back}۔ ${L("Total", "المجموع", "کل")} ${money(T)}`); // no questions while he measures: the place is written, said back, and he goes on
  };
  const pump = async () => {
    if (working.current) return;
    const text = queue.current.shift(); if (!text) return;
    working.current = true; setBusy(true);
    try { await handle(text); } catch { tell(L("Not understood. Say it again.", "لم أفهم. قلها مرة أخرى.", "سمجھ نہیں آیا۔ دوبارہ بولیں۔")); }
    working.current = false; setBusy(false);
    if (queue.current.length) pump();
  };

  useSpeechRecognitionEvent("result", (e: any) => {
    if (isSpeaking()) return; // its own voice is never written down
    let tr: string = String(e.results?.[0]?.transcript ?? "").trim(); if (!tr) return;
    if (kept.current && tr.startsWith(kept.current)) tr = tr.slice(kept.current.length).trim(); // some phones repeat everything said so far
    if (!tr) return;
    errs.current = 0;
    if (e.isFinal) { want.current = false; stopListening(); setOn(false); kept.current = ""; setHearing(""); queue.current.push(tr); pump(); } else setHearing(tr);
  });
  useSpeechRecognitionEvent("end", () => { if (Date.now() - started.current < 700) return; setOn(false); kept.current = ""; want.current = false; });
  useSpeechRecognitionEvent("error", (e: any) => {
    if (e?.error === "aborted" && Date.now() - started.current < 700) return; // the end of the page before, not of this tap
    setOn(false); kept.current = ""; want.current = false;
    if (e?.error !== "aborted" && e?.error !== "no-speech") setMsg(L("Not heard. Tap and say it again.", "لم أسمع. اضغط وقلها مرة أخرى.", "سنائی نہیں دیا۔ دبا کر دوبارہ بولیں۔"));
  });
  useEffect(() => {
    activateKeepAwakeAsync("measure").catch(() => {});
    (async () => {
      if (!init?.text) return;
      queue.current.push(String(init.text)); pump();
    })();
    return () => { want.current = false; stopListening(); hush(); try { deactivateKeepAwake("measure"); } catch { /* was not on */ } };
  }, []);

  const toggle = async () => {
    if (want.current) { want.current = false; stopListening(); setOn(false); return; }
    hush();
    const p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!p.granted) { setMsg(L("Allow the microphone for this app.", "اسمح بالميكروفون لهذا التطبيق.", "اس ایپ کو مائیک کی اجازت دیں۔")); return; }
    stopListening(); await new Promise((r) => setTimeout(r, 250)); // anything left listening from another page is ended first
    errs.current = 0; want.current = true; started.current = Date.now(); setMsg(""); listen();
  };
  const switchParty = (v: string) => {
    if (v === now.current.party) return;
    if (now.current.lines.length && now.current.party) {
      const was = now.current.party; sheetId.current = null; sys.current = ""; setLines([]); now.current.lines = [];
      if (sent) { setSent(false); setMsg(""); } else setMsg(L(`${was}'s sheet is kept as a draft under Orders & measurements. New sheet: ${v || "—"}.`, `ورقة ${was} محفوظة كمسودة في الطلبات والقياسات. ورقة جديدة: ${v || "—"}.`, `${was} کی شیٹ ڈرافٹ میں محفوظ ہے (آرڈر / پیمائش)۔ نئی شیٹ: ${v || "—"}۔`));
    }
    setParty(v); now.current.party = v;
  };
  const pdf = async () => {
    const en = role === "admin";
    const doc: any = measureDoc(now.current.lines, now.current.party, projects.find((p: any) => p.id === now.current.pid)?.name || "", en);
    try { await makeAndShare(doc, docHTML(doc, en ? "en" : "ar", profile.name)); } catch (e: any) { setMsg(e.message); }
  };
  const addTyped = () => { const t = typed.trim(); if (!t) return; setTyped(""); queue.current.push(t); pump(); };
  const removeAt = async (i: number) => { const next = lines.filter((_, j) => j !== i); setLines(next); now.current.lines = next; await save(next); };
  const finish = async () => {
    if (!sure) { setSure(true); return; }
    setSure(false);
    if (!String(party || "").trim()) { setMsg(L("Choose the subcontractor.", "اختر المقاول.", "ٹھیکیدار چنیں۔")); return; }
    if (!lines.length) { setMsg(L("Add at least one line.", "أضف بندًا واحدًا على الأقل.", "کم از کم ایک لائن ڈالیں۔")); return; }
    want.current = false; stopListening(); setOn(false); setEnding(true);
    if (await save(lines, "final")) { await reload(["site_sheets"]); setSent(true); const m = role === "supervisor" ? L("Sent for approval. The m² are added when Abu or the owner approves.", "أُرسل للاعتماد. تضاف الأمتار بعد الموافقة.", "منظوری کے لیے بھیج دیا۔ منظوری کے بعد میٹر جڑیں گے۔") : L("Saved as final. Open it under Orders & measurements to approve.", "حُفظ نهائيًا. افتحه من الطلبات والقياسات للاعتماد.", "فائنل محفوظ۔ آرڈر اور پیمائش میں کھول کر منظور کریں۔"); setMsg(m); say(m, { language: sl }); await pdf(); }
    setEnding(false);
  };

  return (
    <Sheet open onClose={() => { want.current = false; stopListening(); hush(); reload(["site_sheets"]); onClose(); }} title={L("Measurement sheet", "ورقة القياس", "پیمائش کی شیٹ")}>
      <View style={{ gap: 12 }}>
        <Row wrap>
          <Select label={L("Project", "المشروع", "پراجیکٹ")} value={pid} onChange={(v: string) => setPid(v)} options={[{ value: "", label: "—" }, ...projects.map((p: any) => ({ value: p.id, label: p.name }))]} />
          {subs.length ? <Select label={L("Subcontractor", "المقاول", "ٹھیکیدار")} value={party} onChange={switchParty} options={[{ value: "", label: "—" }, ...[...new Set([...subs, ...(party ? [party] : [])])].map((s) => ({ value: s, label: s }))]} />
            : <Field label={L("Subcontractor", "المقاول", "ٹھیکیدار")} value={party} onChange={(v: string) => { setParty(v); now.current.party = v; }} />}
        </Row>
        {!sent ? <Row style={{ alignItems: "center", gap: 12 }}>
          <Pressable accessibilityRole="button" onPress={toggle} style={({ pressed }) => ({ width: 84, height: 84, borderRadius: 42, borderWidth: 5, borderColor: on ? c.bad : c.accent, backgroundColor: on ? c.badSoft : c.surface, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.8 : 1 })}>
            <Icon name={on ? "stop" : "mic"} size={38} color={on ? c.bad : c.accent} />
          </Pressable>
          <View style={{ flex: 1, gap: 2 }}>
            <T bold size={17}>{busy ? L("Writing…", "أكتب…", "لکھ رہا ہوں…") : on ? L("Listening. Say each place.", "أسمع. قل كل مكان.", "سن رہا ہوں۔ ہر جگہ بولتے جائیں۔") : L("Tap, say one place", "اضغط وقل مكانًا واحدًا", "دبائیں، ایک جگہ بولیں")}</T>
            {hearing ? <T muted size={15}>{hearing}</T> : <T muted size={13}>{L("\"Ghalat\" removes the last line. \"Bas\" stops.", "\"غلط\" يحذف آخر بند. \"بس\" يوقف.", "«غلط»: آخری لائن ہٹے گی۔ «بس»: رک جائے گا۔")}</T>}
          </View>
        </Row> : null}
        {msg ? <T center color={c.warn} size={16}>{msg}</T> : null}
        <View style={{ borderWidth: 1, borderColor: c.line, borderRadius: 10, overflow: "hidden", backgroundColor: c.surface }}>
          <Row style={{ backgroundColor: c.accentSoft, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", gap: 0 }}>
            <T bold size={20} style={{ flex: 1 }}>المجموع</T><T bold size={24}>{money(total)} m²</T>
          </Row>
          {lines.some((l) => l.system) ? <T muted size={13} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>{["wall", "channel", ""].filter((k) => part(k) > 0).map((k) => `${k === "channel" ? "حديد" : k === "wall" ? "سادة" : "—"}: ${money(part(k))}`).join("   ·   ")}</T> : null}
          <Row style={{ backgroundColor: c.sunk, borderTopWidth: 1, borderColor: c.line, gap: 0 }}>
            {HEAD.map(([h, fx], i) => <View key={i} style={[CELL, { flex: fx, borderColor: c.line }]}><T bold size={13}>{h}</T></View>)}
          </Row>
          {lines.map((l, i) => ({ l, i })).reverse().map(({ l, i }) => (
            <Row key={i} style={{ borderTopWidth: 1, borderColor: c.line, gap: 0, alignItems: "stretch", backgroundColor: i === lines.length - 1 ? c.goodSoft : c.surface }}>
              <View style={[CELL, { flex: HEAD[0][1], borderColor: c.line }]}><T muted size={14}>{i + 1}</T></View>
              <View style={[CELL, { flex: HEAD[1][1], borderColor: c.line }]}><T bold size={16}>{[l.element, l.place].filter(Boolean).join(" - ") || "—"}</T>{l.system ? <T muted size={12}>{l.system === "channel" ? "حديد" : "سادة"}</T> : null}</View>
              <View style={[CELL, { flex: HEAD[2][1], borderColor: c.line }]}><T size={16}>{String(mQty(l))}</T></View>
              <View style={[CELL, { flex: HEAD[3][1], borderColor: c.line }]}><T size={16}>{String(l.l)}</T></View>
              <View style={[CELL, { flex: HEAD[4][1], borderColor: c.line }]}><T size={16}>{String(l.w)}</T></View>
              <View style={[CELL, { flex: HEAD[5][1], borderColor: c.line }]}><T bold size={16}>{money(area(l))}</T>{n0(l.deduct) ? <T muted size={12}>خصم {String(l.deduct)}</T> : null}</View>
              <Pressable accessibilityRole="button" accessibilityLabel="remove" disabled={sent} onPress={() => removeAt(i)} style={[CELL, { flex: HEAD[6][1], borderColor: c.line, borderLeftWidth: 0, borderRightWidth: 0, alignItems: "center" }]}><T color={c.bad} size={16}>{sent ? "" : "✕"}</T></Pressable>
            </Row>))}
          {!lines.length ? <T muted style={{ padding: 10 }}>{L("Nothing yet. Example: \"Zar, hadeed, amood 3.2 by 0.6\"", "لا شيء بعد. مثال: \"زر، حديد، عمود 3.2 في 0.6\"", "ابھی کچھ نہیں۔ مثال: «زر، حدید، عمود 3.2 ضرب 0.6»")}</T> : null}
        </View>
        {!sent ? <Row wrap style={{ alignItems: "flex-end" }}>
          <View style={{ flex: 1, minWidth: 180 }}><Field label={L("Or type one place", "أو اكتب مكانًا", "یا ایک جگہ لکھیں")} value={typed} onChange={setTyped} /></View>
          <Btn title={L("Add", "أضف", "ڈالیں")} disabled={!typed.trim() || busy} onPress={addTyped} />
        </Row> : null}
        {!sent ? <Btn big kind="primary" title={sure ? L("Tap again: this is final", "اضغط مرة أخرى: نهائي", "دوبارہ دبائیں: یہ فائنل ہے") : role === "supervisor" ? L("Final: send for approval", "نهائي: أرسل للاعتماد", "فائنل: منظوری کے لیے بھیجیں") : L("Final", "نهائي", "فائنل")} busy={ending} disabled={!lines.length} onPress={finish} style={{ alignSelf: "stretch" }} /> : <Btn big kind="primary" title="PDF" onPress={pdf} style={{ alignSelf: "stretch" }} />}
      </View>
    </Sheet>
  );
}
