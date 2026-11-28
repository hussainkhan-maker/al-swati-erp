// Voice input: the phone's own speech recognition (Urdu by default), with typing as the fallback.
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useData } from "../lib/data";
import { speechLang } from "../lib/i18n";
import { hush, isSpeaking, stopListening } from "../lib/talk";
import { Field, Icon, T, useColors } from "../ui";

export function Voice({ value, onChange, hints = [], placeholder, onDone }: { value: string; onChange: (v: string) => void; hints?: string[]; placeholder?: string; onDone?: () => void }) {
  const { t, lang } = useData(); const c = useColors();
  const [on, setOn] = useState(false), [err, setErr] = useState("");
  const base = useRef(""), kept = useRef(""), starting = useRef(0), held = useRef(false), pressedAt = useRef(0), fire = useRef(false), heard = useRef(false);
  // When he lets go, what he said is acted on at once: no second button to press.
  const doneRef = useRef(onDone); doneRef.current = onDone;
  const finish = () => { if (!fire.current) return; fire.current = false; if (heard.current) setTimeout(() => doneRef.current?.(), 150); };

  useSpeechRecognitionEvent("result", (e: any) => {
    if (isSpeaking()) return; // the app's own voice is never written down
    let tr: string = e.results?.[0]?.transcript ?? "";
    // The phone listens in pieces: after a pause it starts a new piece from nothing. What was already said is kept,
    // so the box never starts again from the beginning while the person is still talking. (Some phones instead repeat
    // everything said so far in each piece: then the part already kept is not written twice.)
    if (kept.current && tr.trim().startsWith(kept.current.trim())) tr = tr.trim().slice(kept.current.trim().length).trim();
    if (tr) onChange((base.current + tr).trim());
    if (tr) heard.current = true;
    if (e.isFinal && !held.current) finish();
    if (tr && e.isFinal) { base.current = (base.current + tr).trim() + " "; kept.current = (kept.current + " " + tr).trim(); }
    if (e.isFinal && typeof e.results?.[0]?.confidence === "number" && e.results[0].confidence > 0 && e.results[0].confidence < 0.35) setErr(t("voiceUnclear"));
  });
  useSpeechRecognitionEvent("end", () => {
    if (held.current) { setTimeout(() => { if (held.current) go(); }, 150); return; } // the phone paused by itself: keep listening while he holds
    if (Date.now() - starting.current > 500) setOn(false);
    finish();
  });
  useSpeechRecognitionEvent("error", (e: any) => {
    if (held.current && (e.error === "no-speech" || e.error === "aborted")) { setTimeout(() => { if (held.current) go(); }, 300); return; }
    if (e.error === "aborted") { if (Date.now() - starting.current > 500) setOn(false); return; }
    setOn(false); if (e.error !== "no-speech") setErr(t("voiceUnclear"));
  });

  // The page is closed (cancel, save, back): the microphone is let go, so the next page can use it.
  useEffect(() => () => { held.current = false; stopListening(); }, []);

  const go = () => { try { ExpoSpeechRecognitionModule.start({ lang: speechLang(lang), interimResults: true, continuous: true, contextualStrings: hints.slice(0, 100) } as any); setOn(true); } catch { /* already listening */ } };
  // Hold to talk: listening starts when the button is pressed and stops the moment it is let go.
  const pressIn = async () => {
    held.current = true; pressedAt.current = Date.now(); setErr(""); hush(); // the person wants to speak: the app stops talking at once
    const p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!p.granted) { held.current = false; setErr(t("voiceUnclear")); return; }
    if (!held.current) return;
    base.current = value ? value + " " : ""; kept.current = "";
    stopListening(); await new Promise((r) => setTimeout(r, 150)); // anything still listening from a cancelled page is ended first
    if (!held.current) return;
    heard.current = false; starting.current = Date.now(); go();
  };
  const pressOut = () => {
    const short = Date.now() - pressedAt.current < 350;
    held.current = false; setOn(false);
    if (short) { stopListening(); setErr(t("holdSpeak")); return; }
    fire.current = true;
    try { ExpoSpeechRecognitionModule.stop(); } catch { /* already stopped */ }
    setTimeout(finish, 1500); // if the phone never reports the end
  };

  return (
    <View style={{ gap: 10, alignItems: "stretch" }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("tapSpeak")} onPressIn={pressIn} onPressOut={pressOut} delayLongPress={100000}
        style={({ pressed }) => ({ alignSelf: "center", width: 132, height: 132, borderRadius: 66, borderWidth: 6, borderColor: on ? c.bad : c.accent, backgroundColor: on ? c.badSoft : c.surface, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.8 : 1 })}>
        <Icon name={on ? "stop" : "mic"} size={54} color={on ? c.bad : c.accent} />
      </Pressable>
      <T center bold size={18}>{on ? t("listening") : t("tapSpeak")}</T>
      {err ? <T center color={c.warn}>{err}</T> : null}
      <Field label={t("orType")} value={value} onChange={onChange} multiline placeholder={placeholder} />
    </View>
  );
}
