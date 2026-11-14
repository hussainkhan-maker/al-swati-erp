import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, FlatList, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TextStyle, useColorScheme, useWindowDimensions, View, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { Check } from "./lib/checks";
import { useData } from "./lib/data";
import { signedUrl } from "./lib/files";

// Palette taken from the material itself: honed grey granite for the page, white for paper, verde-marble green for actions.
const LIGHT = { bg: "#EBEEEC", surface: "#FFFFFF", sunk: "#F4F6F5", line: "#E0E5E2", ink: "#1A2320", muted: "#5D6965", accent: "#17594C", accentInk: "#FFFFFF", accentSoft: "#E6EFEC", good: "#2C7350", goodSoft: "#E6F1EA", warn: "#9A5E10", warnSoft: "#F8EEDD", bad: "#B23A2E", badSoft: "#F8E6E3" };
const DARK = { bg: "#121816", surface: "#1A2220", sunk: "#202926", line: "#2C3733", ink: "#E6ECE9", muted: "#9DAAA5", accent: "#5FB8A2", accentInk: "#0B1613", accentSoft: "#17322B", good: "#6CC394", goodSoft: "#173024", warn: "#DDA552", warnSoft: "#35290F", bad: "#EE8A7E", badSoft: "#3A1C18" };
export type Colors = typeof LIGHT;
/** Verde-marble green-black for the sidebar and splash (same in light and dark). */
export const DEEP = { bg: "#11261F", bg2: "#1A352C", ink: "#EEF3F0", muted: "#93A79F", glow: "#7CC4AF" };
const web = Platform.OS === "web";
// One type family for the whole app: IBM Plex Sans (Latin) + IBM Plex Sans Arabic, with tabular figures for money.
if (web && typeof document !== "undefined" && !document.getElementById("al-swati-type")) {
  const l = document.createElement("link"); l.id = "al-swati-type"; l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap";
  document.head.appendChild(l);
  const st = document.createElement("style");
  st.textContent = `*{font-family:"IBM Plex Sans","IBM Plex Sans Arabic",system-ui,-apple-system,"Segoe UI",sans-serif !important;font-variant-numeric:tabular-nums}[tabindex]{transition:background-color .18s ease,box-shadow .18s ease,transform .14s ease,border-color .18s ease,opacity .18s ease}[tabindex]:focus-visible{outline:2px solid #17594C;outline-offset:2px}@media (prefers-reduced-motion:reduce){[tabindex]{transition:none}}`;
  document.head.appendChild(st);
}
/** Laptop-size window: sidebar layout and wider grids. */
export const useWide = () => useWindowDimensions().width >= 960;
// Clickable surfaces only change their border on hover: no lifting, no shadows.
const lift = (hovered?: boolean, _pressed?: boolean): any => web ? { cursor: "pointer", borderColor: hovered ? "#B9C3BE" : undefined } : {};

/** Layout wrapper (kept for older screens). Content appears at once: no entrance animation. */
const calm = web && typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
/** Sections fade up a few pixels when a page opens, one after another (skipped when the device asks for less motion). */
export function Rise({ children, style, i = 0 }: { children: React.ReactNode; i?: number; style?: any }) {
  const v = useRef(new Animated.Value(calm ? 1 : 0)).current;
  useEffect(() => { if (!calm) Animated.timing(v, { toValue: 1, duration: 360, delay: Math.min(i, 8) * 55, easing: Easing.out(Easing.cubic), useNativeDriver: !web }).start(); }, []);
  return <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>{children}</Animated.View>;
}

