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
import { mArea, mGross, mIsDed, mQty, mValid, measureDoc, quickLine } from "../lib/measure";
import { docHTML, makeAndShare } from "../lib/pdf";
import { supabase } from "../lib/supabase";
import { hush, isSpeaking, say, stopListening } from "../lib/talk";
import { Btn, Card, Field, Icon, Row, Select, Sheet, T, useColors } from "../ui";

const n0 = (v: any) => { const x = num(v); return Number.isFinite(x) ? x : 0; };
const area = mArea;
const WORDS = ["خصم", "خصم دروازہ", "خصم کھڑکی", "خصم باب", "خصم شباك", "عمود", "سقف", "جدار", "دیوار", "طول", "عرض", "حدید", "سادہ", "چینل", "شانل", "ضرب", "في", "میٹر", "غلط", "بس"];
const ELEM: [RegExp, string, string][] = [[/seedh|straight|مستقيم|سیدھ/i, "جدار مستقيم", "سیدھی دیوار"], [/amood|amoot|amud|amod|column|pillar|عمود|اموت|امود|ستون|अमूद|अमूत|आमूद/i, "عمود", "عمود"], [/saqaf|saqf|sakaf|ceiling|soffit|سقف|صقف|چھت/i, "سقف", "سقف"], [/beam|kamra|camera|كمرة|کمرہ|کیمرہ|بیم|कैमरा/i, "كمرة", "بیم"], [/deewar|diwar|dewar|wall|jidar|جدار|دیوار|जेदार|जिदार|दीवार/i, "جدار", "دیوار"], [/darwaza|door|باب|دروازہ/i, "باب", "دروازہ"], [/khirki|window|شباك|شبابيك|شبابیک|نافذة|کھڑکی|खिड़की/i, "شباك", "کھڑکی"], [/zeena|stair|درج|سیڑھ/i, "درج", "سیڑھی"]];
const elemWord = (e: any, lang: string) => { const t = String(e || "").trim(); if (!t || lang === "en") return t; const hit = ELEM.find(([re]) => re.test(t)); return hit ? (lang === "ar" ? hit[1] : hit[2]) : t; };
const UNDO = /(गलत|ग़लत|غلط|ghalat|galat|مٹا|mita|ہٹا|hata|wrong|delete|undo|احذف|امسح|خطأ|کاٹ)/i;
const STOP = /^\s*(बस|bas|بس|khatam|ختم|ho gaya|ہو گیا|خلاص|خلص|finish|done|stop|رک جا|ruk)/i;

