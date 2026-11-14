import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FlowProvider } from "./components/Flows";
import { DataProvider, Profile } from "./lib/data";
import { supabase } from "./lib/supabase";
import Login, { SetPassword } from "./screens/Login";
import PublicBlog from "./screens/PublicBlog";
import Shell from "./screens/Shell";

// The public blog (…/blog/) is open to everyone, without signing in.
const isBlog = Platform.OS === "web" && typeof location !== "undefined" && /\/blog(\/|$)/.test(location.pathname);

export default function App() {
  if (isBlog) return <SafeAreaProvider><PublicBlog /></SafeAreaProvider>;
  return <Main />;
}

function Main() {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [problem, setProblem] = useState("");
  const [mustSet, setMustSet] = useState(false);

  const load = async (uid?: string) => {
    if (!uid) { setProfile(null); setReady(true); return; }
    const { data, error } = await supabase.from("profiles").select("*").eq("id", uid).single();
    if (error || !data) setProblem("This account has no role yet. Ask Super-Admin to add you.");
    else if (!data.active) setProblem("This account is switched off. Ask Super-Admin.");
    else { setProblem(""); setProfile(data as Profile); if ((data as any).must_change) setMustSet(true); }
    setReady(true);
  };
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      // Sign in again after 7 days (the database and the AI refuse older sign-ins anyway).
      const at = Date.parse(data.session?.user.last_sign_in_at || "");
      if (data.session && at && at < Date.now() - 7 * 864e5) { setProblem("For safety, please sign in again (every 7 days)."); supabase.auth.signOut(); return; }
      setMustSet(!!data.session?.user.user_metadata?.temp_password); load(data.session?.user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setMustSet(!!s?.user.user_metadata?.temp_password); load(s?.user.id); });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {!ready ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator size="large" /></View>
        : profile && mustSet ? <SetPassword onDone={() => setMustSet(false)} />
        : profile ? <DataProvider profile={profile}><FlowProvider><Shell /></FlowProvider></DataProvider>
        : <Login problem={problem} />}
    </SafeAreaProvider>
  );
}