/** A number that counts up to its value when it first appears. */
export function CountUp({ value, style, color, size = 24 }: { value: number; style?: TextStyle; color?: string; size?: number }) {
  const [n, setN] = useState(calm ? value : 0);
  useEffect(() => {
    if (calm) { setN(value); return; }
    let raf = 0; const t0 = Date.now(), from = 0;
    const tick = () => { const p = Math.min(1, (Date.now() - t0) / 900), e = 1 - Math.pow(1 - p, 3); setN(from + (value - from) * e); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [value]);
  return <Text style={[{ fontSize: size, fontWeight: "600", color, fontVariant: ["tabular-nums"] }, style]}>{Math.round(n).toLocaleString("en")}</Text>;
}
export const useColors = () => (useColorScheme() === "dark" ? DARK : LIGHT);

/** Direction helpers: Arabic and Urdu read right to left. */
export function useDir() {
  const { rtl } = useData();
  return { rtl, row: (rtl ? "row-reverse" : "row") as ViewStyle["flexDirection"], align: (rtl ? "right" : "left") as TextStyle["textAlign"], start: (rtl ? "flex-end" : "flex-start") as ViewStyle["alignItems"] };
}

/** Soft depth for raised surfaces (cards, strips, tables): a hairline plus a wide, faint shadow. */
export const ELEV: any = web ? { boxShadow: "0 1px 2px rgba(17,38,31,0.05), 0 6px 18px rgba(17,38,31,0.05)" } : { elevation: 1, shadowColor: "#11261F", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } };

/** Faint marble veins (white lines) laid over a dark verde surface. */
export function Marble({ w = 1200, h = 400, o = 1 }: { w?: number; h?: number; o?: number }) {
  const paths = ["M-40 60 C 120 120, 260 40, 420 110 S 720 220, 900 150 S 1180 60, 1280 140", "M-20 300 C 160 240, 300 330, 520 270 S 820 180, 1000 260 S 1200 340, 1300 300",
    "M600 -20 C 640 80, 560 160, 650 240 S 760 380, 700 460", "M180 -10 C 210 90, 160 170, 240 250 S 300 380, 260 440"];
  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
      {paths.map((d, i) => <Path key={i} d={d} stroke="#FFFFFF" strokeOpacity={(i % 2 ? 0.08 : 0.14) * o} strokeWidth={i % 2 ? 1 : 1.5} fill="none" />)}
    </Svg>
  );
}

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  const c = useColors();
  const wide = useWide();
  const inner: ViewStyle = { width: "100%", maxWidth: 1240, alignSelf: "center", padding: wide ? 32 : 16, paddingTop: wide ? 28 : 16, paddingBottom: 120, gap: wide ? 20 : 14 };
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.bg }}>
      {scroll ? <ScrollView contentContainerStyle={inner} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={[inner, { flex: 1 }]}>{children}</View>}
    </SafeAreaView>
  );
}

export function T({ children, size = 15, bold, muted, color, style, center, numberOfLines }: { children: React.ReactNode; size?: number; bold?: boolean; muted?: boolean; color?: string; style?: TextStyle; center?: boolean; numberOfLines?: number }) {
  const c = useColors(), { align, rtl } = useDir();
  return <Text numberOfLines={numberOfLines} style={[{ fontSize: size, color: color ?? (muted ? c.muted : c.ink), fontWeight: bold ? "600" : "400", textAlign: center ? "center" : align, writingDirection: rtl ? "rtl" : "ltr", lineHeight: Math.round(size * 1.45) }, style]}>{children}</Text>;
}
export const H1 = ({ children }: { children: React.ReactNode }) => <T size={28} bold style={{ letterSpacing: -0.6, lineHeight: 34 }}>{children}</T>;
export const H2 = ({ children }: { children: React.ReactNode }) => <T size={17} bold style={{ letterSpacing: -0.2 }}>{children}</T>;

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: ViewStyle; onPress?: () => void }) {
  const c = useColors();
  const s: any[] = [{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 12, padding: 18, gap: 10 }, ELEV, style];
  return onPress ? <Pressable onPress={onPress} style={({ pressed, hovered }: any) => [...s, lift(hovered, pressed), pressed && { backgroundColor: c.sunk }]}>{children}</Pressable> : <View style={s}>{children}</View>;
}

export function Row({ children, style, wrap }: { children: React.ReactNode; style?: ViewStyle; wrap?: boolean }) {
  const { row } = useDir();
  return <View style={[{ flexDirection: row, gap: 10, alignItems: "center", flexWrap: wrap ? "wrap" : "nowrap" }, style]}>{children}</View>;
}

