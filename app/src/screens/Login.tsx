// Sign-in with a one-time code sent to the person's email. Super-Admin adds people first; nobody can sign up alone.
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { useColors } from "../ui";

export default function Login({ problem }: { problem?: string }) {
  const c = useColors();
  const [email, setEmail] = useState(""), [code, setCode] = useState(""), [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(problem || "");
  const input = { minHeight: 56, borderWidth: 1, borderColor: c.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 18, color: c.ink, backgroundColor: c.surface } as const;
  const btn = (label: string, on: () => void, disabled?: boolean) => (
    <Text accessibilityRole="button" onPress={disabled || busy ? undefined : on}
      style={{ minHeight: 56, lineHeight: 56, textAlign: "center", borderRadius: 14, backgroundColor: c.accent, color: c.accentInk, fontSize: 18, fontWeight: "700", overflow: "hidden", opacity: disabled || busy ? 0.5 : 1 }}>{busy ? "…" : label}</Text>);

  const send = async () => {
    setBusy(true); setMsg("");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) setMsg(/not found|signups/i.test(error.message) ? "This email is not registered. Ask Super-Admin to add you." : error.message);
    else { setSent(true); setMsg("We sent a 6-digit code to your email. / أرسلنا رمزاً من 6 أرقام إلى بريدك. / آپ کی ای میل پر 6 ہندسوں کا کوڈ بھیجا ہے۔"); }
  };
  const verify = async () => {
    setBusy(true); setMsg("");
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setMsg("That code is not right or has expired. Ask for a new one.");
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 16, flexGrow: 1, justifyContent: "center" }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 28, fontWeight: "800", color: c.ink }}>Al-Swati ERP</Text>
            <Text style={{ fontSize: 15, color: c.muted }}>Stone · Marble · Granite · Porcelain · Flooring</Text>
          </View>
          <TextInput style={input} value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={c.muted} autoCapitalize="none" keyboardType="email-address" editable={!sent} />
          {sent && <TextInput style={[input, { letterSpacing: 6, textAlign: "center" }]} value={code} onChangeText={setCode} placeholder="123456" placeholderTextColor={c.muted} keyboardType="number-pad" maxLength={6} />}
          {!sent ? btn("Send code / أرسل الرمز / کوڈ بھیجیں", send, !/.+@.+\..+/.test(email)) : btn("Sign in / دخول / داخل ہوں", verify, code.trim().length !== 6)}
          {sent && <Text onPress={() => { setSent(false); setCode(""); }} style={{ color: c.accent, textAlign: "center", fontSize: 16, padding: 8 }}>Change email</Text>}
          {msg ? <Text style={{ color: c.muted, fontSize: 15, textAlign: "center" }}>{msg}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
