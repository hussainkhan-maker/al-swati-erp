// Sign-in with email + password. Super-Admin adds people with a starting password; nobody can sign up alone.
// The first time, the person sets their own password. Forgot it → Super-Admin sets a new starting one (from More → People)
// and sends it to the person's phone number. Daily opening is by the phone's own Face ID / fingerprint / PIN (Shell).
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { useColors } from "../ui";

function Frame({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 16, flexGrow: 1, justifyContent: "center", width: "100%", maxWidth: 440, alignSelf: "center" }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 28, fontWeight: "800", color: c.ink }}>AL-Swati</Text>
            <Text style={{ fontSize: 15, color: c.muted }}>Stone · Marble · Granite · Porcelain</Text>
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function useParts() {
  const c = useColors();
  const input = { minHeight: 56, borderWidth: 1, borderColor: c.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 18, color: c.ink, backgroundColor: c.surface } as const;
  const btn = (label: string, on: () => void, disabled?: boolean, busy?: boolean) => (
    <Text accessibilityRole="button" onPress={disabled || busy ? undefined : on}
      style={{ minHeight: 56, lineHeight: 56, textAlign: "center", borderRadius: 14, backgroundColor: c.accent, color: c.accentInk, fontSize: 18, fontWeight: "700", overflow: "hidden", opacity: disabled || busy ? 0.5 : 1 }}>{busy ? "…" : label}</Text>);
  return { c, input, btn };
}

export default function Login({ problem }: { problem?: string }) {
  const { c, input, btn } = useParts();
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(problem || ""), [forgot, setForgot] = useState(false);

  const signIn = async () => {
    setBusy(true); setMsg("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: pw });
    setBusy(false);
    if (error) setMsg(/invalid/i.test(error.message)
      ? "Email or password is not right. / البريد أو كلمة المرور غير صحيحة. / ای میل یا پاس ورڈ غلط ہے۔"
      : error.message);
  };

  return (
    <Frame>
      <TextInput style={input} value={email} onChangeText={setEmail} placeholder="Email (Gmail)" placeholderTextColor={c.muted} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <View>
        <TextInput style={input} value={pw} onChangeText={setPw} placeholder="Password / كلمة المرور / پاس ورڈ" placeholderTextColor={c.muted} secureTextEntry={!show} autoCapitalize="none" autoComplete="password" />
        <Text onPress={() => setShow(!show)} style={{ position: "absolute", right: 14, top: 16, color: c.accent, fontSize: 15 }}>{show ? "Hide" : "Show"}</Text>
      </View>
      {btn("Sign in / دخول / داخل ہوں", signIn, !/.+@.+\..+/.test(email) || pw.length < 8, busy)}
      <Text onPress={() => setForgot(!forgot)} style={{ color: c.accent, textAlign: "center", fontSize: 16, padding: 8 }}>Forgot password? / نسيت كلمة المرور؟ / پاس ورڈ بھول گئے؟</Text>
      {forgot && <Text style={{ color: c.muted, fontSize: 15, textAlign: "center" }}>
        Call or WhatsApp Super-Admin. They set a new starting password and send it to your phone number; then you choose your own.{"\n"}
        اتصل بالمدير ليرسل لك كلمة مرور جديدة على رقمك.{"\n"}
        Super-Admin کو فون یا واٹس ایپ کریں، وہ آپ کے نمبر پر نیا پاس ورڈ بھیجیں گے۔
      </Text>}
      {msg ? <Text style={{ color: c.muted, fontSize: 15, textAlign: "center" }}>{msg}</Text> : null}
    </Frame>
  );
}

/** Shown once after Super-Admin gives a starting password: the person picks their own. */
export function SetPassword({ onDone }: { onDone: () => void }) {
  const { c, input, btn } = useParts();
  const [a, setA] = useState(""), [b, setB] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const weak = a.length < 8 || !/\d/.test(a) || !/[A-Za-z]/.test(a);
  const save = async () => {
    setBusy(true); setMsg("");
    const { error } = await supabase.auth.updateUser({ password: a, data: { temp_password: false } });
    setBusy(false);
    if (error) setMsg(error.message); else onDone();
  };
  return (
    <Frame>
      <Text style={{ fontSize: 18, fontWeight: "700", color: c.ink }}>Choose your own password / اختر كلمة مرورك / اپنا پاس ورڈ رکھیں</Text>
      <Text style={{ fontSize: 15, color: c.muted }}>At least 8 characters, with letters and numbers. Only you will know it.</Text>
      <TextInput style={input} value={a} onChangeText={setA} placeholder="New password" placeholderTextColor={c.muted} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
      <TextInput style={input} value={b} onChangeText={setB} placeholder="Same password again" placeholderTextColor={c.muted} secureTextEntry autoCapitalize="none" />
      {a.length > 0 && weak && <Text style={{ color: c.bad, fontSize: 15 }}>Use 8 or more characters with letters and numbers.</Text>}
      {b.length > 0 && a !== b && <Text style={{ color: c.bad, fontSize: 15 }}>The two passwords are not the same.</Text>}
      {btn("Save / حفظ / محفوظ کریں", save, weak || a !== b, busy)}
      {msg ? <Text style={{ color: c.muted, fontSize: 15, textAlign: "center" }}>{msg}</Text> : null}
    </Frame>
  );
}
