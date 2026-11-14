// Loads what each role is allowed to see, keeps it live, and queues writes while offline.
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { uid as genId } from "./fmt";

const ID_TABLES = ["txns", "progress"];
const uuid4 = () => {
  const b = new Uint8Array(16);
  if (typeof crypto !== "undefined" && (crypto as any).getRandomValues) (crypto as any).getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
import { Lang, isRTL, makeT } from "./i18n";
import { uploadFile } from "./files";
import { supabase } from "./supabase";

export type Role = "admin" | "abu" | "engineer" | "supervisor";
export type Profile = { id: string; name: string; role: Role; lang: Lang; phone?: string; active: boolean };

type Q = { key: string; run: () => any };
const Tbl = (t: string, order = "created_at", limit = 3000): Q => ({ key: t, run: () => supabase.from(t).select("*").order(order, { ascending: false }).limit(limit) });
const View = (t: string): Q => ({ key: t, run: () => supabase.from(t).select("*") });
const Rpc = (key: string, fn: string): Q => ({ key, run: () => supabase.rpc(fn) });

const READS: Record<Role, Q[]> = {
  admin: [Tbl("projects"), View("project_members"), Tbl("subcontractors"), Tbl("txns"), Tbl("progress", "created_at", 5000), Tbl("items"), Tbl("prices"), Tbl("quotes", "updated_at"), Tbl("documents"), Tbl("profiles"),
    View("project_ledger"), View("vat_by_company"), View("sub_ledger"), Tbl("audit_log", "at", 300), Tbl("locations", "at", 600),
    Tbl("inquiries"), Tbl("suppliers"), Tbl("supplier_requests"), Tbl("agent_reports", "created_at", 5), View("preferences"),
    Tbl("rfis", "updated_at"), Tbl("blog_posts", "updated_at"), Tbl("outreach_contacts"), Tbl("email_outbox", "created_at", 200)],
  abu: [Tbl("projects"), Tbl("subcontractors"), Tbl("txns"), Tbl("progress", "created_at", 5000), Tbl("items"), Tbl("prices"), Tbl("quotes", "updated_at"), View("project_ledger"), View("vat_by_company"), View("sub_ledger"),
    Tbl("suppliers"), Tbl("supplier_requests"), View("preferences")],
  engineer: [Tbl("projects"), Tbl("subcontractors"), Tbl("progress", "created_at", 5000), Tbl("quotes", "updated_at"), Tbl("documents"), Tbl("profiles")],
  supervisor: [Tbl("projects"), Tbl("txns"), Tbl("documents"), Rpc("sub_names", "sub_names"), Rpc("progress", "sup_progress"), View("preferences")],
};
// which base-table change refreshes which keys
const DERIVED: Record<string, string[]> = {
  txns: ["txns", "project_ledger", "vat_by_company", "sub_ledger"],
  progress: ["progress", "project_ledger", "sub_ledger"],
  subcontractors: ["subcontractors", "sub_ledger", "sub_names", "progress"],
  projects: ["projects", "project_ledger"],
  project_members: ["project_members", "projects", "progress"],
};

type FileSpec = { bucket: "receipts" | "documents"; uri: string; field: string; path: string; contentType?: string };
type Job = { id: string; table: string; row: any; file?: FileSpec; at: number };
const OUTBOX = "outbox:v1", FAILED = "outbox:failed:v1";

type Ctx = {
  profile: Profile; role: Role; lang: Lang; rtl: boolean; t: (k: string) => string;
  d: Record<string, any[]>; online: boolean; pending: number; failed: Job[];
  insert: (table: string, row: any, file?: FileSpec) => Promise<{ queued?: boolean; data?: any }>;
  update: (table: string, id: string, patch: any) => Promise<void>;
  reload: (keys?: string[]) => Promise<void>;
  setLang: (l: Lang) => Promise<void>;
  dropFailed: (id: string) => Promise<void>;
};
const C = createContext<Ctx | null>(null);
export const useData = () => useContext(C)!;

const isNetErr = (e: any) => /network|fetch|timed? ?out|offline/i.test(String(e?.message ?? e));

export function DataProvider({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const [d, setD] = useState<Record<string, any[]>>({});
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<Job[]>([]);
  const [lang, setLangS] = useState<Lang>(profile.lang);
  const reads = READS[profile.role];
  const timer = useRef<any>(null), dirty = useRef<Set<string>>(new Set());

  const reload = useCallback(async (keys?: string[]) => {
    const qs = keys ? reads.filter((q) => keys.includes(q.key)) : reads;
    const res = await Promise.all(qs.map(async (q) => { const { data, error } = await q.run(); return [q.key, error ? null : data] as const; }));
    setD((prev) => { const n = { ...prev }; res.forEach(([k, v]) => { if (v) n[k] = k === "sub_names" ? (v as any[]).map((x: any) => (typeof x === "string" ? x : x.sub_names)) : (v as any[]); }); return n; });
  }, [profile.role]);

  // live updates
  useEffect(() => {
    reload();
    const tables = [...new Set(reads.map((q) => (q.key === "sub_names" ? "subcontractors" : q.key)))].filter((k) => !["project_ledger", "vat_by_company", "sub_ledger", "audit_log", "locations", "profiles"].includes(k));
    const ch = supabase.channel("db-" + profile.id);
    tables.forEach((t) => ch.on("postgres_changes" as any, { event: "*", schema: "public", table: t }, () => {
      (DERIVED[t] ?? [t]).forEach((k) => dirty.current.add(k));
      if (profile.role === "admin") dirty.current.add("audit_log");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { const ks = [...dirty.current]; dirty.current.clear(); reload(ks); }, 600);
    }));
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile.id]);

  // offline queue
  const readBox = async (k: string): Promise<Job[]> => { try { return JSON.parse((await AsyncStorage.getItem(k)) || "[]"); } catch { return []; } };
  const writeBox = async (k: string, v: Job[]) => { await AsyncStorage.setItem(k, JSON.stringify(v)); };
  const refreshCounts = async () => { setPending((await readBox(OUTBOX)).length); setFailed(await readBox(FAILED)); };

  const send = async (j: Job) => {
    const row = { ...j.row };
    if (j.file) { await uploadFile(j.file.bucket, j.file.path, j.file.uri, j.file.contentType); row[j.file.field] = j.file.path; }
    // Supervisors may write progress but never read it back (rates are money), so they insert without reading.
    if (profile.role === "supervisor" && j.table === "progress") { const { error } = await supabase.from(j.table).insert(row); if (error) throw error; return null; }
    const { data, error } = await supabase.from(j.table).insert(row).select().single();
    if (error) {
      // Saved already (the first try reached the server but its reply was lost): read it back instead of saving twice.
      if (error.code === "23505" && row.id && /_pkey/.test(error.message || "")) { const { data: got } = await supabase.from(j.table).select().eq("id", row.id).single(); return got; }
      throw error;
    }
    return data;
  };
  const flushing = useRef(false);
  const flush = useCallback(async () => {
    if (flushing.current) return; flushing.current = true;
    try {
      let box = await readBox(OUTBOX);
      for (const j of [...box]) {
        try { await send(j); box = box.filter((x) => x.id !== j.id); await writeBox(OUTBOX, box); }
        catch (e: any) {
          if (isNetErr(e)) break;
          box = box.filter((x) => x.id !== j.id); await writeBox(OUTBOX, box);
          await writeBox(FAILED, [...(await readBox(FAILED)), { ...j, row: { ...j.row, _error: e.message } }]);
        }
      }
    } finally { flushing.current = false; refreshCounts(); }
  }, []);
  useEffect(() => {
    refreshCounts(); flush();
    // Laptop/web: trust the browser's own online flag (the reachability check can be blocked and wrongly say "offline").
    if (Platform.OS === "web") {
      const on = () => { setOnline(true); flush(); }, off = () => setOnline(false);
      setOnline(typeof navigator === "undefined" || navigator.onLine !== false);
      window.addEventListener("online", on); window.addEventListener("offline", off);
      return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
    }
    return NetInfo.addEventListener((s) => { const on = !!s.isConnected && s.isInternetReachable !== false; setOnline(on); if (on) flush(); });
  }, []);

  const insert = useCallback(async (table: string, row: any, file?: FileSpec) => {
    // Money and work entries get their id here, so a retry can never save the same entry twice.
    const job: Job = { id: genId(), table, row: ID_TABLES.includes(table) && !row.id ? { id: uuid4(), ...row } : row, file, at: Date.now() };
    try { const data = await send(job); reload(DERIVED[table] ?? [table]); return { data }; }
    catch (e: any) {
      if (!isNetErr(e)) throw new Error(e.message);
      await writeBox(OUTBOX, [...(await readBox(OUTBOX)), job]); refreshCounts();
      return { queued: true };
    }
  }, []);
  const update = useCallback(async (table: string, id: string, patch: any) => {
    // .select() returns the changed row: if nothing came back, the change was not allowed or the row is gone.
    const { data, error } = await supabase.from(table).update(patch).eq("id", id).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Not saved: you may not change this, or it was removed. Refresh and try again.");
    await reload(DERIVED[table] ?? [table]);
  }, []);
  const setLang = async (l: Lang) => { setLangS(l); await supabase.from("profiles").update({ lang: l }).eq("id", profile.id); };
  const dropFailed = async (id: string) => { await writeBox(FAILED, (await readBox(FAILED)).filter((j) => j.id !== id)); refreshCounts(); };

  const v = useMemo<Ctx>(() => ({
    profile, role: profile.role, lang, rtl: isRTL(lang), t: makeT(lang), d, online, pending, failed, insert, update, reload, setLang, dropFailed,
  }), [profile, lang, d, online, pending, failed]);
  return <C.Provider value={v}>{children}</C.Provider>;
}

// ── helpers over the loaded data ──
export const pname = (d: Record<string, any[]>, id?: string) => (d.projects || []).find((p) => p.id === id)?.name ?? "—";
export const companiesOf = (d: Record<string, any[]>) => {
  const s = new Set<string>();
  ((d.preferences || []).find((p: any) => p.key === "companies")?.value?.list || []).forEach((n: string) => n && s.add(n));
  (d.projects || []).forEach((p) => p.company && s.add(p.company));
  (d.txns || []).forEach((x) => x.vat_company && s.add(x.vat_company));
  return [...s];
};
export const active = (a: any[] = []) => a.filter((x) => x.status !== "cancelled");
