// The frame around every account: bottom tabs, offline / waiting banners, fingerprint lock, 06:00–18:00 location.
import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";
import React, { useEffect, useRef, useState } from "react";
import { Animated, AppState, BackHandler, Easing, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFlows } from "../components/Flows";
import { useData } from "../lib/data";
import { startTracking } from "../lib/location";
import { supabase } from "../lib/supabase";
import Svg, { Path } from "react-native-svg";
import { Btn, Card, DEEP, H2, Icon, Screen, T, Tile, useColors, useDir, useWide } from "../ui";
import * as Abu from "./Abu";
import * as Admin from "./Admin";
import Agents from "./Agents";
import * as Eng from "./Engineer";
import Prices from "./Prices";
import Growth from "./Growth";
import Queries from "./Queries";
import RFIs from "./RFIs";
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
        <Tile icon="inbox" title="RFIs" sub="Questions to consultants, follow-ups" onPress={() => go("rfis")} />
        <Tile icon="spark" title="Growth" sub="Blog for Google, outreach emails" onPress={() => go("growth")} />
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
    { key: "queries", label: "Queries", icon: "inbox", C: Queries },
    { key: "quotes", label: "Quotations", icon: "doc", C: Quotes },
    { key: "money", label: "Entries", icon: "cash", C: Admin.Money },
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
const SUB_LABEL: Record<string, string> = { rfis: "RFIs", growth: "Growth", projects: "Projects", suppliers: "Suppliers", prices: "Prices", agents: "AI agents", people: "People", team: "Team on site", audit: "Audit log" };
const SUB_ICON: Record<string, string> = { rfis: "inbox", growth: "spark", projects: "folder", suppliers: "truck", prices: "tag", agents: "spark", people: "people", team: "pin", audit: "log" };
const SUBS: Record<string, React.ComponentType<any>> = { rfis: RFIs, growth: Growth, projects: Admin.Projects, suppliers: Suppliers, prices: Prices, agents: Agents, people: Admin.People, team: Admin.Team, audit: Admin.Audit };

