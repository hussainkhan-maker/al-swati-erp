// Sign-in with email + password. Super-Admin adds people with a starting password; nobody can sign up alone.
// The first time, the person sets their own password. Forgot it → Super-Admin sets a new starting one (from More → People)
// and sends it to the person's phone number. Daily opening is by the phone's own Face ID / fingerprint / PIN (Shell).
// Security on this screen: one message for every wrong sign-in (never says whether the email exists), a growing wait after
// repeated wrong tries (kept on the device, on top of the server's own limits), and strong own-password rules.
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { DEEP, Marble, Rise, useColors, useWide } from "../ui";

const web = Platform.OS === "web";
const calm = web && typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const LOCK_KEY = "al-swati:signin-tries";
const WRONG = "Email or password is not right. / البريد أو كلمة المرور غير صحيحة. / ای میل یا پاس ورڈ غلط ہے۔";

/** The marble slab behind the logo: veins drift very slowly, the mark fades in once. */
function Slab({ tall }: { tall: boolean }) {
  const drift = useRef(new Animated.Value(0)).current, show = useRef(new Animated.Value(calm ? 1 : 0)).current;
  useEffect(() => {
    if (calm) return;
    Animated.timing(show, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: !web }).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 16000, easing: Easing.inOut(Easing.sin), useNativeDriver: !web }),
      Animated.timing(drift, { toValue: 0, duration: 16000, easing: Easing.inOut(Easing.sin), useNativeDriver: !web }),
    ]));
    loop.start(); return () => loop.stop();
  }, []);
  return (
    <View style={{ backgroundColor: DEEP.bg, overflow: "hidden", justifyContent: tall ? "space-between" : "flex-end", padding: tall ? 48 : 24, paddingTop: tall ? 48 : 56, minHeight: tall ? undefined : 220, flex: tall ? 1 : undefined }}>
      <Animated.View style={{ position: "absolute", top: -40, left: -60, right: -60, bottom: -40, transform: [{ translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [-30, 30] }) }, { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [10, -10] }) }] }}>
        <Marble o={1.4} />
      </Animated.View>
      <Animated.View style={{ opacity: show, transform: [{ translateY: show.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }], gap: 14 }}>
        <View style={{ width: 52, height: 52, borderRadius: 8, borderWidth: 2, borderColor: DEEP.glow, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: DEEP.glow, fontSize: 19, fontWeight: "600", letterSpacing: 1 }}>AS</Text>
        </View>
        <View style={{ gap: 4 }}>
          <Text style={{ color: DEEP.ink, fontSize: tall ? 36 : 28, fontWeight: "600", letterSpacing: -0.8 }}>Al-Swati Contracting</Text>
          <Text style={{ color: DEEP.muted, fontSize: 15 }}>Marble, granite, stone and porcelain · السواتي للمقاولات</Text>
        </View>
      </Animated.View>
      {tall && <Text style={{ color: DEEP.muted, fontSize: 13, opacity: 0.8 }}>Only people added by Super-Admin can sign in.</Text>}
    </View>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const c = useColors(), wide = useWide();
  const form = (
    <ScrollView contentContainerStyle={{ padding: wide ? 56 : 24, gap: 14, flexGrow: 1, justifyContent: "center", width: "100%", maxWidth: 460, alignSelf: "center" }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
  return (
    <SafeAreaView edges={wide ? [] : ["bottom"]} style={{ flex: 1, backgroundColor: wide ? c.surface : c.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, flexDirection: wide ? "row" : "column" }}>
        <View style={wide ? { width: "46%" } : undefined}><Slab tall={wide} /></View>
        <View style={{ flex: 1 }}>{form}</View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Input({ label, value, onChange, secure, right, i, ...rest }: any) {
  const c = useColors(); const [focus, setFocus] = useState(false);
  return (
    <Rise i={i}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: c.muted, fontSize: 13, fontWeight: "500" }}>{label}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", minHeight: 52, borderWidth: focus ? 2 : 1, borderColor: focus ? c.accent : c.line, borderRadius: 10, backgroundColor: c.surface, paddingHorizontal: focus ? 13 : 14 }}>
          <TextInput value={value} onChangeText={onChange} secureTextEntry={secure} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} placeholderTextColor="#9AA4A0"
            style={{ flex: 1, fontSize: 17, color: c.ink, paddingVertical: 12, ...(web ? { outlineStyle: "none" } : {}) } as any} autoCapitalize="none" autoCorrect={false} {...rest} />
          {right}
        </View>
      </View>
    </Rise>
  );
}

