// Voice input: the phone's own speech recognition (Urdu by default), with typing as the fallback.
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useData } from "../lib/data";
import { speechLang } from "../lib/i18n";
import { hush, isSpeaking, stopListening } from "../lib/talk";
import { Field, Icon, T, useColors } from "../ui";

export function Voice({ value, onChange, hints = [], placeholder }: { value: string; onChange: (v: string) => void; hints?: string[]; placeholder?: string }) {
  const { t, lang } = useData(); const c = useColors();
  const [on, setOn] = useState(false), [err, setErr] = useState("");
  const base = useRef(""), kept = useRef(""), starting = useRef(0);

  useSpeechRecognitionEvent("result", (e: any) => {
    if (isSpeaking()) return; // the app's own voice is never written down
    let tr: string = e.results?.[0]?.transcript ?? "";
    // The phone listens in pieces: after a pause it starts a new piece from nothing. What was already said is kept,
    // so the box never starts again from the beginning while the person is still talking. (Some phones instead repeat
    // everything said so far in each piece: then the part already kept is not written twice.)
    if (kept.current && tr.trim().startsWith(kept.current.trim())) tr = tr.trim().slice(kept.current.trim().length).trim();
    if (tr) onChange((base.current + tr).trim());
    if (tr && e.isFinal) { base.current = (base.current + tr).trim() + " "; kept.current = (kept.current + " " + tr).trim(); }
    if (e.isFinal && typeof e.results?.[0]?.confidence === "number" && e.results[0].confidence > 0 && e.results[0].confidence < 0.35) setErr(t("voiceUnclear"));
  });
  useSpeechRecognitionEvent("end", () => { if (Date.now() - starting.current > 700) setOn(false); });
  useSpeechRecognitionEvent("error", (e: any) => { if (e.error === "aborted") { if (Date.now() - starting.current > 700) setOn(false); return; } setOn(false); if (e.error !== "no-speech") setErr(t("voiceUnclear")); });

  // The page is closed (cancel, save, back): the microphone is let go, so the next page can use it.
  useEffect(() => () => { stopListening(); }, []);

  const toggle = async () => {
    if (on) { setOn(false); try { ExpoSpeechRecognitionModule.stop(); } catch { /* already stopped */ } return; }
    setErr(""); hush(); // the person wants to speak: the app stops talking at once
    const p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!p.granted) { setErr(t("voiceUnclear")); return; }
    base.current = value ? value + " " : ""; kept.current = "";
    // Anything still listening from before (a page that was cancelled) is ended first; the phone refuses a second start otherwise.
    stopListening();
    await new Promise((r) => setTimeout(r, 250));
    const go = () => ExpoSpeechRecognitionModule.start({ lang: speechLang(lang), interimResults: true, continuous: true, contextualStrings: hints.slice(0, 100) } as any);
    try { go(); } catch { await new Promise((r) => setTimeout(r, 600)); try { go(); } catch { setErr(t("voiceUnclear")); return; } }
    starting.current = Date.now(); setOn(true);
  };

  return (
    <View style={{ gap: 10, alignItems: "stretch" }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("tapSpeak")} onPress={toggle}
        style={({ pressed }) => ({ alignSelf: "center", width: 132, height: 132, borderRadius: 66, borderWidth: 6, borderColor: on ? c.bad : c.accent, backgroundColor: on ? c.badSoft : c.surface, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.8 : 1 })}>
        <Icon name={on ? "stop" : "mic"} size={54} color={on ? c.bad : c.accent} />
      </Pressable>
      <T center bold size={18}>{on ? t("listening") : t("tapSpeak")}</T>
      {err ? <T center color={c.warn}>{err}</T> : null}
      <Field label={t("orType")} value={value} onChange={onChange} multiline placeholder={placeholder} />
    </View>
  );
}
