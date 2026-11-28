// Teaching the app the team's words. The page shows one word at a time, in Arabic, with its number. The supervisor holds
// the microphone and says it the way he says it on site. What the phone wrote is kept next to the right word, so from then
// on, whenever the phone writes it that way, the app knows which word he means. The list can grow without a new app:
// it is read from preferences "teach_words" when that exists.
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useData } from "../lib/data";
import { speechLang } from "../lib/i18n";
import { supabase } from "../lib/supabase";
import { hush, stopListening } from "../lib/talk";
import { Btn, Icon, Row, Sheet, T, useColors } from "../ui";

export const TEACH_WORDS = ["عمود", "سقف", "جدار", "جدار مستقيم", "كمرة", "باب", "شباك", "درج", "خصم", "خصم باب", "خصم شباك", "طول", "عرض", "متر مربع", "حديد", "سادة", "ديكور", "3 اشاریہ 20", "0 اشاریہ 60", "3 ضرب 3", "طول 4 عرض 2", "زر", "المجدية", "الدرعية", "حجر أبيض", "حجر أصفر", "أبو شرطة", "مجلي", "مسمفر", "غلط", "بس", "زاوية", "غراء"];

export function TeachSheet({ onClose }: { onClose: () => void }) {
  const { d, lang } = useData(); const c = useColors();
  const L = (en: string, ar: string, ur: string) => (lang === "ar" ? ar : lang === "ur" ? ur : en);
  const saved = (d.preferences || []).find((p: any) => p.key === "teach_words")?.value?.list;
  const words: string[] = Array.isArray(saved) && saved.length ? saved : TEACH_WORDS;
  const [i, setI] = useState(0), [on, setOn] = useState(false), [hearing, setHearing] = useState(""), [msg, setMsg] = useState(""), [done, setDone] = useState(0);
  const held = useRef(false), buf = useRef(""), partial = useRef(""), kept = useRef(""), at = useRef(0), idx = useRef(0); idx.current = i;
  const word = words[i];

  const start = () => { try { ExpoSpeechRecognitionModule.start({ lang: speechLang(lang), interimResults: true, continuous: true } as any); setOn(true); } catch { /* already listening */ } };
  const keep = async () => {
    const heard = (buf.current + " " + partial.current).trim(); buf.current = ""; partial.current = ""; kept.current = ""; setHearing("");
    if (!heard) return;
    const w = words[idx.current];
    try { await supabase.rpc("teach_term", { p_said: heard, p_means: w }); } catch { /* kept next time */ }
    setDone((n) => n + 1);
    setMsg(L(`Heard: "${heard}". Saved as ${w}.`, `سمعت: «${heard}». حُفظت: ${w}.`, `سنا: «${heard}»۔ محفوظ: ${w}`));
    setTimeout(() => { if (idx.current < words.length - 1 && !held.current) { setI(idx.current + 1); setMsg(""); } }, 1400);
  };
  useSpeechRecognitionEvent("result", (e: any) => {
    let tr: string = String(e.results?.[0]?.transcript ?? "").trim(); if (!tr) return;
    if (kept.current && tr.startsWith(kept.current)) tr = tr.slice(kept.current.length).trim();
    if (!tr) return;
    if (e.isFinal) { kept.current = (kept.current + " " + tr).trim(); buf.current = (buf.current + " " + tr).trim(); partial.current = ""; setHearing(buf.current); if (!held.current) keep(); }
    else { partial.current = tr; setHearing((buf.current + " " + tr).trim()); }
  });
  useSpeechRecognitionEvent("end", () => { kept.current = ""; if (held.current) { setTimeout(() => { if (held.current) start(); }, 150); return; } setOn(false); keep(); });
  useSpeechRecognitionEvent("error", () => { kept.current = ""; if (held.current) { setTimeout(() => { if (held.current) start(); }, 300); return; } setOn(false); keep(); });
  useEffect(() => () => { held.current = false; stopListening(); }, []);

  const pressIn = async () => {
    held.current = true; at.current = Date.now(); hush(); setMsg(""); buf.current = ""; partial.current = ""; kept.current = "";
    const p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!p.granted) { held.current = false; setMsg(L("Allow the microphone for this app.", "اسمح بالميكروفون لهذا التطبيق.", "اس ایپ کو مائیک کی اجازت دیں۔")); return; }
    if (!held.current) return;
    stopListening(); await new Promise((r) => setTimeout(r, 150));
    if (held.current) start();
  };
  const pressOut = () => {
    const short = Date.now() - at.current < 350; held.current = false;
    if (short && !buf.current && !partial.current) { stopListening(); setOn(false); setMsg(L("Hold the button while you say the word.", "اضغط مطولًا وأنت تقول الكلمة.", "لفظ بولتے وقت بٹن دبا کر رکھیں۔")); return; }
    try { ExpoSpeechRecognitionModule.stop(); } catch { /* already stopped */ }
    setTimeout(() => { if (!held.current && (buf.current || partial.current)) { setOn(false); keep(); } }, 1500);
  };

  return (
    <Sheet open onClose={() => { held.current = false; stopListening(); onClose(); }} title={L("Teach the app your words", "علّم التطبيق كلماتكم", "ایپ کو اپنے الفاظ سکھائیں")}>
      <View style={{ gap: 14, alignItems: "center" }}>
        <T muted size={15}>{i + 1} / {words.length}</T>
        <View style={{ backgroundColor: "#FFFFFF", borderRadius: 14, borderWidth: 1, borderColor: "#BDBDBD", paddingVertical: 22, paddingHorizontal: 18, alignSelf: "stretch", alignItems: "center" }}>
          <T bold size={40} color="#000000" center>{word}</T>
        </View>
        <Pressable accessibilityRole="button" onPressIn={pressIn} onPressOut={pressOut} delayLongPress={100000} style={({ pressed }) => ({ width: 120, height: 120, borderRadius: 60, borderWidth: 6, borderColor: on ? c.bad : c.accent, backgroundColor: on ? c.badSoft : c.surface, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.8 : 1 })}>
          <Icon name={on ? "stop" : "mic"} size={50} color={on ? c.bad : c.accent} />
        </Pressable>
        <T center bold size={17}>{on ? L("Listening… let go when done", "أسمع… اترك عند الانتهاء", "سن رہا ہوں… بول کر چھوڑ دیں") : L("Hold the button and say this word", "اضغط مطولًا وقل هذه الكلمة", "بٹن دبا کر رکھیں اور یہ لفظ بولیں")}</T>
        {hearing ? <T center muted size={16}>{hearing}</T> : null}
        {msg ? <T center color={c.good} size={16}>{msg}</T> : null}
        <Row wrap style={{ alignSelf: "stretch", justifyContent: "space-between" }}>
          <Btn kind="ghost" title={L("Back", "السابق", "پچھلا")} disabled={i === 0} onPress={() => { setI(i - 1); setMsg(""); }} />
          <T muted size={14}>{L(`${done} saved`, `حُفظ ${done}`, `${done} محفوظ`)}</T>
          <Btn kind="ghost" title={i < words.length - 1 ? L("Next", "التالي", "اگلا") : L("Done", "تم", "مکمل")} onPress={() => { if (i < words.length - 1) { setI(i + 1); setMsg(""); } else onClose(); }} />
        </Row>
        <T center muted size={13}>{L("Say each word the way you say it on site. You can say a word again: both ways are kept.", "قل كل كلمة كما تقولها في الموقع. يمكنك إعادتها: تُحفظ الطريقتان.", "ہر لفظ ویسے بولیں جیسے سائٹ پر بولتے ہیں۔ دوبارہ بھی بول سکتے ہیں: دونوں طریقے محفوظ ہوں گے۔")}</T>
      </View>
    </Sheet>
  );
}