function MainBtn({ label, onPress, disabled, busy, i }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; i: number }) {
  const c = useColors(); const off = disabled || busy;
  return (
    <Rise i={i}>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off }} disabled={off} onPress={onPress}
        style={({ pressed, hovered }: any) => ({ minHeight: 52, borderRadius: 10, backgroundColor: pressed ? "#124A3F" : c.accent, alignItems: "center", justifyContent: "center", opacity: off ? 0.5 : 1, cursor: off ? "default" : "pointer",
          transform: [{ scale: pressed && !off ? 0.985 : 1 }, { translateY: hovered && !off && !pressed ? -1 : 0 }],
          ...(web ? { boxShadow: hovered && !off ? "0 6px 16px rgba(23,89,76,0.28)" : "0 1px 2px rgba(17,38,31,0.25)", transition: "transform .14s ease, box-shadow .18s ease, background-color .18s ease" } : {}) } as any)}>
        <Text style={{ color: c.accentInk, fontSize: 17, fontWeight: "600" }}>{busy ? "Checking…" : label}</Text>
      </Pressable>
    </Rise>
  );
}

/** A short side-to-side shake when the sign-in is wrong. */
function useShake() {
  const x = useRef(new Animated.Value(0)).current;
  const shake = () => { if (calm) return; x.setValue(0); Animated.sequence([10, -8, 6, -4, 0].map((v) => Animated.timing(x, { toValue: v, duration: 60, useNativeDriver: !web }))).start(); };
  return { style: { transform: [{ translateX: x }] }, shake };
}

export default function Login({ problem }: { problem?: string }) {
  const c = useColors();
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(problem || ""), [forgot, setForgot] = useState(false);
  const [wait, setWait] = useState(0); // seconds before the next try is allowed
  const { style: shakeStyle, shake } = useShake();

  // Growing wait after repeated wrong tries: 5 wrong → 30 s, then 1, 2, 5, 15 minutes. Kept across reloads.
  const readTries = async () => { try { return JSON.parse((await AsyncStorage.getItem(LOCK_KEY)) || '{"n":0,"until":0}'); } catch { return { n: 0, until: 0 }; } };
  useEffect(() => { readTries().then((t) => setWait(Math.max(0, Math.ceil((t.until - Date.now()) / 1000)))); }, []);
  useEffect(() => { if (wait <= 0) return; const id = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(id); }, [wait]);

  const signIn = async () => {
    if (wait > 0) return;
    setBusy(true); setMsg("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: pw });
    setBusy(false);
    if (!error) { try { await AsyncStorage.removeItem(LOCK_KEY); } catch {} return; }
    const net = /fetch|network|timeout/i.test(error.message), limited = /rate|too many/i.test(error.message);
    if (net) { setMsg("No internet. Try again when the phone is online."); return; }
    const t = await readTries(); const n = t.n + 1;
    const steps = [30, 60, 120, 300, 900], secs = n >= 5 ? steps[Math.min(n - 5, steps.length - 1)] : 0;
    try { await AsyncStorage.setItem(LOCK_KEY, JSON.stringify({ n, until: Date.now() + secs * 1000 })); } catch {}
    setWait(limited ? Math.max(secs, 60) : secs);
    // One message for every failure: never tells a stranger whether the email exists.
    setMsg(WRONG); setPw(""); shake();
  };

  const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return (
    <Frame>
      <Rise i={0}><View style={{ gap: 4, marginBottom: 6 }}>
        <Text style={{ fontSize: 26, fontWeight: "600", color: c.ink, letterSpacing: -0.5 }}>Sign in</Text>
        <Text style={{ fontSize: 14, color: c.muted }}>دخول · داخل ہوں</Text>
      </View></Rise>
      <Animated.View style={[{ gap: 14 }, shakeStyle]}>
        <Input i={1} label="Email" value={email} onChange={setEmail} placeholder="name@gmail.com" autoComplete="email" keyboardType="email-address" textContentType="username" />
        <Input i={2} label="Password / كلمة المرور / پاس ورڈ" value={pw} onChange={setPw} secure={!show} autoComplete="current-password" textContentType="password" onSubmitEditing={() => okEmail && pw.length >= 8 && signIn()}
          right={<Pressable accessibilityRole="button" accessibilityLabel={show ? "Hide password" : "Show password"} onPress={() => setShow(!show)} style={{ paddingLeft: 10, paddingVertical: 8, cursor: "pointer" } as any}>
            <Text style={{ color: c.accent, fontSize: 14, fontWeight: "600" }}>{show ? "Hide" : "Show"}</Text></Pressable>} />
      </Animated.View>
      <MainBtn i={3} label={wait > 0 ? `Wait ${wait >= 60 ? Math.ceil(wait / 60) + " min" : wait + " s"}` : "Sign in / دخول / داخل ہوں"} onPress={signIn} disabled={!okEmail || pw.length < 8 || wait > 0} busy={busy} />
      {msg ? <Rise><Text style={{ color: msg === WRONG ? c.bad : c.muted, fontSize: 14, textAlign: "center" }}>{msg}</Text></Rise> : null}
      {wait > 0 ? <Text style={{ color: c.muted, fontSize: 13, textAlign: "center" }}>Too many wrong tries. For safety, wait a little before trying again.</Text> : null}
      <Rise i={4}><Text onPress={() => setForgot(!forgot)} style={{ color: c.accent, textAlign: "center", fontSize: 15, padding: 8, fontWeight: "500" }}>Forgot password? / نسيت كلمة المرور؟ / پاس ورڈ بھول گئے؟</Text></Rise>
      {forgot && <Rise><Text style={{ color: c.muted, fontSize: 14, textAlign: "center", lineHeight: 21 }}>
        Call or WhatsApp Super-Admin. They set a new starting password and send it to your phone number; then you choose your own.{"\n"}
        اتصل بالمدير ليرسل لك كلمة مرور جديدة على رقمك.{"\n"}
        Super-Admin کو فون یا واٹس ایپ کریں، وہ آپ کے نمبر پر نیا پاس ورڈ بھیجیں گے۔
      </Text></Rise>}
    </Frame>
  );
}

/** How strong a new password is: length, mix of characters, and not built from the email name or common words. */
function strength(pw: string, email = "") {
  const name = email.split("@")[0].toLowerCase();
  const fails: string[] = [];
  if (pw.length < 10) fails.push("at least 10 characters");
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) fails.push("letters and numbers");
  if (!/[^A-Za-z0-9]/.test(pw) && pw.length < 14) fails.push("one sign like ! @ # (or 14+ characters)");
  if ((name.length >= 3 && pw.toLowerCase().includes(name)) || /password|123456|qwerty|alswati|al-swati|swati/i.test(pw)) fails.push("not your name, email or an easy word");
  return { ok: fails.length === 0, fails, score: Math.max(0, 4 - fails.length) };
}