export function Btn({ title, onPress, kind = "default", disabled, busy, big, style, icon }: { title: string; onPress: () => any; kind?: "default" | "primary" | "danger" | "ghost"; disabled?: boolean; busy?: boolean; big?: boolean; style?: ViewStyle; icon?: React.ReactNode }) {
  const c = useColors();
  const P = kind === "primary", G = kind === "ghost", D = kind === "danger";
  const bg = P ? c.accent : G ? "transparent" : c.surface;
  const fg = P ? c.accentInk : D ? c.bad : G ? c.accent : c.ink;
  // Primary: solid verde with a faint top highlight. Others: white with a soft edge. Hover lifts 1px, press sinks back.
  const rest: any = web ? (P ? { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14), 0 1px 2px rgba(17,38,31,0.28)" } : G ? {} : { boxShadow: "0 1px 2px rgba(17,38,31,0.07)" }) : {};
  const up: any = web ? (P ? { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14), 0 4px 12px rgba(23,89,76,0.28)", transform: [{ translateY: -1 }] } : G ? { backgroundColor: c.accentSoft } : { boxShadow: "0 3px 10px rgba(17,38,31,0.10)", borderColor: "#C8D1CC", transform: [{ translateY: -1 }] }) : {};
  return (
    <Pressable accessibilityRole="button" disabled={disabled || busy} onPress={onPress}
      style={({ pressed, hovered }: any) => [{ alignSelf: "flex-start", minHeight: big ? 46 : 38, minWidth: big ? 160 : undefined, paddingHorizontal: big ? 20 : 14, borderRadius: 10, backgroundColor: bg, borderWidth: G || P ? 0 : 1, borderColor: D ? "#E8C2BC" : c.line, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, opacity: disabled ? 0.45 : 1 },
        rest, web && !disabled ? { cursor: "pointer" } : null, hovered && !disabled && !pressed ? up : null,
        pressed && !disabled ? { transform: [{ scale: 0.98 }], backgroundColor: P ? "#124A3F" : G ? c.accentSoft : c.sunk } : null, style]}>
      {busy ? <ActivityIndicator color={fg} /> : icon}
      <Text style={{ color: fg, fontSize: big ? 15 : 14, fontWeight: "600", letterSpacing: -0.1 }}>{title}</Text>
    </Pressable>
  );
}

/** A small switch between a few views (in place of a row of buttons). */
export function Segmented({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", backgroundColor: c.sunk, borderRadius: 9, padding: 3, borderWidth: 1, borderColor: c.line }}>
      {options.map(([k, l]) => { const on = value === k; return (
        <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(k)}
          style={({ hovered }: any) => ({ paddingHorizontal: 12, height: 30, justifyContent: "center", borderRadius: 7, backgroundColor: on ? c.surface : "transparent", cursor: "pointer", ...(on && web ? { boxShadow: "0 1px 2px rgba(17,38,31,0.12)" } : {}), opacity: !on && hovered ? 0.75 : 1 } as any)}>
          <Text style={{ fontSize: 13, fontWeight: on ? "600" : "500", color: on ? c.ink : c.muted }}>{l}</Text>
        </Pressable>); })}
    </View>
  );
}

/** Section title with an optional quiet link on the right. */
export function SectionHead({ title, sub, action, onAction, right }: { title: string; sub?: string; action?: string; onAction?: () => void; right?: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 2 }}>
      <View style={{ flex: 1 }}><T size={16} bold style={{ letterSpacing: -0.2 }}>{title}</T>{sub ? <T size={12} muted>{sub}</T> : null}</View>
      {right}
      {action && onAction ? <Pressable onPress={onAction} style={({ hovered }: any) => ({ cursor: "pointer", opacity: hovered ? 0.7 : 1 } as any)}><Text style={{ color: c.accent, fontSize: 13, fontWeight: "600" }}>{action}</Text></Pressable> : null}
    </View>
  );
}

