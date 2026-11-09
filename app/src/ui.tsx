import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, FlatList, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TextStyle, useColorScheme, useWindowDimensions, View, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { Check } from "./lib/checks";
import { useData } from "./lib/data";
import { signedUrl } from "./lib/files";

const LIGHT = { bg: "#EAF2EE", surface: "#FFFFFF", sunk: "#E9ECE8", line: "#D6DCD7", ink: "#18211E", muted: "#4F5C57", accent: "#0E6B5C", accentInk: "#FFFFFF", accentSoft: "#E2F0EC", good: "#1E7A46", goodSoft: "#E3F3E8", warn: "#9A5B00", warnSoft: "#FBF0DC", bad: "#B42318", badSoft: "#FBE7E5" };
const DARK = { bg: "#111715", surface: "#19211E", sunk: "#202A27", line: "#2E3A36", ink: "#E8EEEB", muted: "#A3B1AC", accent: "#3FB59C", accentInk: "#06120F", accentSoft: "#163A33", good: "#5CC98A", goodSoft: "#163323", warn: "#E3A84A", warnSoft: "#3A2C12", bad: "#F2877C", badSoft: "#3D1B18" };
export type Colors = typeof LIGHT;
/** Deep green used for the hero banner, sidebar and splash (same in light and dark). */
export const DEEP = { bg: "#0F3B31", bg2: "#155244", ink: "#F2FBF7", muted: "#A9CFC2", glow: "#3FB59C" };
const web = Platform.OS === "web";
/** Laptop-size window: sidebar layout and wider grids. */
export const useWide = () => useWindowDimensions().width >= 960;
const lift = (hovered?: boolean, pressed?: boolean): any => web
  ? { transform: [{ translateY: hovered && !pressed ? -3 : 0 }], boxShadow: hovered ? "0 10px 24px rgba(15,59,49,0.14)" : "0 1px 2px rgba(15,59,49,0.06)", transitionDuration: "180ms", transitionProperty: "transform, box-shadow", cursor: "pointer" }
  : {};

/** Cards fade and slide in, one after another (delay = order × 60 ms). */
export function Rise({ children, i = 0, style }: { children: React.ReactNode; i?: number; style?: any }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(v, { toValue: 1, duration: 420, delay: Math.min(i, 12) * 60, easing: Easing.out(Easing.cubic), useNativeDriver: !web }).start(); }, []);
  return <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>{children}</Animated.View>;
}
export const useColors = () => (useColorScheme() === "dark" ? DARK : LIGHT);

/** Direction helpers: Arabic and Urdu read right to left. */
export function useDir() {
  const { rtl } = useData();
  return { rtl, row: (rtl ? "row-reverse" : "row") as ViewStyle["flexDirection"], align: (rtl ? "right" : "left") as TextStyle["textAlign"], start: (rtl ? "flex-end" : "flex-start") as ViewStyle["alignItems"] };
}

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  const c = useColors();
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.bg }}>
      {scroll ? <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 14 }} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={{ flex: 1, padding: 16, gap: 14 }}>{children}</View>}
    </SafeAreaView>
  );
}

export function T({ children, size = 15, bold, muted, color, style, center, numberOfLines }: { children: React.ReactNode; size?: number; bold?: boolean; muted?: boolean; color?: string; style?: TextStyle; center?: boolean; numberOfLines?: number }) {
  const c = useColors(), { align, rtl } = useDir();
  return <Text numberOfLines={numberOfLines} style={[{ fontSize: size, color: color ?? (muted ? c.muted : c.ink), fontWeight: bold ? "700" : "400", textAlign: center ? "center" : align, writingDirection: rtl ? "rtl" : "ltr", lineHeight: size * 1.4 }, style]}>{children}</Text>;
}
export const H1 = ({ children }: { children: React.ReactNode }) => <T size={24} bold>{children}</T>;
export const H2 = ({ children }: { children: React.ReactNode }) => <T size={18} bold>{children}</T>;

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: ViewStyle; onPress?: () => void }) {
  const c = useColors();
  const s: any[] = [{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 10 }, web && { boxShadow: "0 1px 2px rgba(15,59,49,0.06)" }, style];
  return onPress ? <Pressable onPress={onPress} style={({ pressed, hovered }: any) => [...s, lift(hovered, pressed), pressed && { opacity: 0.8 }]}>{children}</Pressable> : <View style={s}>{children}</View>;
}

export function Row({ children, style, wrap }: { children: React.ReactNode; style?: ViewStyle; wrap?: boolean }) {
  const { row } = useDir();
  return <View style={[{ flexDirection: row, gap: 10, alignItems: "center", flexWrap: wrap ? "wrap" : "nowrap" }, style]}>{children}</View>;
}