/** Shown once after Super-Admin gives a starting password: the person picks their own. */
export function SetPassword({ onDone }: { onDone: () => void }) {
  const c = useColors();
  const [a, setA] = useState(""), [b, setB] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [mail, setMail] = useState("");
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMail(data.user?.email || "")); }, []);
  const st = strength(a, mail);
  const save = async () => {
    setBusy(true); setMsg("");
    const { error } = await supabase.auth.updateUser({ password: a, data: { temp_password: false } });
    setBusy(false);
    if (error) setMsg(/weak|pwned|leaked/i.test(error.message) ? "This password is known to be leaked on the internet. Choose another one." : error.message); else onDone();
  };
  const bar = ["#B23A2E", "#C77A1F", "#9A5E10", "#2C7350", "#17594C"];
  return (
    <Frame>
      <Rise i={0}><View style={{ gap: 4 }}>
        <Text style={{ fontSize: 24, fontWeight: "600", color: c.ink, letterSpacing: -0.4 }}>Choose your own password</Text>
        <Text style={{ fontSize: 14, color: c.muted }}>اختر كلمة مرورك · اپنا پاس ورڈ رکھیں. Only you will know it.</Text>
      </View></Rise>
      <Input i={1} label="New password" value={a} onChange={setA} secure autoComplete="new-password" textContentType="newPassword" />
      {a.length > 0 && <View style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", gap: 4 }}>{[0, 1, 2, 3].map((k) => <View key={k} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: k < st.score ? bar[st.score] : c.line }} />)}</View>
        {!st.ok && <Text style={{ color: c.muted, fontSize: 13 }}>Still needed: {st.fails.join(", ")}.</Text>}
      </View>}
      <Input i={2} label="Same password again" value={b} onChange={setB} secure autoComplete="new-password" />
      {b.length > 0 && a !== b && <Text style={{ color: c.bad, fontSize: 14 }}>The two passwords are not the same.</Text>}
      <MainBtn i={3} label="Save / حفظ / محفوظ کریں" onPress={save} disabled={!st.ok || a !== b} busy={busy} />
      {msg ? <Text style={{ color: c.bad, fontSize: 14, textAlign: "center" }}>{msg}</Text> : null}
    </Frame>
  );
}