export default function Shell() {
  const { role, online, pending, failed, dropFailed, t } = useData(); const c = useColors(); const { row } = useDir();
  const { lang, profile } = useData();
  const ABU_LABELS: Record<string, [string, string, string]> = { home: ["الرئيسية", "ہوم", "Home"], money: ["الحسابات", "حسابات", "Accounts"], vat: ["الضريبة", "VAT", "VAT"], suppliers: ["الموردون", "سپلائرز", "Suppliers"], quotes: ["العروض", "کوٹیشن", "Quotes"] };
  const tabs = role === "abu" ? TABS.abu.map((x) => ({ ...x, label: ABU_LABELS[x.key][lang === "ur" ? 1 : lang === "en" ? 2 : 0] })) : TABS[role];
  const [tab, setTab] = useState(tabs[0].key), [sub, setSub] = useState<string | null>(null);
  const [locked, setLocked] = useState(true);
  const bgAt = useRef(0);
  const flows = useFlows();
  const wide = useWide() && Platform.OS === "web";
  // Laptop: a short opening animation (logo fades and grows on deep green).
  const [intro, setIntro] = useState(Platform.OS === "web");
  const introV = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!intro) return;
    Animated.sequence([Animated.timing(introV, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: false }), Animated.delay(450)]).start(() => setIntro(false));
  }, []);
  // Phone back button: first close the open page, then go to the first tab; only then leave the app.
  const nav = useRef({ tab, sub }); nav.current = { tab, sub };
  useEffect(() => {
    const h = BackHandler.addEventListener("hardwareBackPress", () => {
      if (nav.current.sub) { setSub(null); return true; }
      if (nav.current.tab !== tabs[0].key) { setTab(tabs[0].key); return true; }
      return false;
    });
    return () => h.remove();
  }, []);

  const unlock = async () => {
    // Laptop / web: no fingerprint reader, the email code is the lock.
    if (Platform.OS === "web") { setLocked(false); return; }
    try {
      // Opens with whatever the phone itself uses: Face ID, fingerprint, or the phone's PIN / pattern.
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      if (level === LocalAuthentication.SecurityLevel.NONE) { setLocked(false); return; }
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: "AL-Swati", cancelLabel: t("cancel"), disableDeviceFallback: false });
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

  if (intro) return (
    <View style={{ flex: 1, backgroundColor: DEEP.bg, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ opacity: introV, transform: [{ scale: introV.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }], alignItems: "center", gap: 8 }}>
        <View style={{ width: 60, height: 60, borderRadius: 8, borderWidth: 2, borderColor: DEEP.glow, alignItems: "center", justifyContent: "center" }}><Text style={{ color: DEEP.glow, fontSize: 22, fontWeight: "600", letterSpacing: 1 }}>AS</Text></View>
        <Text style={{ color: DEEP.ink, fontSize: 26, fontWeight: "600" }}>Al-Swati Contracting</Text>
        <Text style={{ color: DEEP.muted, fontSize: 14 }}>Marble, granite, stone and porcelain</Text>
      </Animated.View>
    </View>
  );

  const cur = tabs.find((x) => x.key === tab) || tabs[0];
  const Body = sub ? SUBS[sub] : cur.C;
  // Laptop sidebar: every main page in one list (admin's "More" pages are listed directly).
  const T_ = (k: string) => { const x = tabs.find((y) => y.key === k)!; return { key: k, label: x.label, icon: x.icon, isSub: false }; };
  const S_ = (k: string) => ({ key: k, label: SUB_LABEL[k], icon: SUB_ICON[k], isSub: true });
  // Admin sidebar order: what is used most first; the list of all entries near the end.
  // Admin sidebar in groups, in the order the work happens: sales → site → money → company.
  const groups: [string, any[]][] = role === "admin"
    ? [["", [T_("home")]], ["Sales", [T_("queries"), T_("quotes"), S_("rfis"), S_("growth")]], ["Site", [S_("projects"), S_("team")]],
       ["Buying", [S_("suppliers"), S_("prices")]], ["Money", [T_("money")]], ["Company", [S_("people"), S_("agents"), S_("audit")]]]
    : [["", tabs.map((x) => ({ key: x.key, label: x.label, icon: x.icon, isSub: false }))]];
  const initials = String(profile?.name || "AS").split(/\s+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
  const pageLabel = sub ? SUB_LABEL[sub] || sub : cur.label;
  const pageGroup = groups.find(([, items]) => items.some((x: any) => x.key === (sub || cur.key)))?.[0] || "";
  // Laptop top bar: where you are on the left, the AI helper on the right.
  const topbar = wide && (
    <View style={{ height: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 32, backgroundColor: c.surface, borderBottomWidth: 1, borderColor: c.line }}>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
        {pageGroup ? <><Text style={{ color: c.muted, fontSize: 14 }}>{pageGroup}</Text><Text style={{ color: c.line, fontSize: 14 }}>/</Text></> : null}
        <Text style={{ color: c.ink, fontSize: 14, fontWeight: "600" }}>{pageLabel}</Text>
      </View>
      <Text style={{ color: c.muted, fontSize: 13 }}>{new Date().toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short" })}</Text>
      <Btn icon={<Icon name="spark" size={16} color={c.accent} />} title="Ask AI" onPress={() => flows("ask", { page: pageLabel })} />
    </View>
  );
  const sidebar = wide && (
    <View style={{ width: 232, backgroundColor: DEEP.bg, paddingVertical: 18, paddingHorizontal: 12, overflow: "hidden" }}>
      <Veins />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, marginBottom: 18 }}>
        <View style={{ width: 34, height: 34, borderRadius: 6, borderWidth: 1.5, borderColor: DEEP.glow, alignItems: "center", justifyContent: "center" }}><Text style={{ color: DEEP.glow, fontSize: 13, fontWeight: "600", letterSpacing: 0.5 }}>AS</Text></View>
        <View><Text style={{ color: DEEP.ink, fontSize: 16, fontWeight: "600" }}>Al-Swati</Text><Text style={{ color: DEEP.muted, fontSize: 12 }}>Contracting</Text></View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 2 }}>
        {groups.map(([g, items]) => (
          <View key={g || "top"} style={{ gap: 2, marginBottom: 10 }}>
            {g ? <Text style={{ color: DEEP.muted, fontSize: 12, fontWeight: "500", paddingHorizontal: 10, paddingTop: 4, paddingBottom: 4, opacity: 0.85 }}>{g}</Text> : null}
            {items.map((x: any) => {
              const on = x.isSub ? sub === x.key : !sub && cur.key === x.key;
              return (
                <Pressable key={x.key} onPress={() => { if (x.isSub) setSub(x.key); else { setSub(null); setTab(x.key); } }}
                  style={({ hovered }: any) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 6, backgroundColor: on ? "rgba(255,255,255,0.10)" : hovered ? "rgba(255,255,255,0.05)" : "transparent", borderLeftWidth: 3, borderLeftColor: on ? DEEP.glow : "transparent", cursor: "pointer" } as any)}>
                  <Icon name={x.icon} size={17} color={on ? DEEP.ink : DEEP.muted} />
                  <Text style={{ color: on ? "#FFFFFF" : DEEP.ink, opacity: on ? 1 : 0.86, fontSize: 14, fontWeight: on ? "600" : "400" }}>{x.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
      <View style={{ borderTopWidth: 1, borderColor: "rgba(255,255,255,0.10)", paddingTop: 12, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: DEEP.bg2, alignItems: "center", justifyContent: "center" }}><Text style={{ color: DEEP.glow, fontSize: 13, fontWeight: "600" }}>{initials}</Text></View>
        <View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: DEEP.ink, fontSize: 13, fontWeight: "600" }}>{profile?.name || "Signed in"}</Text>
          <Pressable onPress={() => supabase.auth.signOut()} style={{ cursor: "pointer" } as any}><Text style={{ color: DEEP.muted, fontSize: 12 }}>Sign out</Text></Pressable></View>
      </View>
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, flexDirection: wide ? "row" : "column" }}>
      {sidebar}
      <View style={{ flex: 1 }}>
        {(!online || pending > 0 || failed.length > 0) && (
          <SafeAreaView edges={["top"]} style={{ backgroundColor: c.warnSoft }}>
            <View style={{ padding: 10, gap: 6 }}>
              {!online && <Text style={{ color: c.warn, fontWeight: "700" }}>Offline · آف لائن — entries are kept on the phone</Text>}
              {pending > 0 && <Text style={{ color: c.warn }}>{pending} waiting to upload</Text>}
              {/* Same error many times → shown once with a count; Remove clears all of them. */}
              {Object.values(failed.reduce((m: Record<string, any[]>, j) => { const k = String(j.row?._error || "?"); (m[k] ||= []).push(j); return m; }, {})).map((js) => (
                <Card key={js[0].id}><T color={c.bad}>Not saved{js.length > 1 ? ` (${js.length}×)` : ""}: {js[0].row?._error}</T><Btn title={js.length > 1 ? `Remove all ${js.length}` : "Remove"} onPress={async () => { for (const j of js) await dropFailed(j.id); }} /></Card>))}
            </View>
          </SafeAreaView>
        )}
        {sub && !wide && <SafeAreaView edges={["top"]}><Pressable onPress={() => setSub(null)} style={{ padding: 14, flexDirection: row }}><Text style={{ color: c.accent, fontSize: 17, fontWeight: "700" }}>‹ Back</Text></Pressable></SafeAreaView>}
        {topbar}
        <Body go={(k: string) => (SUBS[k] ? setSub(k) : setTab(k))} />
        {/* AI helper on every page (phone): knows the page, suggests the next step and what to correct. On the laptop it sits in the top bar. */}
        {!wide && <Pressable accessibilityRole="button" accessibilityLabel="AI helper" onPress={() => flows("ask", { page: sub ? (SUB_LABEL[sub] || sub) : cur.label })}
          style={{ position: "absolute", bottom: 20, [row === "row-reverse" ? "left" : "right"]: 20, height: 44, paddingHorizontal: 16, borderRadius: 22, flexDirection: "row", gap: 8, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#11261F", shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}>
          <Icon name="spark" size={18} color={c.accentInk} />
        </Pressable>}
      </View>
      {!wide && <SafeAreaView edges={["bottom"]} style={{ backgroundColor: c.surface, borderTopWidth: 1, borderColor: c.line }}>
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
      </SafeAreaView>}
    </View>
  );
}

/** The one decorative element of the app: faint marble veins in the sidebar, like a slab of verde marble. */
function Veins() {
  return (
    <Svg width={232} height={900} viewBox="0 0 232 900" style={{ position: "absolute", top: 0, left: 0 }} pointerEvents="none">
      {["M-20 120 C 60 160, 90 260, 180 300 S 260 420, 210 520", "M40 -10 C 70 80, 30 170, 110 240 S 150 380, 90 470 S 60 640, 140 720",
        "M250 560 C 190 600, 160 680, 190 760 S 120 860, 60 920", "M-10 640 C 50 660, 70 720, 40 790"].map((d, i) => (
        <Path key={i} d={d} stroke="#FFFFFF" strokeOpacity={i === 1 ? 0.07 : 0.045} strokeWidth={i === 1 ? 1.4 : 1} fill="none" />))}
    </Svg>
  );
}
