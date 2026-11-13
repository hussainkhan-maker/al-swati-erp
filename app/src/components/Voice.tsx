// Voice input: the phone's own speech recognition (Urdu by default), with typing as the fallback.
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import React, { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useData } from "../lib/data";
import { speechLang } from "../lib/i18n";
import { Field, Icon, T, useColors } from "../ui";

export function Voice({ value, onChange, hints = [], placeholder }: { value: string; onChange: (v: string) => void; hints?: string[]; placeholder?: string }) {
  const { t, lang } = useData(); const c = useColors();
  const [on, setOn] = useState(false), [err, setErr] = useState("");
  const base = useRef("");

  useSpeechRecognitionEvent("result", (e: any) => {
    const tr = e.results?.[0]?.transcript ?? "";
    if (tr) onChange((base.current + tr).trim());
    if (e.isFinal && typeof e.results?.[0]?.confidence === "number" && e.results[0].confidence > 0 && e.results[0].confidence < 0.35) setErr(t("voiceUnclear"));
  });
  useSpeechRecognitionEvent("end", () => setOn(false));
  useSpeechRecognitionEvent("error", (e: any) => { setOn(false); if (e.error !== "aborted") setErr(t("voiceUnclear")); });

  const toggle = async () => {
    if (on) { ExpoSpeechRecognitionModule.stop(); return; }
    setErr("");
    const p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!p.granted) { setErr(t("voiceUnclear")); return; }
    base.current = value ? value + " " : "";
    ExpoSpeechRecognitionModule.start({ lang: speechLang(lang), interimResults: true, continuous: true, contextualStrings: hints.slice(0, 100) } as any);
    setOn(true);
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