export function Btn({ title, onPress, kind = "default", disabled, busy, big, style, icon }: { title: string; onPress: () => any; kind?: "default" | "primary" | "danger" | "ghost"; disabled?: boolean; busy?: boolean; big?: boolean; style?: ViewStyle; icon?: React.ReactNode }) {
  const c = useColors();
  const bg = kind === "primary" ? c.accent : kind === "ghost" ? "transparent" : c.surface;
  const fg = kind === "primary" ? c.accentInk : kind === "danger" ? c.bad : c.ink;
  return (
    <Pressable accessibilityRole="button" disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [{ minHeight: big ? 64 : 48, paddingHorizontal: 16, borderRadius: 14, backgroundColor: bg, borderWidth: kind === "ghost" ? 0 : 1, borderColor: kind === "primary" ? c.accent : kind === "danger" ? c.bad : c.line, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : icon}
      <Text style={{ color: fg, fontSize: big ? 20 : 16, fontWeight: "700" }}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, value, onChange, numeric, multiline, placeholder, style }: { label?: string; value: any; onChange: (v: string) => void; numeric?: boolean; multiline?: boolean; placeholder?: string; style?: ViewStyle }) {
  const c = useColors(), { align, rtl } = useDir();
  return (
    <View style={[{ gap: 4, flex: 1, minWidth: 120 }, style]}>
      {label ? <T size={13} muted>{label}</T> : null}
      <TextInput value={value == null ? "" : String(value)} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={c.muted}
        keyboardType={numeric ? "decimal-pad" : "default"} multiline={multiline}
        style={{ minHeight: multiline ? 110 : 48, borderWidth: 1, borderColor: c.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: c.surface, color: c.ink, fontSize: 17, textAlign: numeric ? "left" : align, writingDirection: rtl && !numeric ? "rtl" : "ltr", textAlignVertical: multiline ? "top" : "center" }} />
    </View>
  );
}

export function Select({ label, value, options, onChange, style }: { label?: string; value: any; options: { value: any; label: string }[]; onChange: (v: any) => void; style?: ViewStyle }) {
  const c = useColors(); const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value);
  return (
    <View style={[{ gap: 4, flex: 1, minWidth: 140 }, style]}>
      {label ? <T size={13} muted>{label}</T> : null}
      <Pressable onPress={() => setOpen(true)} style={{ minHeight: 48, borderWidth: 1, borderColor: c.line, borderRadius: 10, paddingHorizontal: 12, justifyContent: "center", backgroundColor: c.surface }}>
        <T size={17} muted={!cur}>{cur ? cur.label : "—"}  ▾</T>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,.45)", justifyContent: "center", padding: 24 }} onPress={() => setOpen(false)}>
          <View style={{ backgroundColor: c.surface, borderRadius: 16, maxHeight: "70%", overflow: "hidden" }}>
            <FlatList data={options} keyExtractor={(o, i) => String(o.value) + i} renderItem={({ item }) => (
              <Pressable onPress={() => { onChange(item.value); setOpen(false); }} style={{ padding: 16, borderBottomWidth: 1, borderColor: c.line, backgroundColor: item.value === value ? c.accentSoft : c.surface }}>
                <T size={17}>{item.label}</T>
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
  return <View style={{ backgroundColor: m[0], borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2, alignSelf: "flex-start" }}><Text style={{ color: m[1], fontSize: 12, fontWeight: "700" }}>{text}</Text></View>;
}

export function Checks({ list, title }: { list: Check[]; title?: string }) {
  const c = useColors(), { row } = useDir();
  return (
    <View style={{ gap: 6 }}>
      {title ? <T size={13} bold muted>{title}</T> : null}
      {/* The same message is shown once, with how many times it came up. */}
      {Object.values(list.reduce((m: Record<string, Check & { n: number }>, x) => { const k = x.s + "|" + x.text; m[k] ? m[k].n++ : (m[k] = { ...x, n: 1 }); return m; }, {})).map((x, i) => {
        const [bg, fg, mark] = x.s === "bad" ? [c.badSoft, c.bad, "✕"] : x.s === "warn" ? [c.warnSoft, c.warn, "!"] : [c.goodSoft, c.good, "✓"];
        return <View key={i} style={{ flexDirection: row, gap: 8, backgroundColor: bg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 }}><Text style={{ color: fg, fontWeight: "800", width: 16 }}>{mark}</Text><T size={14} color={fg} style={{ flex: 1 }}>{x.text}{x.n > 1 ? `  ×${x.n}` : ""}</T></View>;
      })}
    </View>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const c = useColors(); const { t } = useData();
  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <Row style={{ padding: 16, paddingBottom: 8 }}><View style={{ flex: 1 }}><H2>{title}</H2></View><Btn kind="ghost" title={t("close")} onPress={onClose} /></Row>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 14, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export function Kpi({ label, value, hero }: { label: string; value: string; hero?: boolean }) {
  const c = useColors();
  return (
    <Pressable style={({ hovered }: any) => [{ flexGrow: 1, flexBasis: 170, backgroundColor: hero ? c.accent : c.surface, borderColor: hero ? c.accent : c.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 6 }, lift(hovered)]}>
      <T size={12} color={hero ? c.accentInk : c.muted}>{label}</T>
      <Text style={{ fontSize: 24, fontWeight: "800", color: hero ? c.accentInk : c.ink, fontVariant: ["tabular-nums"] }}>{value}</Text>
    </Pressable>
  );
}

/** A simple table: horizontal scroll when it does not fit the phone. */
export function Table({ cols, rows, numeric = [] }: { cols: string[]; rows: (string | number | React.ReactNode)[][]; numeric?: number[] }) {
  const c = useColors(), { rtl } = useDir();
  const W = (i: number) => (numeric.includes(i) ? 100 : 150);
  const cell = (v: any, i: number, head = false) => (
    <View key={i} style={{ width: W(i), paddingHorizontal: 8, paddingVertical: 8 }}>
      {typeof v === "string" || typeof v === "number" ? <Text style={{ color: head ? c.muted : c.ink, fontSize: head ? 12 : 14, fontWeight: head ? "700" : "400", textAlign: numeric.includes(i) ? "right" : rtl ? "right" : "left", fontVariant: ["tabular-nums"] }}>{v}</Text> : v}
    </View>);
  return (
    <ScrollView horizontal style={{ borderWidth: 1, borderColor: c.line, borderRadius: 14, backgroundColor: c.surface }}>
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
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed, hovered }: any) => [{ flexGrow: 1, flexBasis: "45%", minHeight: 108, borderRadius: 20, padding: 16, gap: 8, justifyContent: "center", alignItems: start, backgroundColor: accent ? c.accent : c.surface, borderWidth: 1, borderColor: accent ? c.accent : c.line, opacity: pressed ? 0.85 : 1 }, lift(hovered, pressed)]}>
      <Icon name={icon} size={28} color={accent ? c.accentInk : c.accent} />
      <T size={18} bold color={accent ? c.accentInk : c.ink}>{title}</T>
      {sub ? <T size={13} color={accent ? c.accentInk : c.muted}>{sub}</T> : null}
    </Pressable>
  );
}

export const Empty = ({ text }: { text: string }) => <Card><T muted>{text}</T></Card>;
export const s = StyleSheet.create({ grow: { flex: 1 } });

/** Simple bar chart: one bar per label, value written above; the highest bar is solid accent. */
export function Bars({ data, unit = "", height = 140 }: { data: { label: string; value: number }[]; unit?: string; height?: number }) {
  const c = useColors(); const max = Math.max(1, ...data.map((x) => x.value));
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { v.setValue(0); Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(); }, [JSON.stringify(data)]);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10, height: height + 40 }}>
      {data.map((x, i) => {
        const h = Math.max(6, (x.value / max) * height), top = x.value === max && x.value > 0;
        return (
          <View key={i} style={{ flex: 1, alignItems: "center", gap: 4 }}>
            <Text style={{ fontSize: 11, color: c.muted, fontVariant: ["tabular-nums"] }}>{x.value ? Math.round(x.value) + unit : ""}</Text>
            <Animated.View style={{ width: "70%", maxWidth: 34, height: v.interpolate({ inputRange: [0, 1], outputRange: [4, h] }), borderRadius: 12, backgroundColor: top ? c.accent : c.accentSoft, borderWidth: top ? 0 : 1, borderColor: c.line }} />
            <Text style={{ fontSize: 12, color: c.muted }}>{x.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** Month calendar; days with entries get a dot, today is filled. */
export function MonthCal({ marks = {} }: { marks?: Record<string, number> }) {
  const c = useColors(); const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const key = (dd: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  return (
    <View style={{ gap: 8 }}>
      <T bold size={16}>{now.toLocaleString("en", { month: "long", year: "numeric" })}</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => <View key={"w" + i} style={{ width: "14.28%", alignItems: "center", paddingVertical: 4 }}><Text style={{ fontSize: 11, color: c.muted }}>{w}</Text></View>)}
        {cells.map((dd, i) => {
          const isToday = dd === now.getDate(), n = dd ? marks[key(dd)] || 0 : 0;
          return (
            <View key={i} style={{ width: "14.28%", alignItems: "center", paddingVertical: 3 }}>
              {dd ? <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: isToday ? c.accent : "transparent" }}>
                <Text style={{ fontSize: 13, color: isToday ? c.accentInk : c.ink, fontWeight: isToday ? "800" : "500" }}>{dd}</Text>
                {n > 0 && !isToday && <View style={{ position: "absolute", bottom: 2, width: 5, height: 5, borderRadius: 3, backgroundColor: c.accent }} />}
              </View> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}
