import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FlowProvider } from "./components/Flows";
import { DataProvider, Profile } from "./lib/data";
import { supabase } from "./lib/supabase";
import Login from "./screens/Login";
import Shell from "./screens/Shell";

export default function App() {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [problem, setProblem] = useState("");

  const load = async (uid?: string) => {
    if (!uid) { setProfile(null); setReady(true); return; }
    const { data, error } = await supabase.from("profiles").select("*").eq("id", uid).single();
    if (error || !data) setProblem("This account has no role yet. Ask Super-Admin to add you.");
    else if (!data.active) setProblem("This account is switched off. Ask Super-Admin.");
    else { setProblem(""); setProfile(data as Profile); }
    setReady(true);
  };
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session?.user.id));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => load(s?.user.id));
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {!ready ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator size="large" /></View>
        : profile ? <DataProvider profile={profile}><FlowProvider><Shell /></FlowProvider></DataProvider>
        : <Login problem={problem} />}
    </SafeAreaProvider>
  );
}
