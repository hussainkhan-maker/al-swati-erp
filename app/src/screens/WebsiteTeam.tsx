// The website & marketing agents team (Claude, on a schedule): the Manager's daily report, each agent's last run, the
// owner's to-do list (things only he can do: sign-ins, approvals, buttons on Google — each with the page to open), and the
// "New project for the website" form the Projects agent works from (photos + a few facts → project page, area page, Google).
import React, { useEffect, useState } from "react";
import { Image, Linking, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { stamp } from "../lib/fmt";
import { supabase } from "../lib/supabase";
import { Btn, Card, Field, H2, Icon, Pill, Row, Select, Sheet, T, useColors } from "../ui";

const AGENTS = [
  { key: "manager", name: "Manager", job: "Sab agents ka kaam check karta hai, kaam baantta hai aur aap ko roz report deta hai", when: "Roz 7:31" },
  { key: "website_doctor", name: "Website Doctor", job: "Har page check karta hai: toote links, photos, titles, Google data; chhoti ghaltiyan khud theek", when: "Roz 6:47" },
  { key: "seo", name: "SEO agent", job: "Google searches, competitors aur trends dekh kar pages behtar karta hai aur naye pages banata hai", when: "Itwaar aur Budh 9:13" },
  { key: "projects", name: "Projects agent", job: "Aap ke naye project ki photos saaf kar ke project page aur area page banata aur publish karta hai", when: "Har 3 ghante, jab naya project ho" },
  { key: "maps", name: "Google Maps agent", job: "Google Business Profile ke liye har hafte update tayyar karta hai", when: "Jumeraat 11:07" },
];
const RUN: Record<string, [string, "good" | "warn" | "bad" | "plain"]> = {
  ok: ["OK", "good"], warn: ["Dekhein", "warn"], action: ["Aap ka kaam", "bad"], failed: ["Ruk gaya", "bad"], running: ["Chal raha hai", "plain"],
};
const BUILDINGS = [{ value: "villa", label: "Villa" }, { value: "villas", label: "Villas (kai)" }, { value: "compound", label: "Residential compound" }, { value: "commercial", label: "Commercial building" }, { value: "tower", label: "Tower" }, { value: "government", label: "Government building" }];
const MATERIALS = ["Riyadh Limestone", "Limestone", "Porcelain", "Marble", "Granite", "Travertine"].map((x) => ({ value: x, label: x }));
const SCOPES = [{ value: "supply_install", label: "Supply + installation" }, { value: "install", label: "Sirf installation" }, { value: "supply", label: "Sirf supply" }];
const FIXINGS = [{ value: "Up-Down", label: "Up-Down" }, { value: "PEN", label: "PEN" }, { value: "C-Channel", label: "C-Channel" }, { value: "Undercut", label: "Undercut" }];
const PSTATUS: Record<string, [string, "good" | "warn" | "bad" | "plain"]> = { new: ["Line mein", "plain"], working: ["Ban raha hai", "warn"], done: ["Website par", "good"], failed: ["Masla", "bad"] };

async function copyText(s: string) { try { await (navigator as any).clipboard.writeText(s); return true; } catch { return false; } }

export default function WebsiteTeam() {
  const c = useColors();
  const [runs, setRuns] = useState<any[]>([]), [acts, setActs] = useState<any[]>([]), [tasks, setTasks] = useState(0), [note, setNote] = useState(""), [showAll, setShowAll] = useState(false);
  const load = async () => {
    const [r, a, t] = await Promise.all([
      supabase.from("agent_runs").select("*").order("started_at", { ascending: false }).limit(60),
      supabase.from("owner_actions").select("*").eq("status", "open").order("priority").order("created_at", { ascending: false }).limit(50),
      supabase.from("agent_tasks").select("id", { count: "exact", head: true }).in("status", ["open", "doing", "blocked"]),
    ]);
    setRuns(r.data || []); setActs(a.data || []); setTasks(t.count || 0);
  };
  useEffect(() => { load(); }, []);
  const last = (k: string) => runs.find((x) => x.agent === k);
  const mgr = runs.find((x) => x.agent === "manager" && x.status !== "running");
  const done = async (a: any, status: "done" | "skipped") => {
    const { error } = await supabase.from("owner_actions").update({ status, done_at: new Date().toISOString() }).eq("id", a.id);
    if (error) setNote(error.message); else { setActs(acts.filter((x) => x.id !== a.id)); setNote(status === "done" ? "Shukriya, agents ko pata chal jayega." : "Chhor diya."); }
  };
  const shown = showAll ? acts : acts.slice(0, 6);
  return (
    <>
      <Card>
        <Row><Icon name="spark" color={c.accent} /><H2>Website team · Manager ki report</H2></Row>
        {mgr ? <><T size={15}>{mgr.summary || "Report khali hai."}</T><T size={12} muted>{stamp(mgr.finished_at || mgr.started_at)}</T></>
          : <T muted>Pehli report kal subah 7:31 par aayegi. Manager roz sab agents ka kaam dekh kar yahan aur aap ke phone par report deta hai.</T>}
      </Card>
      <Card>
        <Row><Icon name="check" color={c.accent} /><View style={{ flex: 1 }}><H2>Aap ke kaam ({acts.length})</H2></View><Btn kind="ghost" title="Refresh" onPress={load} /></Row>
        <T size={13} muted>Ye wo kaam hain jo sirf aap kar sakte hain (login, approval, Google par button). Har kaam ke saath us page ka link hai.</T>
        {!acts.length ? <T muted>Abhi koi kaam nahi.</T> : null}
        {shown.map((a) => (
          <View key={a.id} style={{ gap: 6, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.line }}>
            <Row wrap>{a.priority === 1 ? <Pill kind="bad" text="Zaroori" /> : null}<T bold style={{ flex: 1 }}>{a.title}</T></Row>
            {a.why ? <T size={13} muted>{a.why}</T> : null}
            {a.steps ? <T size={14} style={{ userSelect: "text" } as any}>{a.steps}</T> : null}
            <Row wrap>
              {a.url ? <Btn kind="primary" icon={<Icon name="share" color={c.accentInk} />} title="Page kholen" onPress={() => Linking.openURL(a.url)} /> : null}
              {a.steps ? <Btn kind="ghost" title="Copy" onPress={async () => setNote((await copyText(a.steps)) ? "Copy ho gaya." : "Copy nahi hua: text select kar ke copy karein.")} /> : null}
              <Btn kind="ghost" icon={<Icon name="check" />} title="Ho gaya" onPress={() => done(a, "done")} />
              <Btn kind="ghost" title="Chhor dein" onPress={() => done(a, "skipped")} />
            </Row>
            <T size={11} muted>{AGENTS.find((x) => x.key === a.agent)?.name || a.agent} · {stamp(a.created_at)}</T>
          </View>))}
        {acts.length > 6 ? <Btn kind="ghost" title={showAll ? "Kam dikhayen" : `Sab ${acts.length} dikhayen`} onPress={() => setShowAll(!showAll)} /> : null}
        {note ? <T size={13} muted>{note}</T> : null}
      </Card>
      <NewWebsiteProject onSaved={load} />
      {AGENTS.map((a) => {
        const r = last(a.key), st = r ? RUN[r.status] || [r.status, "plain"] : ["Abhi chala nahi", "plain"];
        return (
          <Card key={a.key}>
            <Row><Icon name={a.key === "manager" ? "people" : a.key === "projects" ? "camera" : a.key === "maps" ? "pin" : "spark"} color={c.accent} />
              <View style={{ flex: 1 }}><T bold>{a.name}</T><T muted size={13}>{a.job}</T></View><Pill kind={st[1] as any} text={st[0]} /></Row>
            {r?.summary && a.key !== "manager" ? <T size={14}>{r.summary}</T> : null}
            <T size={12} muted>{a.when}{r ? ` · aakhri baar ${stamp(r.finished_at || r.started_at)}` : ""}</T>
          </Card>);
      })}
      <T size={12} muted>{tasks} kaam agents ke paas khule hain. Videos aur blog pictures Growth → Videos aur Blog mein dikhte hain.</T>
    </>
  );
}

/** "New project for the website": the owner adds photos and a few facts; the Projects agent does the rest within about 3 hours. */
export function NewWebsiteProject({ onSaved }: { onSaved?: () => void }) {
  const c = useColors();
  const blank = () => ({ name: "", district: "", building: "villa", material: "Riyadh Limestone", other: "", m2: "", ongoing: true, year: String(new Date().getFullYear()), scope: "supply_install", fixing: [] as string[], client: "", show_client: false, partner: false, notes: "", photos: [] as { uri: string; url: string }[] });
  const [f, setF] = useState<any>(null), [busy, setBusy] = useState(""), [err, setErr] = useState(""), [list, setList] = useState<any[]>([]);
  const load = async () => { const { data } = await supabase.from("website_projects").select("*").order("created_at", { ascending: false }).limit(10); setList(data || []); };
  useEffect(() => { load(); }, []);
  const addPhotos = async () => {
    setErr("");
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (!perm.granted) return;
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 15, quality: 0.9 });
      if (res.canceled || !res.assets?.length) return;
      setBusy("photo");
      const added: { uri: string; url: string }[] = [];
      for (const a of res.assets.slice(0, 15 - f.photos.length)) {
        const small = await ImageManipulator.manipulateAsync(a.uri, [{ resize: { width: 2000 } }], { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG });
        const path = `cases/uploads/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const buf = await (await fetch(small.uri)).arrayBuffer();
        const { error } = await supabase.storage.from("blog").upload(path, buf, { contentType: "image/jpeg", upsert: false });
        if (error) throw new Error(error.message);
        added.push({ uri: small.uri, url: supabase.storage.from("blog").getPublicUrl(path).data.publicUrl });
      }
      setF((x: any) => ({ ...x, photos: [...x.photos, ...added] }));
    } catch (e: any) { setErr("Photo: " + e.message); } finally { setBusy(""); }
  };
  const save = async () => {
    setErr("");
    if (!f.district.trim()) return setErr("District likhein (jaise Al Nakheel).");
    if (f.photos.length < 2) return setErr("Kam az kam 2 photos daalein (har angle se jitni ho sakein).");
    setBusy("save");
    const material = f.material === "Other" ? f.other.trim() || "Natural stone" : f.material;
    const { error } = await supabase.from("website_projects").insert({ name: f.name.trim(), district: f.district.trim(), building: f.building, material, m2: Number(String(f.m2).replace(/[^\d.]/g, "")) || null,
      ongoing: f.ongoing, year: Number(f.year) || new Date().getFullYear(), scope: f.scope, fixing: f.fixing, client: f.client.trim() || null, show_client: f.show_client && !!f.client.trim(),
      partner: f.partner && !!f.client.trim(), notes: f.notes.trim(), photos: f.photos.map((x: any) => x.url) });
    setBusy("");
    if (error) return setErr(error.message);
    setF(null); load(); onSaved?.();
  };
  const tog = (k: string) => setF({ ...f, fixing: f.fixing.includes(k) ? f.fixing.filter((x: string) => x !== k) : [...f.fixing, k] });
  return (
    <Card>
      <Row><Icon name="camera" color={c.accent} /><View style={{ flex: 1 }}><H2>Naya project website par</H2></View><Btn kind="primary" icon={<Icon name="plus" color={c.accentInk} />} title="Project add karein" onPress={() => { setErr(""); setF(blank()); }} /></Row>
      <T size={13} muted>Photos aur 4–5 baatein daalein. Projects agent 3 ghante ke andar photos saaf (board, gariyan, malba hata kar), project page aur area page bana kar publish kar dega.</T>
      {list.map((p) => {
        const st = PSTATUS[p.status] || [p.status, "plain"], r = p.result || {};
        return (
          <View key={p.id} style={{ gap: 4, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.line }}>
            <Row wrap><T bold style={{ flex: 1 }}>{p.name || `${p.material} · ${p.district}`}</T><Pill kind={st[1] as any} text={st[0]} /></Row>
            <T size={12} muted>{p.district} · {p.m2 ? `${p.m2} m² · ` : ""}{p.ongoing ? "jari" : "mukammal"} · {p.photos?.length || 0} photos · {stamp(p.created_at)}</T>
            {p.error ? <T size={13} color={c.bad}>{p.error}</T> : null}
            {r.case_en ? <Row wrap><Btn kind="ghost" title="Project page" onPress={() => Linking.openURL(r.case_en)} />{r.district_en ? <Btn kind="ghost" title="Area page" onPress={() => Linking.openURL(r.district_en)} /> : null}</Row> : null}
          </View>);
      })}
      <Sheet open={!!f} onClose={() => setF(null)} title="Naya project website par">
        {f && <>
          <T size={13} muted>Sirf sachi baatein likhein: website par wahi likha jayega. Address kabhi nahi, sirf district.</T>
          <Field label="District (jaise Al Nakheel, Al Aqiq, Irqa)" value={f.district} onChange={(v) => setF({ ...f, district: v })} required />
          <Field label="Project ka naam (sirf aap ke liye, optional)" value={f.name} onChange={(v) => setF({ ...f, name: v })} />
          <Row wrap>
            <Select label="Building" value={f.building} options={BUILDINGS} onChange={(v) => setF({ ...f, building: v })} style={{ minWidth: 180 }} />
            <Select label="Material" value={f.material} options={[...MATERIALS, { value: "Other", label: "Other" }]} onChange={(v) => setF({ ...f, material: v })} style={{ minWidth: 180 }} />
          </Row>
          {f.material === "Other" ? <Field label="Material ka naam" value={f.other} onChange={(v) => setF({ ...f, other: v })} /> : null}
          <Row wrap>
            <Field label="Kul kaam, m²" numeric value={f.m2} onChange={(v) => setF({ ...f, m2: v })} />
            <Field label="Saal" numeric value={f.year} onChange={(v) => setF({ ...f, year: v })} />
          </Row>
          <Row wrap>
            <Btn kind={f.ongoing ? "primary" : "ghost"} title="Kaam jari hai" onPress={() => setF({ ...f, ongoing: true })} />
            <Btn kind={!f.ongoing ? "primary" : "ghost"} title="Mukammal ho gaya" onPress={() => setF({ ...f, ongoing: false })} />
          </Row>
          <Select label="Hamara kaam" value={f.scope} options={SCOPES} onChange={(v) => setF({ ...f, scope: v })} />
          <T bold size={14}>Fixing system (agar pata ho)</T>
          <Row wrap>{FIXINGS.map((x) => <Btn key={x.value} kind={f.fixing.includes(x.value) ? "primary" : "ghost"} title={x.label} onPress={() => tog(x.value)} />)}</Row>
          <Field label="Client / developer ka naam (optional)" value={f.client} onChange={(v) => setF({ ...f, client: v })} />
          {f.client.trim() ? <>
            <Btn kind={f.show_client ? "primary" : "ghost"} icon={f.show_client ? <Icon name="check" color={c.accentInk} /> : undefined} title="Website par client ka naam likh sakte hain" onPress={() => setF({ ...f, show_client: !f.show_client })} />
            <Btn kind={f.partner ? "primary" : "ghost"} icon={f.partner ? <Icon name="check" color={c.accentInk} /> : undefined} title="Home page ke Trusted Partners mein bhi add karein" onPress={() => setF({ ...f, partner: !f.partner })} />
          </> : null}
          <Field label="Koi khaas baat? (optional, sirf sach)" value={f.notes} multiline onChange={(v) => setF({ ...f, notes: v })} placeholder="jaise: 3 cm Riyadh stone, Up-Down, 3 manzila villa, cornices bhi same stone mein" />
          <T bold size={14}>Photos ({f.photos.length} / 15) — har angle se</T>
          <Row wrap>
            {f.photos.map((x: any, i: number) => (
              <View key={x.url} style={{ gap: 4 }}>
                <Image source={{ uri: x.uri }} accessibilityLabel={`Photo ${i + 1}`} style={{ width: 96, height: 72, borderRadius: 6, backgroundColor: c.sunk }} />
                <Btn kind="ghost" title="Hatayen" onPress={() => setF({ ...f, photos: f.photos.filter((y: any) => y.url !== x.url) })} />
              </View>))}
          </Row>
          {f.photos.length < 15 ? <Btn icon={<Icon name="camera" />} title={busy === "photo" ? "Photos upload ho rahi hain…" : "Photos add karein"} busy={busy === "photo"} disabled={!!busy} onPress={addPhotos} /> : null}
          {err ? <T color={c.bad}>{err}</T> : null}
          <Btn big kind="primary" icon={<Icon name="check" color={c.accentInk} />} title="Projects agent ko bhejein" busy={busy === "save"} disabled={!!busy} onPress={save} />
          <T size={12} muted>Agent 3 ghante ke andar kaam shuru karega. Pages ban jayen to yahan "Website par" likha aayega.</T>
        </>}
      </Sheet>
    </Card>
  );
}