/** The sheet's columns, written the way the subcontractors' paper is: item, length, width, length × width. */
const HEAD: [string, number][] = [["#", 0.5], ["البند", 2], ["العدد", 0.8], ["الطول", 1], ["العرض", 1], ["م²", 1.2], ["", 0.5]];
/** The sheet is paper: always white with black writing, in light and dark mode, so it reads in the sun. */
const P = { bg: "#FFFFFF", ink: "#000000", soft: "#3C3C3C", line: "#BDBDBD", head: "#EFEFEF", fresh: "#E3F3E6", dedBg: "#FCE9E7", ded: "#B3261E" };
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
  const want = useRef(false), queue = useRef<string[]>([]), working = useRef(false), sheetId = useRef<string | null>(null), sys = useRef(""), kept = useRef(""), errs = useRef(0), started = useRef(0), held = useRef(false), pressedAt = useRef(0), buf = useRef(""), partial = useRef("");
  const now = useRef({ pid, party, lines }); now.current = { pid, party, lines };
  const sl = lang === "ur" ? "ur-PK" : lang === "ar" ? "ar-SA" : "en-US";
  const total = r2(lines.reduce((t, l) => t + area(l), 0));
  const part = (k: string) => r2(lines.filter((l) => (l.system || "") === k).reduce((t, l) => t + area(l), 0));
  const sysName = (k: string) => (k === "channel" ? L("C-channel (steel)", "قناة (حديد)", "چینل (حدید)") : k === "wall" ? L("Wall (plain)", "جدار (سادة)", "دیوار (سادہ)") : "");

  const listen = () => {
    if (!want.current) return;
    try { ExpoSpeechRecognitionModule.start({ lang: speechLang(lang), interimResults: true, continuous: true, contextualStrings: [...WORDS, ...subs].slice(0, 100) } as any); setOn(true); } catch { /* already listening */ }
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
    // On this page "qisam / قسم" is always the microphone mishearing "khasam / خصم" (deduction): it is put right before reading.
    const fixed = text.replace(/قسم|کسم|كسم|خسم|قصم|حسم|کسام|خصام|قسام|खसम|कसम|क़िस्म|किस्म|क़सम/g, "خصم").replace(/\b(qisam|kisam|qasam|kasam|qism|khasm|hasam|kasm|kassam|qasim)\b/gi, "khasam")
      // "3 ishariya 20" is how he says 3.20
      .replace(/(\d+)\s*(?:ishariya|ishariye|ashariya|asharia|اشاریہ|اشاریے|اعشاریہ|عشاریہ|اشاریا|فاصلة|فاصله|point|پوائنٹ)\s*(\d+)/gi, "$1.$2");
    // A plain entry is read on the phone at once; only a sentence with a name, a place or anything unclear goes to the server.
    const quick = quickLine(fixed);
    let r: any;
    if (quick) r = { party: "", lines: [quick] };
    else {
      const { data, error } = await supabase.functions.invoke("site", { body: { kind: "measure", text: fixed, lang, names: subs.slice(0, 60) } });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message);
      r = data as any;
    }
    const said = r.party ? subs.find((x) => x.toLowerCase() === String(r.party).toLowerCase()) : "";
    if (said && now.current.party && said !== now.current.party) switchParty(said);
    if (r.party && !now.current.party) { const hit = subs.find((s) => s.toLowerCase() === String(r.party).toLowerCase()) || String(r.party); setParty(hit); now.current.party = hit; }
    const got = (r.lines || []).map((l: any) => { if (l.system) sys.current = l.system; return { ...(l.ded ? { ded: true } : {}), ...(n0(l.m2) > 0 ? { m2: n0(l.m2) } : {}), place: l.place || "", element: elemWord(l.element, "ar"), qty: n0(l.qty) > 1 ? n0(l.qty) : 1, l: l.l, w: l.w, deduct: n0(l.deduct) || 0, system: l.system || sys.current || "", photo: "", heard: text }; }).filter(mValid);
    if (!got.length) { tell(/\d/.test(text) ? L("I heard one size only. Say it with a word between: 3 zarb 3, or tool 3 ardh 3.", "سمعت مقاسًا واحدًا فقط. قلها هكذا: 3 ضرب 3، أو طول 3 عرض 3.", "صرف ایک ناپ سنا۔ ایسے بولیں: 3 ضرب 3، یا طول 3 عرض 3۔") : L(`Ready${now.current.party ? ", " + now.current.party : ""}. Say each place.`, `جاهز${now.current.party ? "، " + now.current.party : ""}. قل كل مكان.`, `تیار${now.current.party ? "، " + now.current.party : ""}۔ ہر جگہ بولتے جائیں۔`)); return; }
    const next = [...now.current.lines, ...got]; setLines(next); now.current.lines = next;
    await save(next);
    const T = r2(next.reduce((t, l) => t + area(l), 0));
    const back = got.map((l: any) => { const sized = n0(l.l) > 0 && n0(l.w) > 0; return `${mIsDed(l) ? L("deduction ", "خصم ", "خصم ") : ""}${mQty(l) > 1 ? mQty(l) + " " : ""}${l.element || l.place || ""}${sized ? ` ${l.l} ${L("by", "في", "ضرب")} ${l.w}` : ""}${n0(l.deduct) ? ` ${L("minus", "خصم", "خصم")} ${l.deduct}` : ""}، ${money(mGross(l))}`; }).join("۔ ");
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

  // Hold to talk: while the button is held, everything heard is collected; when he lets go, that is one entry.
  const flush = () => { const t = (buf.current + " " + partial.current).trim(); buf.current = ""; partial.current = ""; kept.current = ""; setHearing(""); if (t) { queue.current.push(t); pump(); } };
  useSpeechRecognitionEvent("result", (e: any) => {
    if (isSpeaking()) return; // its own voice is never written down
    let tr: string = String(e.results?.[0]?.transcript ?? "").trim(); if (!tr) return;
    if (kept.current && tr.startsWith(kept.current)) tr = tr.slice(kept.current.length).trim(); // some phones repeat everything said so far
    if (!tr) return;
    if (e.isFinal) { kept.current = (kept.current + " " + tr).trim(); buf.current = (buf.current + " " + tr).trim(); partial.current = ""; setHearing(buf.current); if (!held.current) flush(); }
    else { partial.current = tr; setHearing((buf.current + " " + tr).trim()); }
  });
  useSpeechRecognitionEvent("end", () => {
    if (Date.now() - started.current < 500 && held.current) return; // the end of an earlier page, not of this hold
    kept.current = "";
    if (held.current) { setTimeout(() => { if (held.current) listen(); }, 150); return; } // the phone stopped by itself in a pause: keep listening while he holds
    setOn(false); want.current = false; flush();
  });
  useSpeechRecognitionEvent("error", (e: any) => {
    if (e?.error === "aborted" && Date.now() - started.current < 500) return;
    kept.current = "";
    if (held.current && (e?.error === "no-speech" || e?.error === "aborted")) { setTimeout(() => { if (held.current) listen(); }, 300); return; }
    setOn(false); want.current = false;
    if (buf.current || partial.current) { flush(); return; }
    if (e?.error !== "aborted" && e?.error !== "no-speech") setMsg(L("Not heard. Hold the button and say it again.", "لم أسمع. اضغط مطولًا وقلها مرة أخرى.", "سنائی نہیں دیا۔ بٹن دبا کر رکھیں اور دوبارہ بولیں۔"));
  });
  useEffect(() => {
    activateKeepAwakeAsync("measure").catch(() => {});
    (async () => {
      if (!init?.text) return;
      queue.current.push(String(init.text)); pump();
    })();
    return () => { want.current = false; stopListening(); hush(); try { deactivateKeepAwake("measure"); } catch { /* was not on */ } };
  }, []);

  const pressIn = async () => {
    held.current = true; pressedAt.current = Date.now(); hush(); setMsg(""); buf.current = ""; partial.current = ""; kept.current = "";
    const p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!p.granted) { held.current = false; setMsg(L("Allow the microphone for this app.", "اسمح بالميكروفون لهذا التطبيق.", "اس ایپ کو مائیک کی اجازت دیں۔")); return; }
    if (!held.current) return; // he already let go (the permission question was on the screen)
    stopListening(); await new Promise((r) => setTimeout(r, 150)); // anything left listening from another page is ended first
    if (!held.current) return;
    want.current = true; started.current = Date.now(); listen();
  };
  const pressOut = () => {
    const short = Date.now() - pressedAt.current < 350;
    held.current = false;
    if (short && !buf.current && !partial.current) { want.current = false; stopListening(); setOn(false); setMsg(L("Hold the button while you talk. Let go when done.", "اضغط مطولًا وأنت تتكلم، واترك عند الانتهاء.", "بولتے وقت بٹن دبا کر رکھیں۔ بات ختم ہو تو چھوڑ دیں۔")); return; }
    try { ExpoSpeechRecognitionModule.stop(); } catch { /* already stopped */ }
    // If the phone never reports the end, what was heard is still written.
    setTimeout(() => { if (!held.current && (buf.current || partial.current)) { setOn(false); want.current = false; flush(); } }, 1500);
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
          <Pressable accessibilityRole="button" onPressIn={pressIn} onPressOut={pressOut} delayLongPress={100000} style={({ pressed }) => ({ width: 84, height: 84, borderRadius: 42, borderWidth: 5, borderColor: on ? c.bad : c.accent, backgroundColor: on ? c.badSoft : c.surface, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.8 : 1 })}>
            <Icon name={on ? "stop" : "mic"} size={38} color={on ? c.bad : c.accent} />
          </Pressable>
          <View style={{ flex: 1, gap: 2 }}>
            <T bold size={17}>{busy ? L("Writing…", "أكتب…", "لکھ رہا ہوں…") : on ? L("Listening… let go when done", "أسمع… اترك عند الانتهاء", "سن رہا ہوں… بات ختم ہو تو چھوڑ دیں") : L("Hold and talk. Let go when done.", "اضغط مطولًا وتكلم، واترك عند الانتهاء", "دبا کر رکھیں اور بولیں۔ چھوڑیں تو رک جائے گا")}</T>
            {hearing ? <T muted size={15}>{hearing}</T> : <T muted size={13}>{L("\"Ghalat\" removes the last line. \"Bas\" stops.", "\"غلط\" يحذف آخر بند. \"بس\" يوقف.", "«غلط»: آخری لائن ہٹے گی۔ «بس»: رک جائے گا۔")}</T>}
          </View>
        </Row> : null}
        {msg ? <T center color={c.warn} size={16}>{msg}</T> : null}
        <View style={{ borderWidth: 1, borderColor: P.line, borderRadius: 10, overflow: "hidden", backgroundColor: P.bg }}>
          <Row style={{ backgroundColor: P.head, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", gap: 0 }}>
            <View style={{ flex: 1 }}><T color={P.ink} bold size={20}>المجموع</T>{lines.some(mIsDed) ? <T size={13} color={P.ded}>خصم: {money(r2(lines.filter(mIsDed).reduce((t, l) => t + area(l), 0)))}</T> : null}</View><T color={P.ink} bold size={24}>{money(total)} m²</T>
          </Row>
          {lines.some((l) => l.system) ? <T color={P.soft} size={13} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>{["wall", "channel", ""].filter((k) => part(k) > 0).map((k) => `${k === "channel" ? "حديد" : k === "wall" ? "سادة" : "—"}: ${money(part(k))}`).join("   ·   ")}</T> : null}
          <Row style={{ backgroundColor: P.head, borderTopWidth: 1, borderColor: P.line, gap: 0 }}>
            {HEAD.map(([h, fx], i) => <View key={i} style={[CELL, { flex: fx, borderColor: P.line }]}><T color={P.ink} bold size={13}>{h}</T></View>)}
          </Row>
          {lines.map((l, i) => ({ l, i })).reverse().map(({ l, i }) => (
            <Row key={i} style={{ borderTopWidth: 1, borderColor: P.line, gap: 0, alignItems: "stretch", backgroundColor: mIsDed(l) ? P.dedBg : i === lines.length - 1 ? P.fresh : P.bg }}>
              <View style={[CELL, { flex: HEAD[0][1], borderColor: P.line }]}><T color={P.soft} size={14}>{i + 1}</T></View>
              <View style={[CELL, { flex: HEAD[1][1], borderColor: P.line }]}><T bold size={16} color={mIsDed(l) ? P.ded : P.ink}>{[mIsDed(l) ? "خصم" : "", l.element, l.place].filter(Boolean).join(" - ") || "—"}</T>{l.system ? <T color={P.soft} size={12}>{l.system === "channel" ? "حديد" : "سادة"}</T> : null}</View>
              <View style={[CELL, { flex: HEAD[2][1], borderColor: P.line }]}><T color={P.ink} size={16}>{String(mQty(l))}</T></View>
              <View style={[CELL, { flex: HEAD[3][1], borderColor: P.line }]}><T color={P.ink} size={16}>{n0(l.l) > 0 ? String(l.l) : ""}</T></View>
              <View style={[CELL, { flex: HEAD[4][1], borderColor: P.line }]}><T color={P.ink} size={16}>{n0(l.w) > 0 ? String(l.w) : ""}</T></View>
              <View style={[CELL, { flex: HEAD[5][1], borderColor: P.line }]}><T bold size={16} color={mIsDed(l) ? P.ded : P.ink}>{money(area(l))}</T>{n0(l.deduct) ? <T color={P.soft} size={12}>خصم {String(l.deduct)}</T> : null}</View>
              <Pressable accessibilityRole="button" accessibilityLabel="remove" disabled={sent} onPress={() => removeAt(i)} style={[CELL, { flex: HEAD[6][1], borderColor: P.line, borderLeftWidth: 0, borderRightWidth: 0, alignItems: "center" }]}><T color={P.ded} size={16}>{sent ? "" : "✕"}</T></Pressable>
            </Row>))}
          {!lines.length ? <T color={P.soft} style={{ padding: 10 }}>{L("Nothing yet. Example: \"Zar, hadeed, amood 3.2 by 0.6\"", "لا شيء بعد. مثال: \"زر، حديد، عمود 3.2 في 0.6\"", "ابھی کچھ نہیں۔ مثال: «عمود 3 اشاریہ 20 ضرب 0 اشاریہ 60»")}</T> : null}
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