export function Field({ label, value, onChange, numeric, multiline, placeholder, style, required }: { label?: string; value: any; onChange: (v: string) => void; numeric?: boolean; multiline?: boolean; placeholder?: string; style?: ViewStyle; required?: boolean }) {
  const c = useColors(), { align, rtl } = useDir();
  return (
    <View style={[{ gap: 4, flex: 1, minWidth: 120 }, style]}>
      {label ? <T size={13} muted style={{ fontWeight: "500" }}>{label}{required ? <Text style={{ color: c.bad, fontWeight: "600" }}> *</Text> : null}</T> : null}
      <TextInput value={value == null ? "" : String(value)} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#9AA4A0"
        keyboardType={numeric ? "decimal-pad" : "default"} multiline={multiline}
        style={{ minHeight: multiline ? 104 : 40, borderWidth: 1, borderColor: c.line, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: c.surface, color: c.ink, fontSize: 15, textAlign: numeric ? "left" : align, writingDirection: rtl && !numeric ? "rtl" : "ltr", textAlignVertical: multiline ? "top" : "center" }} />
    </View>
  );
}

export function Select({ label, value, options, onChange, style }: { label?: string; value: any; options: { value: any; label: string }[]; onChange: (v: any) => void; style?: ViewStyle }) {
  const c = useColors(); const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value);
  return (
    <View style={[{ gap: 4, flex: 1, minWidth: 140 }, style]}>
      {label ? <T size={13} muted style={{ fontWeight: "500" }}>{label}</T> : null}
      <Pressable onPress={() => setOpen(true)} style={({ hovered }: any) => ({ minHeight: 40, borderWidth: 1, borderColor: hovered ? "#B9C3BE" : c.line, borderRadius: 8, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.surface, cursor: "pointer" } as any)}>
        <T size={15} muted={!cur} style={{ flex: 1 }} numberOfLines={1}>{cur ? cur.label : "—"}</T><Text style={{ color: c.muted, fontSize: 11 }}>▼</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,.45)", justifyContent: "center", padding: 24 }} onPress={() => setOpen(false)}>
          <View style={{ backgroundColor: c.surface, borderRadius: 10, maxHeight: "70%", width: "100%", maxWidth: 420, alignSelf: "center", overflow: "hidden" }}>
            <FlatList data={options} keyExtractor={(o, i) => String(o.value) + i} renderItem={({ item }) => (
              <Pressable onPress={() => { onChange(item.value); setOpen(false); }} style={{ paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderColor: c.line, backgroundColor: item.value === value ? c.accentSoft : c.surface }}>
                <T size={15}>{item.label}</T>
              </Pressable>)} />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export function Pill({ text, kind = "plain" }: { text: string; kind?: "plain" | "good" | "warn" | "bad" | "acc" }) {
  const c = useColors();
  const m = { plain: [c.sunk, c.muted], good: [c.goodSoft, c.good], warn: [c.warnSoft, c.warn], bad: [c.badSoft, c.bad], acc: [c.accentSoft, c.accent] }[kind];
  return <View style={{ backgroundColor: m[0], borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2, alignSelf: "flex-start" }}><Text style={{ color: m[1], fontSize: 12, fontWeight: "500" }}>{text}</Text></View>;
}

