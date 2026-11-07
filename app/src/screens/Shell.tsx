// The frame around every account: bottom tabs, offline / waiting banners, fingerprint lock, 06:00–18:00 location.
import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";
import React, { useEffect, useRef, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useData } from "../lib/data";
import { startTracking } from "../lib/location";
import { supabase } from "../lib/supabase";
import { Btn, Card, H2, Icon, Screen, T, Tile, useColors, useDir } from "../ui";
import * as Abu from "./Abu";
import * as Admin from "./Admin";
import Agents from "./Agents";
import * as Eng from "./Engineer";
import Prices from "./Prices";
import Queries from "./Queries";
import Quotes from "./Quotes";
import * as Sup from "./Supervisor";
import Suppliers from "./Suppliers";

type TabDef = { key: string; label: string; icon: string; C: React.ComponentType<any> };
function MoreAdmin({ go }: { go: (k: string) => void }) {
  return (
    <Screen>
      <H2>More</H2>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Tile icon="folder" title="Projects" sub="Company, fee, sites, subcontractors" onPress={() => go("projects")} />
        <Tile icon="truck" title="Suppliers" sub="Directory and price requests" onPress={() => go("suppliers")} />
        <Tile icon="tag" title="Materials & prices" sub="Invoices, Abu's rates, AI estimates" onPress={() => go("prices")} />
        <Tile icon="spark" title="AI agents" sub="What each agent checked" onPress={() => go("agents")} />
        <Tile icon="people" title="People" sub="Add Abu, engineers, supervisors" onPress={() => go("people")} />
        <Tile icon="pin" title="Team on site" sub="Live 06:00–18:00" onPress={() => go("team")} />
        <Tile icon="log" title="Audit log" sub="Every change, by whom" onPress={() => go("audit")} />
      </View>
    </Screen>
  );
}

const TABS: Record<string, TabDef[]> = {
  admin: [
    { key: "home", label: "Home", icon: "home", C: Admin.Dashboard },
    { key: "money", label: "Money", icon: "cash", C: Admin.Money },
    { key: "queries", label: "Queries", icon: "inbox", C: Queries },
    { key: "quotes", label: "Quotations", icon: "doc", C: Quotes },
    { key: "more", label: "More", icon: "log", C: MoreAdmin },
  ],
  abu: [
    { key: "home", label: "الرئيسية", icon: "home", C: Abu.Home },
    { key: "money", label: "الحسابات", icon: "cash", C: Abu.Money },
    { key: "vat", label: "الضريبة", icon: "pct", C: Abu.Vat },
    { key: "suppliers", label: "الموردون", icon: "truck", C: Suppliers },
    { key: "quotes", label: "العروض", icon: "doc", C: Quotes },
  ],
  engineer: [
    { key: "progress", label: "Progress", icon: "ruler", C: Eng.Progress },
    { key: "docs", label: "Drawings", icon: "folder", C: Eng.Docs },
    { key: "quotes", label: "Quotations", icon: "doc", C: Quotes },
  ],
  supervisor: [
    { key: "home", label: "ہوم", icon: "home", C: Sup.Home },
    { key: "week", label: "ہفتہ", icon: "log", C: Sup.Week },
    { key: "report", label: "رپورٹ", icon: "doc", C: Sup.Report },
  ],
};
const SUBS: Record<string, React.ComponentType<any>> = { projects: Admin.Projects, suppliers: Suppliers, prices: Prices, agents: Agents, people: Admin.People, team: Admin.Team, audit: Admin.Audit };

export default function Shell() {
  const { role, online, pending, failed, dropFailed, t } = useData(); const c = useColors(); const { row } = useDir();
  const { lang } = useData();
  const ABU_LABELS: Record<string, [string, string, string]> = { home: ["الرئيسية", "ہوم", "Home"], money: ["الحسابات", "حسابات", "Accounts"], vat: ["الضريبة", "VAT", "VAT"], suppliers: ["الموردون", "سپلائرز", "Suppliers"], quotes: ["العروض", "کوٹیشن", "Quotes"] };
  const tabs = role === "abu" ? TABS.abu.map((x) => ({ ...x, label: ABU_LABELS[x.key][lang === "ur" ? 1 : lang === "en" ? 2 : 0] })) : TABS[role];
  const [tab, setTab] = useState(tabs[0].key), [sub, setSub] = useState<string | null>(null);
  const [locked, setLocked] = useState(true);
  const bgAt = useRef(0);

  const unlock = async () => {
    // Laptop / web: no fingerprint reader, the email code is the lock.
    if (Platform.OS === "web") { setLocked(false); return; }
    try {
      const has = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
      if (!has) { setLocked(false); return; }
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: "AL-Swati", cancelLabel: t("cancel") });
      if (r.success) setLocked(false);
    } catch { setLocked(false); }
  };
  useEffect(() => {
    unlock();
    if (Platform.OS !== "web" && (role === "supervisor" || role === "engineer")) startTracking().catch(() => {});
    const s = AppState.addEventListener("change", (st) => {
      if (st === "background") bgAt.current = Date.now();
      if (st === "active" && bgAt.current && Date.now() - bgAt.current > 3 * 60e3) { setLocked(true); unlock(); }
    });
    return () => s.remove();
  }, []);

  if (locked) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }}>
      <Icon name="check" size={48} color={c.accent} />
      <Btn big kind="primary" title="Unlock / افتح / کھولیں" onPress={unlock} style={{ alignSelf: "stretch" }} />
      <Btn kind="ghost" title="Sign out" onPress={() => supabase.auth.signOut()} />
    </SafeAreaView>
  );

  const cur = tabs.find((x) => x.key === tab) || tabs[0];
  const Body = sub ? SUBS[sub] : cur.C;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flex: 1 }}>
        {(!online || pending > 0 || failed.length > 0) && (
          <SafeAreaView edges={["top"]} style={{ backgroundColor: c.warnSoft }}>
            <View style={{ padding: 10, gap: 6 }}>
              {!online && <Text style={{ color: c.warn, fontWeight: "700" }}>Offline · آف لائن — entries are kept on the phone</Text>}
              {pending > 0 && <Text style={{ color: c.warn }}>{pending} waiting to upload</Text>}
              {failed.map((j) => <Card key={j.id}><T color={c.bad}>Not saved: {j.row?._error}</T><Btn title="Remove" onPress={() => dropFailed(j.id)} /></Card>)}
            </View>
          </SafeAreaView>
        )}
        {sub && <SafeAreaView edges={["top"]}><Pressable onPress={() => setSub(null)} style={{ padding: 14, flexDirection: row }}><Text style={{ color: c.accent, fontSize: 17, fontWeight: "700" }}>‹ Back</Text></Pressable></SafeAreaView>}
        <Body go={(k: string) => (SUBS[k] ? setSub(k) : setTab(k))} />
      </View>
      <SafeAreaView edges={["bottom"]} style={{ backgroundColor: c.surface, borderTopWidth: 1, borderColor: c.line }}>
        <View style={{ flexDirection: row, justifyContent: "space-around", paddingVertical: 6 }}>
          {tabs.map((x) => {
            const on = x.key === cur.key && !sub;
            return (
              <Pressable key={x.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => { setSub(null); setTab(x.key); }}
                style={{ alignItems: "center", gap: 2, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, backgroundColor: on ? c.accentSoft : "transparent", minWidth: 64 }}>
                <Icon name={x.icon} size={24} color={on ? c.accent : c.muted} />
                <Text style={{ fontSize: 12, color: on ? c.accent : c.muted, fontWeight: on ? "700" : "500" }}>{x.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
    </View>
  );
}