export function Checks({ list, title }: { list: Check[]; title?: string }) {
  const c = useColors(), { row } = useDir();
  return (
    <View style={{ gap: 6 }}>
      {/* Only problems are shown (each message once, with a count); when everything is fine, one quiet line. */}
      {list.length > 0 && !list.some((x) => x.s !== "good") ? <T size={13} color={c.good}>✓ {list.length} checks passed</T> : null}
      {Object.values(list.filter((x) => x.s !== "good").reduce((m: Record<string, Check & { n: number }>, x) => { const k = x.s + "|" + x.text; m[k] ? m[k].n++ : (m[k] = { ...x, n: 1 }); return m; }, {})).map((x, i) => {
        const [bg, fg, mark] = x.s === "bad" ? [c.badSoft, c.bad, "✕"] : x.s === "warn" ? [c.warnSoft, c.warn, "!"] : [c.goodSoft, c.good, "✓"];
        return <View key={i} style={{ flexDirection: row, gap: 8, backgroundColor: bg, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 }}><Text style={{ color: fg, fontWeight: "600", width: 16 }}>{mark}</Text><T size={14} color={fg} style={{ flex: 1 }}>{x.text}{x.n > 1 ? `  ×${x.n}` : ""}</T></View>;
      })}
    </View>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const c = useColors(); const { t } = useData(); const wide = useWide();
  if (web && wide) return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(17,38,31,0.42)", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Pressable onPress={() => {}} style={{ width: "100%", maxWidth: 760, maxHeight: "92%", backgroundColor: c.surface, borderRadius: 12, overflow: "hidden", boxShadow: "0 18px 48px rgba(17,38,31,0.22)" } as any}>
          <Row style={{ paddingHorizontal: 24, paddingVertical: 14, borderBottomWidth: 1, borderColor: c.line }}><View style={{ flex: 1 }}><T size={18} bold>{title}</T></View><Btn kind="ghost" title="✕" onPress={onClose} /></Row>
          <ScrollView contentContainerStyle={{ padding: 24, gap: 14, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <Row style={{ padding: 16, paddingBottom: 8 }}><View style={{ flex: 1 }}><H2>{title}</H2></View><Btn kind="ghost" title={t("close")} onPress={onClose} /></Row>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 14, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export function Kpi({ label, value, hero, onPress }: { label: string; value: string; hero?: boolean; onPress?: () => void }) {
  const c = useColors();
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={({ hovered }: any) => [{ flexGrow: 1, flexBasis: 170, backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16, gap: 4 }, onPress ? lift(hovered) : null, hero ? { borderTopWidth: 3, borderTopColor: c.accent } : null]}>
      <T size={13} muted>{label}</T>
      <Text style={{ fontSize: 22, fontWeight: "600", letterSpacing: -0.3, color: c.ink, fontVariant: ["tabular-nums"] }}>{value}</Text>
      {onPress ? <T size={12} color={c.accent}>View details</T> : null}
    </Pressable>
  );
}

/** Several figures in one bordered strip with dividers (instead of a row of separate cards). */
export function StatStrip({ items }: { items: { label: string; value: string; onPress?: () => void; tone?: "bad" }[] }) {
  const c = useColors(), wide = useWide();
  return (
    <View style={[{ flexDirection: wide ? "row" : "column", backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 12, overflow: "hidden" }, ELEV]}>
      {items.map((x, i) => (
        <Pressable key={x.label} disabled={!x.onPress} onPress={x.onPress} style={({ hovered }: any) => ({ flex: 1, paddingVertical: 14, paddingHorizontal: 16, gap: 3, borderColor: c.line, borderLeftWidth: wide && i ? 1 : 0, borderTopWidth: !wide && i ? 1 : 0, backgroundColor: hovered && x.onPress ? c.sunk : c.surface, cursor: x.onPress ? "pointer" : "default" } as any)}>
          <T size={13} muted>{x.label}</T>
          <Text numberOfLines={1} style={{ fontSize: 20, fontWeight: "600", letterSpacing: -0.3, color: x.tone === "bad" ? c.bad : c.ink, fontVariant: ["tabular-nums"] }}>{String(x.value).replace(/ SAR$/, "")}{/ SAR$/.test(String(x.value)) ? <Text style={{ fontSize: 12, fontWeight: "500", color: c.muted }}> SAR</Text> : null}</Text>
        </Pressable>))}
    </View>
  );
}

/** A simple table: horizontal scroll when it does not fit the phone. */
export function Table({ cols, rows, numeric = [] }: { cols: string[]; rows: (string | number | React.ReactNode)[][]; numeric?: number[] }) {
  const c = useColors(), { rtl } = useDir();
  const W = (i: number) => (numeric.includes(i) ? 100 : 150);
  const cell = (v: any, i: number, head = false) => (
    <View key={i} style={{ width: W(i), paddingHorizontal: 8, paddingVertical: 8 }}>
      {typeof v === "string" || typeof v === "number" ? <Text style={{ color: head ? c.muted : c.ink, fontSize: head ? 12 : 14, fontWeight: head ? "600" : "400", textAlign: numeric.includes(i) ? "right" : rtl ? "right" : "left", fontVariant: ["tabular-nums"] }}>{v}</Text> : v}
    </View>);
  return (
    <ScrollView horizontal style={[{ borderWidth: 1, borderColor: c.line, borderRadius: 12, backgroundColor: c.surface }, ELEV]}>
      <View style={{ flexDirection: rtl ? "column" : "column" }}>
        <View style={{ flexDirection: rtl ? "row-reverse" : "row", backgroundColor: c.sunk }}>{cols.map((h, i) => cell(h, i, true))}</View>
        {rows.length ? rows.map((r, j) => <View key={j} style={{ flexDirection: rtl ? "row-reverse" : "row", borderTopWidth: 1, borderColor: c.line }}>{r.map((v, i) => cell(v, i))}</View>)
          : <View style={{ padding: 12 }}><Text style={{ color: c.muted }}>—</Text></View>}
      </View>
    </ScrollView>
  );
}

export function Photo({ bucket = "receipts", path, size = 48 }: { bucket?: string; path?: string | null; size?: number }) {
  const c = useColors(); const [u, setU] = useState<string | null>(null);
  useEffect(() => { let on = true; if (path) signedUrl(bucket, path).then((x) => on && setU(x)); return () => { on = false; }; }, [path]);
  return u ? <Image source={{ uri: u }} style={{ width: size, height: size * 1.2, borderRadius: 6, backgroundColor: c.sunk }} /> : <View style={{ width: size, height: size * 1.2, borderRadius: 6, backgroundColor: c.sunk }} />;
}

const PATHS: Record<string, string[]> = {
  home: ["M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"],
  folder: ["M3 6h6l2 2h10v11H3z"],
  cash: ["M2 6h20v12H2z", "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6"],
  doc: ["M6 2h9l5 5v15H6z", "M14 2v6h6M9 13h8M9 17h6"],
  inbox: ["M3 13l3-8h12l3 8v6H3z", "M3 13h5l1 3h6l1-3h5"],
  tag: ["M3 12V3h9l9 9-9 9z", "M7.5 6a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3"],
  log: ["M4 4h16v16H4zM8 8h8M8 12h8M8 16h5"],
  mic: ["M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z", "M5 11a7 7 0 0 0 14 0M12 18v4"],
  stop: ["M7 7h10v10H7z"],
  ruler: ["M3 17L17 3l4 4L7 21z", "M7 13l2 2M10 10l2 2M13 7l2 2"],
  pct: ["M19 5L5 19", "M7 4.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5", "M17 14.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5"],
  truck: ["M2 6h12v10H2z", "M14 10h4l3 3v3h-7z", "M6 17a2 2 0 1 0 0 .1M17 17a2 2 0 1 0 0 .1"],
  people: ["M9 7a3 3 0 1 0 0 .1", "M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6", "M16 4a3 3 0 0 1 0 6M18 14c2 .7 3 2.8 3 6"],
  spark: ["M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"],
  camera: ["M3 7h4l2-3h6l2 3h4v12H3z", "M12 9a4 4 0 1 0 0 8a4 4 0 1 0 0-8"],
  receipt: ["M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z", "M8 8h8M8 12h8M8 16h5"],
  share: ["M12 3v12", "M7 8l5-5 5 5", "M5 13v8h14v-8"],
  check: ["M5 12l5 5 9-10"],
  plus: ["M12 5v14M5 12h14"],
  pin: ["M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z", "M12 7a2 2 0 1 0 0 4a2 2 0 1 0 0-4"],
};
export function Icon({ name, size = 22, color }: { name: string; size?: number; color?: string }) {
  const c = useColors();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? c.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {(PATHS[name] || []).map((d, i) => <Path key={i} d={d} />)}
    </Svg>
  );
}

/** Big, plain action tiles for the home screens. */
export function Tile({ icon, title, sub, onPress, accent }: { icon: string; title: string; sub?: string; onPress: () => void; accent?: boolean }) {
  const c = useColors(), { start } = useDir();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed, hovered }: any) => [{ flexGrow: 1, flexBasis: "45%", minHeight: 96, borderRadius: 12, padding: 16, gap: 6, justifyContent: "center", alignItems: start, backgroundColor: accent ? c.accent : c.surface, borderWidth: 1, borderColor: accent ? c.accent : c.line, opacity: pressed ? 0.88 : 1 }, accent ? (web ? { cursor: "pointer" } : null) : lift(hovered, pressed)]}>
      <Icon name={icon} size={24} color={accent ? c.accentInk : c.accent} />
      <T size={17} bold color={accent ? c.accentInk : c.ink}>{title}</T>
      {sub ? <T size={13} color={accent ? c.accentInk : c.muted}>{sub}</T> : null}
    </Pressable>
  );
}

export const Empty = ({ text }: { text: string }) => <Card><T muted>{text}</T></Card>;
export const s = StyleSheet.create({ grow: { flex: 1 } });

/** Simple bar chart: one bar per label, value written above; the highest bar is solid accent. */
export function Bars({ data, unit = "", height = 140 }: { data: { label: string; value: number }[]; unit?: string; height?: number }) {
  const c = useColors(); const max = Math.max(1, ...data.map((x) => x.value));

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10, height: height + 40 }}>
      {data.map((x, i) => {
        const h = Math.max(6, (x.value / max) * height), top = x.value === max && x.value > 0;
        return (
          <View key={i} style={{ flex: 1, alignItems: "center", gap: 4 }}>
            <Text style={{ fontSize: 11, color: c.muted, fontVariant: ["tabular-nums"] }}>{x.value ? Math.round(x.value) + unit : ""}</Text>
            <Grow h={h} i={i} color={top ? c.accent : "#C9D8D2"} />
            <Text style={{ fontSize: 12, color: c.muted }}>{x.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Grow({ h, i, color }: { h: number; i: number; color: string }) {
  const v = useRef(new Animated.Value(calm ? 1 : 0)).current;
  useEffect(() => { if (!calm) Animated.timing(v, { toValue: 1, duration: 520, delay: 120 + i * 45, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(); }, []);
  return <Animated.View style={{ width: "62%", maxWidth: 30, height: v.interpolate({ inputRange: [0, 1], outputRange: [2, h] }), borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: color }} />;
}

/** Month calendar; days with entries get a dot, today is filled. */
export function MonthCal({ marks = {} }: { marks?: Record<string, number> }) {
  const c = useColors(); const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const key = (dd: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  return (
    <View style={{ gap: 8 }}>
      <T bold size={15}>{now.toLocaleString("en", { month: "long", year: "numeric" })}</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => <View key={"w" + i} style={{ width: "14.28%", alignItems: "center", paddingVertical: 4 }}><Text style={{ fontSize: 11, color: c.muted }}>{w}</Text></View>)}
        {cells.map((dd, i) => {
          const isToday = dd === now.getDate(), n = dd ? marks[key(dd)] || 0 : 0;
          return (
            <View key={i} style={{ width: "14.28%", alignItems: "center", paddingVertical: 3 }}>
              {dd ? <View style={{ width: 30, height: 30, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: isToday ? c.accent : "transparent" }}>
                <Text style={{ fontSize: 13, color: isToday ? c.accentInk : c.ink, fontWeight: isToday ? "600" : "400" }}>{dd}</Text>
                {n > 0 && !isToday && <View style={{ position: "absolute", bottom: 2, width: 5, height: 5, borderRadius: 3, backgroundColor: c.accent }} />}
              </View> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}
