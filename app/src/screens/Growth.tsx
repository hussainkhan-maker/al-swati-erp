// Growth: company profile, blog posts for search engines (SEO) and personal outreach to project managers.
// The AI only drafts. Posts go public only when the owner presses Publish; every email is read and sent by the owner himself.
import React, { useEffect, useRef, useState } from "react";
import { Image, Linking, Platform, View } from "react-native";
import { useData } from "../lib/data";
import { day, stamp } from "../lib/fmt";
import { ai, supabase } from "../lib/supabase";
import { pickPhoto } from "../lib/files";
import { NewWebsiteProject } from "./WebsiteTeam";
import { Btn, Card, Empty, Field, H1, H2, Icon, Pill, Row, Screen, Select, Sheet, StatStrip, Table, T, useColors } from "../ui";

// Published posts live on the company website, where they count for its Google ranking: built as real pages by the
// "Blog from the ERP" workflow of the al-swati-website repository (English /blog/<slug>/, Arabic /ar/blog/<slug without -ar>/).
export const SITE_URL = "https://al-swaticontracting.com";
export const BLOG_URL = SITE_URL + "/blog/";
export const postUrl = (p: { slug: string; lang?: string; target_path?: string | null }) => SITE_URL + (p.target_path ? p.target_path : p.lang === "ar" ? `/ar/blog/${String(p.slug).replace(/-ar$/, "")}/` : `/blog/${p.slug}/`);
const PRICE_BLANK = /\[SAR\s*_+|_{3,}\s*[–-]\s*_{3,}/; // the price table still has the owner's blanks
/** Ask the website to rebuild now (it also rebuilds on its own schedule). Never blocks or fails the editor. */
const siteRebuild = () => { supabase.functions.invoke("seo", { body: { action: "site_rebuild" } }).catch(() => {}); };
/** Instant indexing. After Publish the website build tells the seo function, which pings IndexNow (Bing, Yandex and the others)
 *  and resubmits the sitemap to Google Search Console; index_status keeps one row per address, with Google's own status. */
const ixUrl = (u: string) => (/\.[a-z0-9]{2,5}$/i.test(u) || u.endsWith("/") ? u : u + "/");
const riyadhTime = (t: string) => new Date(Date.parse(t) + 3 * 3600e3).toISOString().slice(0, 16).replace("T", " "); // Riyadh is UTC+3 all year
/** Reads index_status every minute. Once per screen, Google's status is refreshed for up to 10 of these pages not checked for a day. */
function useIndexStatus(urls: string[]) {
  const [rows, setRows] = useState<Record<string, any>>({}), [loaded, setLoaded] = useState(false), checked = useRef(false);
  const put = (list: any[]) => setRows((m) => ({ ...m, ...Object.fromEntries((list || []).map((r: any) => [r.url, r])) }));
  const load = async () => {
    const { data } = await supabase.from("index_status").select("*").limit(2000);
    if (data) { setRows(Object.fromEntries(data.map((r: any) => [r.url, r]))); setLoaded(true); }
  };
  useEffect(() => { load(); const i = setInterval(load, 60000); return () => clearInterval(i); }, []);
  useEffect(() => {
    if (!loaded || checked.current || !urls.length) return;
    checked.current = true;
    const due = urls.map(ixUrl).filter((u) => { const r = rows[u]; return !r?.google_checked_at || Date.now() - Date.parse(r.google_checked_at) > 864e5; }).slice(0, 10);
    if (due.length) supabase.functions.invoke("seo", { body: { action: "index_check", urls: due } }).then(({ data }) => put(data?.rows || [])).catch(() => {});
  }, [loaded, urls.length]);
  return { rows, put };
}
/** Under a published page: "Indexed Ping Sent ✓" once IndexNow has the address, Google's own status, and "Re-ping Google". */
function IndexLine({ url: raw, rows, onRows, label, onGbp }: { url: string; rows: Record<string, any>; onRows: (rows: any[]) => void; label?: string; onGbp?: () => void }) {
  const url = ixUrl(raw), st = rows[url];
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const took = (n: any) => n === 200 || n === 202;
  const reping = async () => {
    setBusy(true); setMsg("");
    try {
      const { data, error } = await supabase.functions.invoke("seo", { body: { action: "index_reping", url } });
      if (error) { let m = error.message; try { const j = await (error as any).context?.json?.(); if (j?.error) m = j.error; } catch {} throw new Error(m); }
      if (data?.error) throw new Error(data.error);
      onRows(data.rows || []);
      const sm = data.sent?.sitemap || {};
      setMsg(`IndexNow ${took(data.sent?.indexnow) ? "received it" : "answered " + (data.sent?.indexnow || "nothing")}. Google: ${took(sm.code) || sm.code === 204 ? "sitemap resubmitted" : sm.why || "sitemap not resubmitted"}.`);
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 4 }}>
      <Row wrap>
        {label ? <T size={12} muted>{label}</T> : null}
        {took(st?.indexnow_code) ? <Pill kind="good" text={`Indexed Ping Sent ✓ ${riyadhTime(st.indexnow_at)}`} />
          : st?.indexnow_at ? <Pill kind="bad" text={`IndexNow answered ${st.indexnow_code || "nothing"}`} /> : <Pill text="Not pinged yet" />}
        {st?.google_verdict === "PASS" ? <Pill kind="good" text="Google: indexed ✓" />
          : st?.google_state ? <Pill kind="warn" text={"Google: " + st.google_state} />
          : st?.google_error ? <Pill text="Google: status not read" /> : null}
        <Btn kind="ghost" title="Re-ping Google" busy={busy} disabled={busy} onPress={reping} />
        {onGbp ? <Btn kind="ghost" title="Copy for Google Business Profile" onPress={onGbp} /> : null}
      </Row>
      {msg ? <T size={12} muted>{msg}</T> : null}
    </View>);
}

// ───────── Google Maps (Business Profile) & reviews ─────────
const REVIEW_LINK = "https://search.google.com/local/writereview?placeid=ChIJAZHiKg0cOaoRQl8W3DNsZ9I"; // opens the review box on our Google Maps profile
const pageLink = (p: any) => (p.target_path ? SITE_URL + p.target_path : postUrl(p));
/** "Copy for Google Business Profile": the AI writes a short update (English + Saudi Arabic) about a published page. */
function GbpSheet({ p, onClose }: { p: any; onClose: () => void }) {
  const c = useColors(); const profile = useProfile();
  const url = pageLink(p);
  const [m, setM] = useState<any>(null), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [note, setNote] = useState("");
  const write = async () => {
    setBusy(true); setErr(""); setNote("");
    try {
      const area = p.area ? (({ photos, ...rest }: any) => rest)(p.area) : null;
      const text = [p.meta_description, String(p.body || "").replace(/[#*_>|`]/g, " ").replace(/\s+/g, " ").slice(0, 3000)].filter(Boolean).join("\n");
      setM(await ai("gbp_post", { page: { title: p.title, lang: p.lang, url, text, area } }));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { write(); }, []);
  const copy = async (s: string, what: string) => { try { await (navigator as any).clipboard.writeText(s); setNote(`${what} copied.`); } catch { setNote("Copy did not work: select the text and copy it."); } };
  const words = (s: string) => String(s || "").split(/\s+/).filter(Boolean).length;
  return (
    <Sheet open onClose={onClose} title="Update for Google Business Profile">
      <T size={13} muted>{`Google Maps → your business → Add update → paste the English or the Arabic text → add a photo of this work → add the button "Call now" (it rings your verified number ${profile.phone || "+966 51 182 6313"}) or "Learn more" with the link below. Google may remove updates that have a phone number or link written in the text, so they go on the button.`}</T>
      {busy && !m ? <T>Writing… (about 10 seconds)</T> : null}
      {m ? <>
        <Field label={`English · ${words(m.en)} words`} value={m.en} multiline onChange={(v) => setM({ ...m, en: v })} />
        <Row wrap><Btn kind="primary" title="Copy English" onPress={() => copy(m.en, "English")} /></Row>
        <Field label={`العربية · ${words(m.ar)} كلمة`} value={m.ar} multiline onChange={(v) => setM({ ...m, ar: v })} />
        <Row wrap><Btn kind="primary" title="نسخ النص العربي" onPress={() => copy(m.ar, "Arabic")} /></Row>
        <Row wrap><View style={{ flex: 1, minWidth: 220 }}><T size={13} muted>{`Link for the "Learn more" button: ${url}`}</T></View><Btn kind="ghost" title="Copy link" onPress={() => copy(url, "Link")} /></Row>
        <Btn kind="ghost" icon={<Icon name="spark" />} title="Write again" busy={busy} disabled={busy} onPress={write} />
      </> : null}
      {note ? <T size={12} color={c.good}>{note}</T> : null}
      {err ? <T color={c.bad}>{err}</T> : null}
    </Sheet>);
}
/** EXIF for a JPEG: the district's centre as GPS (marked approximate, about 1.5 km), Artist, Copyright and a description.
 *  Whatever the file had is dropped first, so a phone's exact location of a client's house never leaves the ERP. Same as the website build. */
function withGps(src: Uint8Array, lat: number, lng: number, { errorM = 1500, artist = "AL-Swati Contracting", copyright = "AL-Swati Contracting", description = "" } = {}): Uint8Array {
  if (src[0] !== 0xff || src[1] !== 0xd8) return src;
  // no district centre: the old EXIF is still dropped, and no GPS is written
  const hasGps = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
  const ascii = (s: string) => String(s || "").replace(/[^\x20-\x7e]/g, "").slice(0, 200);
  const keep: Uint8Array[] = [];
  let i = 2;
  while (i + 4 <= src.length && src[i] === 0xff) {
    const m = src[i + 1];
    if (m === 0xda || m === 0xd9) break;
    const len = (src[i + 2] << 8) | src[i + 3], seg = src.subarray(i, i + 2 + len);
    if (!(m === 0xe1 && seg[4] === 0x45 && seg[5] === 0x78 && seg[6] === 0x69 && seg[7] === 0x66)) keep.push(seg);
    i += 2 + len;
  }
  const rest = src.subarray(i);
  const dms = (x: number) => { const a = Math.abs(x), d = Math.floor(a), mf = (a - d) * 60, mi = Math.floor(mf), s = Math.round((mf - mi) * 60 * 100); return [[d, 1], [mi, 1], [s, 100]]; };
  type E = { tag: number; type: number; str?: string; rats?: number[][]; bytes?: number[]; gps?: boolean };
  const ifd0: E[] = [];
  if (ascii(description)) ifd0.push({ tag: 0x010e, type: 2, str: ascii(description) });
  if (ascii(artist)) ifd0.push({ tag: 0x013b, type: 2, str: ascii(artist) });
  if (ascii(copyright)) ifd0.push({ tag: 0x8298, type: 2, str: ascii(copyright) });
  if (hasGps) ifd0.push({ tag: 0x8825, type: 4, gps: true });
  const gps: E[] = !hasGps ? [] : [{ tag: 0x0000, type: 1, bytes: [2, 3, 0, 0] }, { tag: 0x0001, type: 2, str: lat >= 0 ? "N" : "S" }, { tag: 0x0002, type: 5, rats: dms(lat) },
    { tag: 0x0003, type: 2, str: lng >= 0 ? "E" : "W" }, { tag: 0x0004, type: 5, rats: dms(lng) }, { tag: 0x0012, type: 2, str: "WGS-84" }, { tag: 0x001f, type: 5, rats: [[Math.round(errorM), 1]] }];
  const size = (e: E) => (e.str !== undefined ? e.str.length + 1 : e.rats ? e.rats.length * 8 : e.bytes ? e.bytes.length : 4);
  const count = (e: E) => (e.str !== undefined ? e.str.length + 1 : e.rats ? e.rats.length : e.bytes ? e.bytes.length : 1);
  const ifdLen = (n: number) => 2 + n * 12 + 4, ifd0At = 8, gpsAt = ifd0At + ifdLen(ifd0.length);
  let dataAt = gpsAt + (gps.length ? ifdLen(gps.length) : 0);
  const extra = (l: E[]) => l.filter((e) => size(e) > 4).reduce((n, e) => n + size(e) + (size(e) & 1), 0);
  const t = new Uint8Array(dataAt + extra(ifd0) + extra(gps)), v = new DataView(t.buffer);
  t.set([0x4d, 0x4d, 0, 42, 0, 0, 0, ifd0At]);
  const writeIfd = (at: number, list: E[]) => {
    v.setUint16(at, list.length); let q = at + 2;
    for (const e of list) {
      v.setUint16(q, e.tag); v.setUint16(q + 2, e.type); v.setUint32(q + 4, count(e));
      const put = (o: number) => {
        if (e.str !== undefined) { for (let k = 0; k < e.str.length; k++) t[o + k] = e.str.charCodeAt(k); t[o + e.str.length] = 0; }
        else if (e.rats) e.rats.forEach(([a, b], k) => { v.setUint32(o + k * 8, a); v.setUint32(o + k * 8 + 4, b); });
        else if (e.bytes) t.set(e.bytes, o);
      };
      if (e.gps) v.setUint32(q + 8, gpsAt); else if (size(e) <= 4) put(q + 8); else { v.setUint32(q + 8, dataAt); put(dataAt); dataAt += size(e) + (size(e) & 1); }
      q += 12;
    }
    v.setUint32(q, 0);
  };
  writeIfd(ifd0At, ifd0); if (gps.length) writeIfd(gpsAt, gps);
  const len = 2 + 6 + t.length, app1 = new Uint8Array(2 + len);
  app1.set([0xff, 0xe1, len >> 8, len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0]); app1.set(t, 10);
  const parts = [new Uint8Array([0xff, 0xd8]), ...keep.filter((x) => x[1] === 0xe0), app1, ...keep.filter((x) => x[1] !== 0xe0), rest];
  const res = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let o = 0; for (const a of parts) { res.set(a, o); o += a.length; }
  return res;
}
const matOf = (a: any) => { const s = String(a?.stone || ""); return /marble|travertine|رخام/i.test(s) ? "marble" : /granite|جرانيت/i.test(s) ? "granite" : /porcelain|بورسلان/i.test(s) ? "porcelain" : "stone"; };
/** Searchable file name, the same one the website uses: mechanical-stone-cladding-al-malqa-riyadh-01 */
const photoName = (a: any, i: number) => {
  const place = String(a?.district || a?.slug || "riyadh").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `mechanical-${matOf(a)}-cladding-${place && place !== "riyadh" ? place + "-" : ""}riyadh-${String(i + 1).padStart(2, "0")}`;
};
/** "Photos for Google Maps": downloads the page's photos with searchable names and the district's GPS (web). */
async function downloadMapPhotos(p: any): Promise<string> {
  const doc = (globalThis as any).document;
  if (Platform.OS !== "web" || !doc) return "Open the ERP on a computer to download the photos.";
  const a = p.area || {}; let n = 0;
  for (const [i, ph] of (a.photos || []).entries()) {
    const r = await fetch(ph.url).catch(() => null);
    if (!r?.ok) continue;
    const out = withGps(new Uint8Array(await r.arrayBuffer()), Number(a.lat), Number(a.lng), { description: `Mechanical ${matOf(a)} cladding${a.district ? ", " + a.district : ""}, Riyadh - AL-Swati Contracting` });
    const link = doc.createElement("a");
    link.href = URL.createObjectURL(new Blob([out], { type: "image/jpeg" })); link.download = photoName(a, i) + ".jpg";
    doc.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    n++; await new Promise((res) => setTimeout(res, 500));
  }
  return n ? `${n} photo${n > 1 ? "s" : ""} downloaded with searchable names and the district's location (approximate). Add them in Google Maps → your business → Photos, or to an update.` : "No photos on this page.";
}
const HOODS: [string, string][] = [["Al Narjis", "النرجس"], ["Al Malqa", "الملقا"], ["Hittin", "حطين"], ["Al Yasmin", "الياسمين"], ["Diriyah", "الدرعية"], ["Al Olaya", "العليا"],
  ["Al Nakheel", "النخيل"], ["Qurtubah", "قرطبة"], ["Al Aqiq", "العقيق"], ["Al Sahafa", "الصحافة"], ["Al Arid", "العارض"], ["Al Qirawan", "القيروان"], ["Al Rabi", "الربيع"],
  ["Al Nada", "الندى"], ["Al Wadi", "الوادي"], ["Al Ghadir", "الغدير"], ["Al Muruj", "المروج"], ["Al Mughrizat", "المغرزات"], ["Al Izdihar", "الازدهار"], ["Al Rawdah", "الروضة"],
  ["Al Hamra", "الحمراء"], ["Al Malaz", "الملز"], ["Al Sulimaniyah", "السليمانية"], ["Al Wurud", "الورود"], ["Al Rimal", "الرمال"], ["Al Munsiyah", "المونسية"], ["Tuwaiq", "طويق"],
  ["Dhahrat Laban", "ظهرة لبن"], ["Al Khuzama", "الخزامى"], ["Al Rahmaniyah", "الرحمانية"], ["Al Mursalat", "المرسلات"], ["Al Nuzha", "النزهة"], ["Al Muhammadiyah", "المحمدية"]];
const WORKS = [{ en: "mechanical stone cladding", ar: "تركيب الحجر الميكانيكي" }, { en: "marble cladding", ar: "تركيب الرخام" }, { en: "granite cladding", ar: "تركيب الجرانيت" }, { en: "porcelain facade", ar: "تركيب واجهة البورسلان" }];
const PLACES = [{ en: "villa", ar: "لفلتكم" }, { en: "building", ar: "لمبناكم" }, { en: "palace", ar: "لقصركم" }];
const waTo = (phone: string) => { let n = String(phone || "").replace(/\D/g, ""); if (n.startsWith("00")) n = n.slice(2); if (n.startsWith("05")) n = "966" + n.slice(1); else if (n.startsWith("5") && n.length === 9) n = "966" + n; return n; };
/** Growth → Google Maps: a review request for a finished client, and how to keep the Business Profile active. */
function MapsBooster() {
  const { profile: me } = useData() as any; const c = useColors();
  const hussain = /hussain/i.test(me?.name || "");
  const [f, setF] = useState<any>({ name: "", phone: "", hood: "Al Narjis", other: "", otherAr: "", work: "0", place: "0", from: hussain ? "Hussain" : me?.name || "", fromAr: hussain ? "حسين" : me?.name || "" });
  const [note, setNote] = useState("");
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const hood = f.hood === "Other" ? [f.other.trim(), f.otherAr.trim() || f.other.trim()] : HOODS.find((h) => h[0] === f.hood) || ["", ""];
  const w = WORKS[Number(f.work)] || WORKS[0], pl = PLACES[Number(f.place)] || PLACES[0];
  const where = hood[0] ? ` in ${hood[0]}, Riyadh` : " in Riyadh", whereAr = hood[1] ? ` في حي ${hood[1]} بالرياض` : " بالرياض";
  const en = `Hello${f.name.trim() ? " " + f.name.trim() : ""},\n\nThis is ${f.from || "the team"} from AL-Swati Contracting. Thank you for trusting us with the ${w.en} of your ${pl.en}${where}.\n\nIf you have a minute, we would be grateful for your honest review on Google. It helps other families in Riyadh choose their contractor. If you like, mention the work we did, for example "${w.en}${where}".\n\n${REVIEW_LINK}\n\nThank you,\n${f.from ? f.from + ", " : ""}AL-Swati Contracting`;
  const ar = `السلام عليكم${f.name.trim() ? " " + f.name.trim() : ""}،\n\nمعك ${f.fromAr || "فريق"} من شركة السواتي للمقاولات. نشكركم على ثقتكم فينا في ${w.ar} ${pl.ar}${whereAr}.\n\nإذا عندك دقيقة، يسعدنا تكتب رأيك الصادق عنا في قوقل، لأنه يساعد غيرك من أهل الرياض يختارون المقاول المناسب. وإذا حاب، اذكر الشغل اللي سويناه، مثل: "${w.ar}${whereAr}".\n\n${REVIEW_LINK}\n\nشاكرين لك،\n${f.fromAr ? f.fromAr + " - " : ""}شركة السواتي للمقاولات`;
  const copy = async (s: string, what: string) => { try { await (navigator as any).clipboard.writeText(s); setNote(`${what} message copied.`); } catch { setNote("Copy did not work: select the text and copy it."); } };
  const send = (s: string) => Linking.openURL(`https://wa.me/${waTo(f.phone)}?text=${encodeURIComponent(s)}`);
  const phoneOk = waTo(f.phone).length >= 11;
  return (
    <>
      <Card>
        <H2>Ask a client for a Google review</H2>
        <T size={13} muted>For a client whose job is finished. You send it yourself on WhatsApp. Google's rules: ask every finished client, happy or not; never ask for a number of stars and never give anything for a review, or Google can remove the reviews.</T>
        <Row wrap>
          <Field label="Client name" value={f.name} onChange={(v) => set("name", v)} placeholder="e.g. Abu Fahad" />
          <Field label="WhatsApp number" value={f.phone} onChange={(v) => set("phone", v)} placeholder="05x xxx xxxx" style={{ maxWidth: 220 }} />
        </Row>
        <Row wrap>
          <Select label="Neighborhood" value={f.hood} options={[...HOODS.map((h) => ({ value: h[0], label: `${h[0]} · ${h[1]}` })), { value: "Other", label: "Other…" }]} onChange={(v) => set("hood", v)} style={{ maxWidth: 260 }} />
          <Select label="Work" value={f.work} options={WORKS.map((x, i) => ({ value: String(i), label: x.en }))} onChange={(v) => set("work", v)} style={{ maxWidth: 260 }} />
          <Select label="Their" value={f.place} options={PLACES.map((x, i) => ({ value: String(i), label: x.en }))} onChange={(v) => set("place", v)} style={{ maxWidth: 160 }} />
        </Row>
        {f.hood === "Other" ? <Row wrap><Field label="Neighborhood (English)" value={f.other} onChange={(v) => set("other", v)} /><Field label="الحي (بالعربي)" value={f.otherAr} onChange={(v) => set("otherAr", v)} /></Row> : null}
        <Row wrap><Field label="From (your name)" value={f.from} onChange={(v) => set("from", v)} style={{ maxWidth: 220 }} /><Field label="الاسم بالعربي" value={f.fromAr} onChange={(v) => set("fromAr", v)} style={{ maxWidth: 220 }} /></Row>
        <T size={12} muted>العربية</T>
        <View style={{ backgroundColor: c.sunk, borderRadius: 8, padding: 12 }}><T size={14}>{ar}</T></View>
        <Row wrap>
          <Btn kind="primary" icon={<Icon name="share" color={c.accentInk} />} title="Send Arabic on WhatsApp" disabled={!phoneOk} onPress={() => send(ar)} />
          <Btn kind="ghost" title="Copy Arabic" onPress={() => copy(ar, "Arabic")} />
        </Row>
        <T size={12} muted>English</T>
        <View style={{ backgroundColor: c.sunk, borderRadius: 8, padding: 12 }}><T size={14}>{en}</T></View>
        <Row wrap>
          <Btn icon={<Icon name="share" />} title="Send English on WhatsApp" disabled={!phoneOk} onPress={() => send(en)} />
          <Btn kind="ghost" title="Copy English" onPress={() => copy(en, "English")} />
        </Row>
        {!phoneOk && f.phone ? <T size={12} color={c.warn}>Check the WhatsApp number (e.g. 05x xxx xxxx).</T> : null}
        {note ? <T size={12} color={c.good}>{note}</T> : null}
      </Card>
      <Card>
        <H2>Keep the Google Maps profile active</H2>
        <T size={13} muted>Post one update a week: press "Copy for Google Business Profile" on any published post, district page or case study (Blog, District pages, Case studies), paste it in Google Maps → your business → Add update, and add a real photo of that job.</T>
        <T size={13} muted>Photos: on a published district page or case study, "Photos for Google Maps" downloads its photos named for search (e.g. mechanical-stone-cladding-al-malqa-riyadh-01.jpg) with the district's location. The website uses the same names.</T>
      </Card>
    </>
  );
}
// ───────── Videos: TikTok, YouTube Shorts and Instagram Reels ─────────
// The seo function writes 2 new ideas a week while fewer than 4 wait (and 3 more on "Write 3 new ideas"): script, on-screen text,
// TikTok caption and YouTube title, description and tags. Four times a week (Sunday, Tuesday, Thursday and Saturday morning) Claude
// makes the pictures and clips of the next idea with Higgsfield and the "Video" workflow renders the MP4 (status "To review").
// The style test: every topic is made twice, once "realistic" (photo-real) and once "animated" (3D explainer), linked by pair_id;
// the weekly Growth agent saves each posted video's TikTok and YouTube numbers in video_ideas.stats, and the card below compares
// the two styles so the data decides which one to make more of. The owner watches each video here:
// Approve sends it to YouTube, public at the next slot (Sunday, Tuesday, Thursday or Saturday, 7 pm Riyadh); "New version" sends it back with his note.
// TikTok does not approve tools that post only to the owner's own account, so he posts there himself (download + caption below).
const TIKTOK_UPLOAD = "https://www.tiktok.com/tiktokstudio/upload";
const YT_STUDIO = "https://studio.youtube.com";
const VKIND: Record<string, string> = { "3d": "3D animation", site: "Filmed on site", tips: "Tips" };
const VSTYLE: Record<string, string> = { realistic: "Realistic", animated: "Animated" };
const SLOT_DAYS = [0, 2, 4, 6], DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const VSTATUS: Record<string, [string, "plain" | "good" | "warn" | "bad" | "acc"]> = {
  idea: ["Idea", "plain"], generating: ["Making pictures and clips", "plain"], rendering: ["Making the video", "plain"], review: ["To review", "warn"],
  approved: ["Approved", "acc"], scheduled: ["Scheduled on YouTube", "acc"], made: ["Video ready", "acc"], posted: ["Posted", "good"], skipped: ["Skipped", "plain"], failed: ["Video failed", "bad"] };
const OPEN = ["idea", "generating", "rendering", "review", "approved", "scheduled", "made", "failed"];
const RTL = { writingDirection: "rtl" as const, textAlign: "right" as const };
async function copyText(s: string): Promise<boolean> { try { await (navigator as any).clipboard.writeText(s); return true; } catch { return false; } }
/** Sunday, Tuesday, Thursday or Saturday, 7 pm Riyadh: the next one at least 30 minutes away (the server picks the real slot). */
function nextSlotText() {
  for (let d = 0; d < 8; d++) { const t = new Date(Date.now() + d * 864e5); t.setUTCHours(16, 0, 0, 0); if (SLOT_DAYS.includes(t.getUTCDay()) && t.getTime() > Date.now() + 30 * 60e3) return DAY_NAME[t.getUTCDay()] + " 7 pm"; }
  return "the next slot";
}
/** One video's numbers: TikTok and YouTube added up (saved by the weekly Growth agent in video_ideas.stats). */
function vNums(v: any) {
  const s = v.stats || {}, t = s.tiktok || {}, y = s.youtube || {};
  const n = (x: any) => Number(x) || 0;
  return { views: n(t.views) + n(y.views), likes: n(t.likes) + n(y.likes), shares: n(t.shares) + n(y.shares), comments: n(t.comments) + n(y.comments),
    watch: y.avg_view_pct != null ? n(y.avg_view_pct) : null, has: !!(s.tiktok || s.youtube) };
}
/** The style test: average numbers per video for "animated" and "realistic", from the posted videos that have numbers. */
function StyleTest({ rows }: { rows: any[] }) {
  const c = useColors();
  const by = (st: string) => {
    const vs = rows.filter((r) => r.style === st && r.status === "posted" && vNums(r).has).map(vNums), k = vs.length || 1;
    const sum = (f: (x: any) => number) => vs.reduce((a, x) => a + f(x), 0);
    const w = vs.filter((x) => x.watch != null);
    return { n: vs.length, views: Math.round(sum((x) => x.views) / k), likes: Math.round(sum((x) => x.likes) / k), shares: Math.round(sum((x) => x.shares) / k),
      watch: w.length ? Math.round(w.reduce((a, x) => a + (x.watch || 0), 0) / w.length) : null };
  };
  const a = by("animated"), r = by("realistic"), made = rows.filter((x) => x.style).length;
  const lead = a.n >= 3 && r.n >= 3 ? (a.views > r.views * 1.2 ? "Animated aage hai" : r.views > a.views * 1.2 ? "Realistic aage hai" : "Abhi barabar") : null;
  const Line = ({ name, x }: { name: string; x: any }) => (
    <Row style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.line }}><T bold style={{ width: 90 }}>{name}</T>
      <T size={13} style={{ flex: 1 }}>{x.n} videos · {x.views} views · {x.likes} likes · {x.shares} shares{x.watch != null ? ` · ${x.watch}% dekhi gayi (YouTube)` : ""}</T></Row>);
  return (
    <Card>
      <Row><Icon name="pct" color={c.accent} /><View style={{ flex: 1 }}><H2>Test: animated ya realistic?</H2></View>{lead ? <Pill kind="acc" text={lead} /> : null}</Row>
      <T size={13} muted>Har topic do dafa banta hai: ek realistic, ek animated. Har hafte Growth agent TikTok aur YouTube ke numbers yahan laata hai (har video ka average). Faisla tab, jab har style ki kam az kam 3 videos post ho chuki hon.</T>
      <Line name="Animated" x={a} /><Line name="Realistic" x={r} />
      {!a.n && !r.n ? <T size={12} muted>{made ? `${made} videos style ke saath bani hain; numbers post hone ke baad aayenge.` : "Test ki pehli videos is hafte se banengi."}</T> : null}
    </Card>
  );
}
/** The hashtag bank (table video_hashtags): every video's hashtags come from here; the weekly Growth agent keeps it up to date from the numbers. */
const HGRP: [string, string, string][] = [
  ["fixed", "Har video mein", "Shehar, kaam aur hamara naam"],
  ["search", "Google par search", "Saudi Arabia mein har mahine kitni searches (OpenSEO)"],
  ["topic", "Topic ke hisaab se", "Sirf us topic ki video mein"],
  ["market", "Social media", "Saudi facade videos jo zyada chalti hain, un par lage hue"],
  ["english", "English", "Bahar ke log aur English search"],
];
function HashtagBank() {
  const c = useColors();
  const [tags, setTags] = useState<any[]>([]), [all, setAll] = useState(false);
  useEffect(() => { supabase.from("video_hashtags").select("*").order("volume", { ascending: false, nullsFirst: false }).then(({ data }) => setTags(data || [])); }, []);
  if (!tags.length) return null;
  const live = tags.filter((t) => t.status !== "removed"), gone = tags.filter((t) => t.status === "removed"), test = live.find((t) => t.status === "test");
  const used = live.filter((t) => t.uses > 0).length;
  return (
    <Card>
      <Row><Icon name="spark" color={c.accent} /><View style={{ flex: 1 }}><H2>Hashtags (data se)</H2></View><Pill text={`${live.length} chalu`} />{test ? <Pill kind="warn" text={"Test: " + test.tag} /> : null}</Row>
      <T size={13} muted>Har video ke hashtags isi list se lagte hain (6–8). Har Saturday Growth agent dekhta hai kis hashtag wali videos ko kitne views mile, ek naya hashtag test karta hai, aur jo kaam na kare use hata deta hai.</T>
      {HGRP.map(([g, name, why]) => {
        const xs = live.filter((t) => t.grp === g).slice(0, all ? 99 : g === "search" ? 6 : 5);
        if (!xs.length) return null;
        return (
          <View key={g} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.line, gap: 4 }}>
            <Row><T bold>{name}</T><T size={12} muted style={{ flex: 1 }}>  {why}</T></Row>
            <Row wrap>{xs.map((t) => <Pill key={t.tag} kind={t.status === "test" ? "warn" : t.uses && t.avg_views != null ? "good" : "plain"}
              text={t.tag + (t.volume ? ` · ${t.volume}/mahina` : "") + (t.uses ? ` · ${t.uses} videos, ${t.avg_views ?? 0} views avg` : "")} />)}</Row>
          </View>
        );
      })}
      <Row wrap><Btn kind="ghost" title={all ? "Kam dikhao" : "Sab dikhao"} onPress={() => setAll(!all)} />
        <T size={12} muted style={{ flex: 1 }}>{used ? `${used} hashtags ke numbers aa chuke hain.` : "Numbers videos post hone ke baad aayenge."}{gone.length ? ` Hataye gaye: ${gone.map((t) => t.tag).join(" ")}` : ""}</T></Row>
    </Card>
  );
}
async function videoFn(action: string, body: any = {}) {
  const { data, error } = await supabase.functions.invoke("video", { body: { action, ...body } });
  if (error) { let m = error.message; try { const j = await (error as any).context?.json?.(); if (j?.error) m = j.error; } catch {} throw new Error(m); }
  if (data?.error && data?.ok !== false) throw new Error(data.error);
  return data;
}
function Videos() {
  const c = useColors();
  const [rows, setRows] = useState<any[]>([]), [open, setOpen] = useState<any>(null), [busy, setBusy] = useState(""), [msg, setMsg] = useState(""), [show, setShow] = useState("open");
  const [yt, setYt] = useState<any>(null);
  const load = async () => { const { data } = await supabase.from("video_ideas").select("*").order("created_at", { ascending: false }).limit(300); setRows(data || []); };
  const ytLoad = () => videoFn("yt_status").then(setYt).catch((e) => setMsg(e.message));
  useEffect(() => { load(); const i = setInterval(load, 60000); return () => clearInterval(i); }, []);
  // "Connect YouTube": Google sends the owner back here with ?code=…&state=y.…
  useEffect(() => {
    const u = Platform.OS === "web" ? new URLSearchParams(globalThis.location?.search || "") : null;
    const st = u?.get("state") || "";
    if (!st.startsWith("y.")) { ytLoad(); return; }
    try { globalThis.history?.replaceState(null, "", globalThis.location.pathname); } catch { /* keep the address */ }
    setBusy("yt");
    videoFn("yt_finish", { code: u?.get("code") || "", state: st, error: u?.get("error") || "", error_description: u?.get("error_description") || "" })
      .then((r) => setMsg(`YouTube connected: ${r.channel}. Approved videos now go to this channel by themselves.`))
      .catch((e) => setMsg(e.message)).finally(() => { ytLoad(); setBusy(""); });
  }, []);
  const ytStart = async () => {
    setBusy("yt"); setMsg("");
    try { const { url } = await videoFn("yt_start"); if (Platform.OS === "web") globalThis.location.assign(url); else Linking.openURL(url); }
    catch (e: any) { setMsg(e.message); setBusy(""); }
  };
  const ytStop = async () => { setBusy("yt"); try { await videoFn("yt_disconnect"); await ytLoad(); } catch (e: any) { setMsg(e.message); } finally { setBusy(""); } };
  const more = async () => {
    setBusy("ideas"); setMsg("Writing 3 ideas… (about a minute)");
    const { data, error } = await supabase.functions.invoke("seo", { body: { action: "video_ideas", n: 3 } });
    setBusy("");
    if (error || data?.error) setMsg("The ideas could not be written: " + (data?.error || error?.message || "")); else { setMsg(`${data.added} new ideas below.`); setShow("open"); load(); }
  };
  const n = (...st: string[]) => rows.filter((r) => st.includes(r.status)).length;
  const list = rows.filter((r) => (show === "open" ? OPEN.includes(r.status) : show === "posted" ? r.status === "posted" : true))
    .sort((a, b) => (a.status === "review" ? 0 : 1) - (b.status === "review" ? 0 : 1));
  return (
    <>
      <Card>
        <H2>Videos for TikTok, YouTube Shorts and Reels</H2>
        <T size={13} muted>Every Sunday, Tuesday, Thursday and Saturday morning Claude makes the next video by itself with Higgsfield (informative, in Saudi Arabic): each topic once realistic and once animated, to see which works better. It waits here under "To review" until you watch it. Approve: it goes to YouTube by itself, public at the next slot (Sunday, Tuesday, Thursday or Saturday, 7 pm). TikTok: you post it yourself with the download and caption here, or ask Claude in chat to post it.</T>
        <StatStrip items={[{ label: "To review", value: String(n("review")) }, { label: "Being made", value: String(n("generating", "rendering")) }, { label: "Scheduled", value: String(n("approved", "scheduled")) }, { label: "Posted", value: String(n("posted")) }]} />
        <Row wrap>
          {yt?.linked ? <Pill kind="good" text={"YouTube: " + (yt.channel || "connected")} /> : <Pill kind="warn" text="YouTube not connected" />}
          {yt?.linked ? <Btn kind="ghost" title="Disconnect YouTube" busy={busy === "yt"} disabled={!!busy} onPress={ytStop} />
            : <Btn kind="primary" title="Connect YouTube" busy={busy === "yt"} disabled={!!busy} onPress={ytStart} />}
          <Btn kind="ghost" icon={<Icon name="spark" color={c.accent} />} title="Write 3 new ideas" busy={busy === "ideas"} disabled={!!busy} onPress={more} />
          <Btn kind="ghost" title="Open TikTok Studio" onPress={() => Linking.openURL(TIKTOK_UPLOAD)} />
          <Btn kind="ghost" title="Open YouTube Studio" onPress={() => Linking.openURL(YT_STUDIO)} />
        </Row>
        {yt?.error ? <T size={12} color={c.bad}>{yt.error}</T> : null}
        {!yt?.linked ? <T size={12} muted>Connect YouTube once: Google asks you to choose the AL-Swati channel and allow uploads. Until then approved videos wait here.</T> : null}
        {msg ? <T size={13} muted>{msg}</T> : null}
      </Card>
      <StyleTest rows={rows} />
      <HashtagBank />
      <Row wrap>{([["open", `To make and post (${rows.filter((r) => OPEN.includes(r.status)).length})`], ["posted", `Posted (${n("posted")})`], ["all", "All"]] as const).map(([k, l]) => <Btn key={k} kind={show === k ? "primary" : "ghost"} title={l} onPress={() => setShow(k)} />)}</Row>
      {!list.length && <Empty text={show === "posted" ? "No videos posted yet." : "No ideas waiting. Press \"Write 3 new ideas\"."} />}
      {list.map((v) => (
        <Card key={v.id}>
          <Row wrap><Pill kind={VSTATUS[v.status]?.[1] || "plain"} text={VSTATUS[v.status]?.[0] || v.status} /><Pill text={VKIND[v.kind] || v.kind} />{v.style ? <Pill kind="acc" text={VSTYLE[v.style] || v.style} /> : null}{v.keyword ? <Pill kind="acc" text={v.keyword} /> : null}<View style={{ flex: 1 }} /><T size={12} muted>{day(v.created_at)}</T></Row>
          {v.title_ar ? <T size={17} bold style={RTL}>{v.title_ar}</T> : null}
          {v.title_en ? <T size={14} muted>{v.title_en}</T> : null}
          {v.status === "scheduled" && v.publish_at ? <T size={13} color={c.good}>Public on YouTube {riyadhTime(v.publish_at)} (Riyadh). Post it on TikTok yourself at the same time.</T> : null}
          {v.status === "posted" && !v.tiktok_url && v.video_path ? <T size={13} color={c.warn}>TikTok: not posted yet. Download it and post it with the caption.</T> : null}
          {v.status === "posted" && vNums(v).has ? <T size={13} muted>{vNums(v).views} views · {vNums(v).likes} likes · {vNums(v).shares} shares{v.stats_at ? ` (${day(v.stats_at)})` : ""}</T> : null}
          {v.youtube_error ? <T size={12} color={c.bad}>YouTube: {v.youtube_error}</T> : null}
          {v.render_error && v.status !== "review" ? <T size={12} color={c.bad}>Video: {v.render_error}</T> : null}
          {v.review_note && v.status === "idea" ? <T size={12} muted>New version asked: {v.review_note}</T> : null}
          <Row wrap><Btn kind={v.status === "review" ? "primary" : "default"} title={v.status === "review" ? "Watch and approve" : v.status === "posted" ? "Open" : "Open script and captions"} onPress={() => setOpen(v)} />
            {v.tiktok_url ? <Btn kind="ghost" title="TikTok post" onPress={() => Linking.openURL(v.tiktok_url)} /> : null}
            {v.youtube_url ? <Btn kind="ghost" title="YouTube post" onPress={() => Linking.openURL(v.youtube_url)} /> : null}</Row>
        </Card>
      ))}
      {open && <VideoSheet v={open} ytLinked={!!yt?.linked} onClose={() => { setOpen(null); load(); }} />}
    </>
  );
}
function VideoSheet({ v: first, ytLinked, onClose }: { v: any; ytLinked: boolean; onClose: () => void }) {
  const c = useColors();
  const [v, setV] = useState<any>(first), [note, setNote] = useState(""), [saving, setSaving] = useState(""), [src, setSrc] = useState(""), [redo, setRedo] = useState("");
  const set = (k: string, val: any) => setV({ ...v, [k]: val });
  const copy = async (s: string, what: string) => setNote((await copyText(s || "")) ? `${what} copied.` : "Copy did not work: select the text and copy it.");
  useEffect(() => { if (v.video_path) videoFn("link", { id: v.id }).then((r) => setSrc(r.url)).catch((e) => setNote(e.message)); }, [v.video_path]);
  const save = async (extra: any = {}, done?: string) => {
    setSaving("save");
    const row = { tiktok_caption: v.tiktok_caption, youtube_title: v.youtube_title, youtube_description: v.youtube_description, youtube_tags: v.youtube_tags,
      tiktok_url: v.tiktok_url || null, youtube_url: v.youtube_url || null, updated_at: new Date().toISOString(), ...extra };
    const { error } = await supabase.from("video_ideas").update(row).eq("id", v.id);
    setSaving("");
    if (error) setNote("Not saved: " + error.message); else { setV({ ...v, ...row }); setNote(done || "Saved."); }
  };
  const reread = async () => { const { data } = await supabase.from("video_ideas").select("*").eq("id", v.id).single(); if (data) setV(data); };
  const approve = async (when: "slot" | "now") => {
    setSaving(when); setNote("");
    try {
      await save();   // the title, description and tags as they stand now
      const r = await videoFn("approve", { id: v.id, when });
      setNote(r.ok ? (when === "now" ? "On YouTube now: " + r.youtube_url : `On YouTube, public ${riyadhTime(r.publish_at)} (Riyadh). Post it on TikTok yourself at the same time.`) : "Approved. YouTube: " + r.error);
    } catch (e: any) { setNote(e.message); } finally { setSaving(""); reread(); }
  };
  const act = async (action: string, body: any, done: string) => { setSaving(action); try { await videoFn(action, { id: v.id, ...body }); setNote(done); await reread(); } catch (e: any) { setNote(e.message); } finally { setSaving(""); } };
  const download = async () => { try { const r = await videoFn("link", { id: v.id, download: true }); Linking.openURL(r.url); } catch (e: any) { setNote(e.message); } };
  const scenes: any[] = Array.isArray(v.scenes) ? v.scenes : [];
  const CopyRow = ({ text, what }: { text: string; what: string }) => <Row wrap><Btn kind="ghost" title={"Copy " + what} onPress={() => copy(text, what)} /></Row>;
  const player = Platform.OS === "web" && src ? React.createElement("video", { src, controls: true, playsInline: true, preload: "metadata", style: { width: "100%", maxWidth: 360, aspectRatio: "9 / 16", background: "#000", borderRadius: 12 } }) : null;
  return (
    <Sheet open onClose={onClose} title={v.title_en || v.title_ar || "Video"}>
      <Row wrap><Pill kind={VSTATUS[v.status]?.[1] || "plain"} text={VSTATUS[v.status]?.[0] || v.status} /><Pill text={VKIND[v.kind] || v.kind} />{v.style ? <Pill kind="acc" text={VSTYLE[v.style] || v.style} /> : null}{v.keyword ? <Pill kind="acc" text={"Search: " + v.keyword} /> : null}{v.credits ? <Pill text={`${v.credits} Higgsfield credits`} /> : null}</Row>
      {v.title_ar ? <T size={18} bold style={RTL}>{v.title_ar}</T> : null}
      {v.video_path ? <>
        <H2>The video</H2>
        {player || <Btn title="Watch the video" onPress={() => src && Linking.openURL(src)} />}
        {v.status === "review" ? <>
          <T size={13} muted>Check the stone, the angles and the Arabic before you approve. Approve sends it to YouTube{ytLinked ? `, public ${nextSlotText()} (Riyadh)` : " once YouTube is connected"}.</T>
          <Row wrap>
            <Btn kind="primary" icon={<Icon name="check" color={c.accentInk} />} title={"Approve: YouTube " + nextSlotText()} busy={saving === "slot"} disabled={!!saving} onPress={() => approve("slot")} />
            <Btn kind="ghost" title="Approve and post now" busy={saving === "now"} disabled={!!saving} onPress={() => approve("now")} />
          </Row>
          <Field label="Something wrong? Write what to change (Claude makes a new version on its next run)" value={redo} multiline onChange={setRedo} placeholder="e.g. the screw goes through the stone; the lower stone moves" />
          <Row wrap><Btn kind="danger" title="New version" busy={saving === "redo"} disabled={!!saving || !redo.trim()} onPress={() => act("redo", { note: redo }, "Sent back. Claude makes a new version on its next run (Saturday or Tuesday).")} />
            <Btn kind="ghost" title="Skip: don't post it" disabled={!!saving} onPress={() => save({ status: "skipped" }, "Skipped. It will not be posted.")} /></Row>
        </> : null}
        {v.status === "approved" && v.youtube_error ? <Row wrap><Btn kind="primary" title="Try YouTube again" busy={saving === "slot"} disabled={!!saving} onPress={() => approve("slot")} /></Row> : null}
        {v.status === "scheduled" && v.publish_at ? <T color={c.good}>On YouTube, public {riyadhTime(v.publish_at)} (Riyadh).</T> : null}
      </> : null}
      {v.status === "failed" ? <><T color={c.bad}>The video could not be made: {v.render_error}</T><Row wrap><Btn title="Try again" busy={saving === "retry"} disabled={!!saving} onPress={() => act("retry", {}, "It will be made again within 30 minutes.")} /></Row></> : null}
      {v.hook_ar || v.hook_en ? <><T size={13} muted>Hook (first 2 seconds)</T>{v.hook_ar ? <T style={RTL}>{v.hook_ar}</T> : null}{v.hook_en ? <T muted>{v.hook_en}</T> : null}</> : null}
      {scenes.length ? <><H2>Scenes</H2><Table cols={["Seconds", "What we see", "Text (Arabic)", "Text (English)"]} rows={scenes.map((x) => [x.sec || "", x.visual || "", x.ar || "", x.en || ""])} /></> : null}
      {v.shots ? <><H2>What to film on site</H2><T>{v.shots}</T></> : null}
      {v.voice_ar || v.voice_en ? <><H2>Voice-over</H2>
        {v.voice_ar ? <><T style={RTL}>{v.voice_ar}</T><CopyRow text={v.voice_ar} what="Arabic voice-over" /></> : null}
        {v.voice_en ? <><T>{v.voice_en}</T><CopyRow text={v.voice_en} what="English voice-over" /></> : null}</> : null}
      <H2>TikTok (you post it)</H2>
      <Field label="Caption (with hashtags)" value={v.tiktok_caption || ""} multiline onChange={(x) => set("tiktok_caption", x)} />
      <Row wrap>{v.video_path ? <Btn kind="primary" title="Download the video" onPress={download} /> : null}<Btn kind={v.video_path ? "ghost" : "primary"} title="Copy TikTok caption" onPress={() => copy(v.tiktok_caption, "TikTok caption")} /><Btn kind="ghost" title="Open TikTok Studio" onPress={() => Linking.openURL(TIKTOK_UPLOAD)} /></Row>
      <T size={12} muted>Location: Riyadh. Turn on "AI-generated content" under Show more. A link in a TikTok caption cannot be clicked, so the website stays in your profile bio.</T>
      <H2>YouTube Shorts</H2>
      <Field label="Title" value={v.youtube_title || ""} onChange={(x) => set("youtube_title", x)} />
      <Row wrap><Btn kind="ghost" title="Copy title" onPress={() => copy(v.youtube_title, "Title")} /></Row>
      <Field label="Description" value={v.youtube_description || ""} multiline onChange={(x) => set("youtube_description", x)} />
      <Row wrap><Btn kind="ghost" title="Copy description" onPress={() => copy(v.youtube_description, "Description")} /></Row>
      <Field label="Tags" value={v.youtube_tags || ""} onChange={(x) => set("youtube_tags", x)} />
      <Row wrap><Btn kind="ghost" title="Copy tags" onPress={() => copy(v.youtube_tags, "Tags")} /><Btn kind="ghost" title="Open YouTube Studio" onPress={() => Linking.openURL(YT_STUDIO)} /></Row>
      <T size={12} muted>Made for kids: No. Altered or synthetic content: Yes (the app sets both when it uploads).</T>
      <H2>After posting</H2>
      <Row wrap><Field label="TikTok link" value={v.tiktok_url || ""} onChange={(x) => set("tiktok_url", x)} placeholder="https://www.tiktok.com/@…" /><Field label="YouTube link" value={v.youtube_url || ""} onChange={(x) => set("youtube_url", x)} placeholder="https://youtube.com/shorts/…" /></Row>
      <Row wrap>
        <Btn title="Save" busy={saving === "save"} disabled={!!saving} onPress={() => save()} />
        {v.status === "idea" ? <Btn kind="ghost" title="Video is ready" onPress={() => save({ status: "made" }, "Marked: video ready.")} /> : null}
        {!["posted", "review", "approved", "scheduled", "generating", "rendering"].includes(v.status) ? <Btn kind="primary" title="Mark as posted" onPress={() => save({ status: "posted", posted_at: new Date().toISOString() }, "Marked as posted.")} /> : null}
        {v.status === "idea" ? <Btn kind="ghost" title="Skip this idea" onPress={() => save({ status: "skipped" }, "Skipped.")} /> : null}
      </Row>
      {note ? <T size={12} color={c.good}>{note}</T> : null}
    </Sheet>
  );
}

const CITIES = ["Riyadh", "Dammam", "Al-Khobar", "Al-Ahsa", "Jeddah", "Other"];
const ROLES = ["Project Manager", "Construction Manager", "Consultant", "Developer / Owner", "Main contractor", "Architect", "Other"];
const SOURCES = ["Met on site", "Business card", "Referral", "Worked together before", "They contacted us", "Event / exhibition", "Their website contact page", "Other"];
const DAILY_CAP = 15; // personal emails a day: enough for real conversations, low enough to stay personal
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "post-" + Date.now().toString(36);

/** The "blog-media" server function: "image" makes the post's picture, "arabic" writes its twin in the other language
 *  (English → Arabic, Arabic → English), "retwin" writes the twin again from new text, "boost" makes a Top-3 upgrade draft,
 *  "area" writes a Riyadh district page in English and Arabic (two linked drafts), "case" a project case study (two drafts). */
async function media(action: "image" | "arabic" | "retwin" | "boost" | "area" | "case", id?: string, extra: any = {}): Promise<any> {
  const { data, error } = await supabase.functions.invoke("blog-media", { body: { action, id, ...extra } });
  if (error) {
    let msg = error.message;
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data;
}

function useProfile() {
  const { d } = useData();
  return { name: "Al-Swati Contracting", services: "Supply and installation of natural stone, marble, granite and porcelain cladding for facades and walls, with mechanical (dry-fix) fixing systems", cities: "Riyadh, Dammam, Al-Ahsa", phone: "", email: "", website: "", about: "",
    ...((d.preferences || []).find((p: any) => p.key === "company_profile")?.value || {}) };
}

function CompanyProfile() {
  const { reload } = useData(); const c = useColors(); const cur = useProfile();
  const [f, setF] = useState<any>(null), [msg, setMsg] = useState("");
  if (!f) return (
    <Card>
      <Row><H2>Company profile</H2><View style={{ flex: 1 }} /><Btn kind="ghost" title="Edit" onPress={() => setF(cur)} /></Row>
      <T size={13} muted>The AI writes only these facts about the company — never invented projects, clients or numbers.</T>
      <T size={14}>{cur.name} · {cur.services} · {cur.cities}{cur.phone ? ` · ${cur.phone}` : ""}{cur.email ? ` · ${cur.email}` : ""}{cur.google_reviews ? " · Google reviews linked" : ""}</T>
      {!cur.phone && !cur.email ? <T color={c.warn}>Add a phone or email so readers can contact you.</T> : null}
      {!String(cur.price_table || "").trim() ? <T color={c.warn}>Add your price ranges (Edit): "Boost to Top 3" puts them in its price table. Until then the table has blanks to fill in.</T> : null}
    </Card>
  );
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  return (
    <Card>
      <H2>Company profile</H2>
      <Field label="Company name" value={f.name} onChange={(v) => set("name", v)} />
      <Field label="What you do" value={f.services} multiline onChange={(v) => set("services", v)} />
      <Field label="Cities you work in" value={f.cities} onChange={(v) => set("cities", v)} />
      <Row wrap><Field label="Phone / WhatsApp" value={f.phone} onChange={(v) => set("phone", v)} /><Field label="Email" value={f.email} onChange={(v) => set("email", v)} /><Field label="Website" value={f.website} onChange={(v) => set("website", v)} /></Row>
      <Field label="Google reviews link (Google Maps → your business → Share)" value={f.google_reviews} onChange={(v) => set("google_reviews", v.trim())} placeholder="https://maps.google.com/?cid=…" />
      <Field label="True facts the AI may use (experience, types of buildings done, approvals) — only what you can prove" value={f.about} multiline onChange={(v) => set("about", v)} />
      <Field label="Your price ranges for the price table (SAR per m², supply + installation with mechanical fixing)" value={f.price_table} multiline onChange={(v) => set("price_table", v)} placeholder={"Natural Riyadh stone: 180–260\nMarble: 350–600\nGranite: 300–450\nPorcelain: 220–320"} />
      {msg ? <T color={c.bad}>{msg}</T> : null}
      <Row><Btn kind="primary" title="Save" onPress={async () => { const { error } = await supabase.from("preferences").upsert({ key: "company_profile", value: f, updated_at: new Date().toISOString() }); if (error) setMsg(error.message); else { await reload(["preferences"]); setF(null); } }} /><Btn kind="ghost" title="Cancel" onPress={() => setF(null)} /></Row>
    </Card>
  );
}

/** SEO autopilot (server function "seo"): Google Search Console numbers, website leads, the weekly report, blog drafts and
 *  Google review messages. It runs every morning by itself; "Run now" is only for checking. Nothing goes out without the owner. */
function SeoAutopilot({ onDraft }: { onDraft?: (p: any) => void }) {
  const { d, reload } = useData(); const c = useColors();
  const s: any = (d.preferences || []).find((p: any) => p.key === "seo_state")?.value || null;
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState("");
  const run = async (force?: string) => {
    setBusy(force || "run"); setMsg("");
    try {
      const { data, error } = await supabase.functions.invoke("seo", { body: { action: "run", force } });
      if (error) { let m = error.message; try { const j = await (error as any).context?.json?.(); if (j?.error) m = j.error; } catch {} throw new Error(m); }
      await reload(["preferences", "blog_posts"]); setMsg((data?.done || []).join(" · ") || "Done.");
    } catch (e: any) { setMsg(e.message); } finally { setBusy(""); }
  };
  // Search Console: the owner's own "Sign in with Google" (read-only). Google sends him back here with ?code=…&state=g.…
  const [g, setG] = useState<any>(null);
  const seo = async (action: string, body: any = {}) => {
    const { data, error } = await supabase.functions.invoke("seo", { body: { action, ...body } });
    if (error) { let m = error.message; try { const j = await (error as any).context?.json?.(); if (j?.error) m = j.error; } catch {} throw new Error(m); }
    if (data?.error) throw new Error(data.error);
    return data;
  };
  const gLoad = () => seo("google_status").then(setG).catch((e) => setMsg(e.message));
  useEffect(() => {
    const u = Platform.OS === "web" ? new URLSearchParams(globalThis.location?.search || "") : null;
    const st = u?.get("state") || "";
    if (!st.startsWith("g.")) { gLoad(); return; }
    try { globalThis.history?.replaceState(null, "", globalThis.location.pathname); } catch { /* keep the address */ }
    setBusy("google");
    seo("google_finish", { code: u?.get("code") || "", state: st, error: u?.get("error") || "", error_description: u?.get("error_description") || "" })
      .then(async (r) => { setMsg(`Google linked (${r.account}). Bringing in Google's numbers…`); await gLoad(); setBusy(""); await run(); })
      .catch((e) => { setMsg(e.message); gLoad(); setBusy(""); });
  }, []);
  const gStart = async () => {
    setBusy("google"); setMsg("");
    try { const { url } = await seo("google_start"); if (Platform.OS === "web") globalThis.location.assign(url); else Linking.openURL(url); }
    catch (e: any) { setMsg(e.message); setBusy(""); }
  };
  const gStop = async () => { setBusy("google"); try { await seo("google_disconnect"); await gLoad(); await reload(["preferences"]); } catch (e: any) { setMsg(e.message); } finally { setBusy(""); } };
  const t = s?.summary?.totals || {};
  // Website leads and WhatsApp / call taps straight from the website's own counter (web_events), not the morning snapshot.
  const [ev, setEv] = useState<any[] | null>(null);
  const loadEv = async () => {
    const { data } = await supabase.from("web_events").select("at, kind, page, ref").gte("at", new Date(Date.now() - 7 * 864e5).toISOString()).order("at", { ascending: false }).limit(2000);
    if (data) setEv(data);
  };
  useEffect(() => { loadEv(); const i = setInterval(loadEv, 60000); return () => clearInterval(i); }, []);
  const n = (k: string) => (ev || []).filter((e: any) => e.kind === k).length;
  const web = ev ? { lead: n("lead"), whatsapp: n("whatsapp"), call: n("call"), email: n("email"), estimate: n("estimate") } : s?.summary?.web?.week || {};
  const last = ev?.[0], kindName: Record<string, string> = { lead: "Quote form", whatsapp: "WhatsApp", call: "Call", email: "Email", estimate: "Cost calculator used" };
  const from = (r: string) => { try { return r ? new URL(r).hostname.replace(/^www\./, "") : "direct"; } catch { return "direct"; } };
  const ch = (a: number, b: number) => (b ? ` (${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%)` : "");
  const wa = (text: string) => Linking.openURL("https://wa.me/?text=" + encodeURIComponent(text));
  const boost = async (x: any) => {
    setBusy("boost:" + x.q); setMsg("Writing the upgraded page… (about a minute)");
    try {
      const r = await media("boost", undefined, { query: x.q, page: x.page, position: x.pos });
      await reload(["blog_posts"]);
      setMsg(`Draft ready for "${x.q}": ${r.note}${r.prices_missing ? " Fill in your prices in the price table before you publish." : ""}`);
      if (r.post) onDraft?.(r.post);
    } catch (e: any) { setMsg(e.message); } finally { setBusy(""); }
  };
  return (
    <Card>
      <Row wrap><H2>SEO autopilot</H2><View style={{ flex: 1 }} />
        {s?.google?.linked ? <Pill kind="good" text="Google linked" /> : <Pill kind="warn" text="Google Search Console not linked yet" />}</Row>
      {g && !g.linked ? <Row wrap><T size={14}>Link Google Search Console once, with the Google account that has al-swaticontracting.com. The ERP reads Google's numbers and resubmits your sitemap after each Publish.</T>
        <Btn kind="primary" title="Sign in with Google" busy={busy === "google"} disabled={!!busy} onPress={gStart} /></Row> : null}
      {g?.linked && g.write === false ? <Row wrap><T size={13} color={c.warn}>Google is linked for reading only. Sign in once more so the ERP can also resubmit your sitemap to Google after each Publish and from "Re-ping Google".</T>
        <Btn kind="primary" title="Allow sitemap resubmit" busy={busy === "google"} disabled={!!busy} onPress={gStart} /></Row> : null}
      {g?.linked && g.account ? <Row wrap><T size={13} muted>Google: {g.account}{g.error ? ` · last problem: ${g.error}` : ""}</T><View style={{ flex: 1 }} /><Btn kind="ghost" title="Disconnect Google" disabled={!!busy} onPress={gStop} /></Row> : null}
      <T size={13} muted>Every morning it reads Google's numbers for al-swaticontracting.com, finds searches close to page 1, writes 2 blog drafts a week from them, counts website leads and WhatsApp clicks, and tells the main agent. You only read and press Publish.{s?.last_tick ? ` Last run ${stamp(s.last_tick)}.` : ""}</T>
      {(s?.summary || ev) && <StatStrip items={[
        { label: "Google clicks · 28 days", value: `${t.clicks ?? 0}${ch(t.clicks || 0, t.clicks_before || 0)}` },
        { label: "Seen in Google · 28 days", value: `${t.impressions ?? 0}${ch(t.impressions || 0, t.impressions_before || 0)}` },
        { label: "Average position", value: t.position ? `${t.position}${t.position_before ? ` (was ${t.position_before})` : ""}` : "-" },
        { label: "Website leads · 7 days", value: String(web.lead || 0) },
        { label: "WhatsApp / call clicks · 7 days", value: `${web.whatsapp || 0} / ${web.call || 0}` },
        { label: "Cost calculator used · 7 days", value: String(web.estimate || 0) },
      ]} />}
      <T size={12} muted>{last ? `Latest on the website: ${kindName[last.kind] || last.kind} on ${last.page || "/"} (from ${from(last.ref)}), ${stamp(last.at)}. ` : ev ? "No quote forms, WhatsApp or call taps on the website in the last 7 days. " : ""}Counted live from al-swaticontracting.com (quote forms and estimates sent, cost calculator use, WhatsApp, phone and email taps; no names kept). Estimates sent from the calculator arrive in Queries as "Website estimate".</T>
      {s?.report?.text ? <Card><T bold>This week's report · {day(s.report.at)}</T>{String(s.report.text).split("\n").map((l: string, i: number) => <T key={i} size={14}>{l}</T>)}</Card> : null}
      {(s?.summary?.striking || []).length > 0 && <>
        <T bold>Close to page 1 (the next posts aim at these)</T>
        <Table cols={["Search", "Position", "Seen", "Clicks", "Page", ""]} numeric={[1, 2, 3]} rows={s.summary.striking.slice(0, 8).map((x: any) => [x.q, String(x.pos), String(x.impr), String(x.clicks), x.page,
          <Btn key="b" kind="ghost" icon={<Icon name="spark" />} title="Boost to Top 3" busy={busy === "boost:" + x.q} disabled={!!busy || !x.page} onPress={() => boost(x)} />])} />
        <T size={12} muted>Boost to Top 3: the AI rewrites and expands that page for the search, with your company facts, a price and material table, 5 local questions and links to your service and quote pages. It becomes a draft for you to read — the website changes only when you press Publish. Takes about a minute.</T>
      </>}
      {(s?.queue || []).length > 0 && <T size={13} muted>Next drafts: {s.queue.map((q: any) => `${q.title} (${q.lang === "ar" ? "AR" : "EN"})`).join(" · ")}</T>}
      {(s?.review_msgs || []).length > 0 && <>
        <T bold>Ask finished clients for a Google review</T>
        {s.review_msgs.slice(0, 6).map((r: any, i: number) => (
          <Row key={i} wrap><View style={{ flex: 1, minWidth: 200 }}><T size={14}>{r.project}{r.client ? ` · ${r.client}` : ""}</T></View>
            <Btn kind="ghost" title="WhatsApp (EN)" onPress={() => wa(r.en)} /><Btn kind="ghost" title="واتساب (AR)" onPress={() => wa(r.ar)} /></Row>))}
      </>}
      {s?.error ? <T color={c.warn} size={13}>Last problem: {s.error}</T> : null}
      {msg ? <T size={13} muted>{msg}</T> : null}
      <Row wrap><Btn icon={<Icon name="spark" />} title="Run now" busy={busy === "run"} disabled={!!busy} onPress={() => run()} />
        <Btn kind="ghost" title="Redo this week's report" busy={busy === "weekly"} disabled={!!busy} onPress={() => run("weekly")} /></Row>
    </Card>
  );
}

function Blog() {
  const { d, reload } = useData(); const c = useColors(); const profile = useProfile();
  const posts = (d.blog_posts || []).filter((p: any) => !p.area);
  const ix = useIndexStatus(posts.filter((p: any) => p.status === "Published").map((p: any) => postUrl(p)));
  const [gbp, setGbp] = useState<any>(null);
  const [topics, setTopics] = useState<any[]>([]), [topic, setTopic] = useState(""), [kw, setKw] = useState(""), [lang, setLang] = useState("en");
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [ed, setEd] = useState<any>(null);
  const today = posts.some((p: any) => Date.now() - Date.parse(p.created_at) < 20 * 3600e3);
  const ideas = async () => {
    setBusy("ideas"); setErr("");
    try { const r = await ai("seo_topics", { profile, cities: String(profile.cities || "").split(/[,،]/).map((s) => s.trim()).filter(Boolean), done: posts.map((p: any) => p.title) }); setTopics(r.topics || []); }
    catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  };
  const write = async (t: string, k: string, l: string) => {
    setBusy("write:" + t); setErr("");
    try {
      const r = await ai("blog", { topic: t, keyword: k, lang: l, profile });
      let slug = slugify(r.slug || r.title); if (posts.some((p: any) => p.slug === slug)) slug += "-" + Date.now().toString(36).slice(-4);
      const { data, error } = await supabase.from("blog_posts").insert({ title: r.title, slug, lang: l, meta_description: r.meta_description, keywords: r.keywords || [k], body: r.body, status: "Draft" }).select().single();
      if (error) throw new Error(error.message);
      await reload(["blog_posts"]); setEd(data); setTopic(""); setKw("");
    } catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  };
  return (
    <>
      <SeoAutopilot onDraft={setEd} />
      <Card>
        <Row><H2>Write a post yourself</H2><View style={{ flex: 1 }} />{today ? <Pill kind="good" text="written today" /> : null}</Row>
        <T size={13} muted>The autopilot already drafts 2 posts a week from real Google searches. Use this for an extra topic of your own. The AI drafts it; you read it and press Publish.</T>
        <Row wrap>
          <Field label="Topic (or pick an idea below)" value={topic} onChange={setTopic} placeholder="e.g. Choosing stone for villa facades in Riyadh heat" />
          <Field label="Main search phrase" value={kw} onChange={setKw} placeholder="e.g. mechanical stone cladding Riyadh" style={{ maxWidth: 240 }} />
          <Select label="Language" value={lang} options={[{ value: "en", label: "English" }, { value: "ar", label: "العربية" }]} onChange={setLang} style={{ maxWidth: 150 }} />
        </Row>
        <Row wrap>
          <Btn kind="primary" icon={<Icon name="spark" color={c.accentInk} />} title="Write this post" busy={busy === "write:" + topic} disabled={!topic.trim() || !!busy} onPress={() => write(topic, kw || topic, lang)} />
          <Btn icon={<Icon name="spark" />} title="Give me topic ideas" busy={busy === "ideas"} disabled={!!busy} onPress={ideas} />
        </Row>
        {err ? <T color={c.bad}>{err}</T> : null}
        {topics.map((t: any, i: number) => (
          <Row key={i} wrap>
            <View style={{ flex: 1, minWidth: 220 }}><T bold size={14}>{t.title}</T><T size={12} muted>{t.lang === "ar" ? "العربية" : "English"} · {t.keyword} · {t.why}</T></View>
            <Btn kind="ghost" title="Write" busy={busy === "write:" + t.title} disabled={!!busy} onPress={() => write(t.title, t.keyword, t.lang === "ar" ? "ar" : "en")} />
          </Row>))}
      </Card>
      <H2>Posts</H2>
      <T size={13} muted>Published posts are public at {BLOG_URL} (Arabic: {SITE_URL}/ar/blog/) and appear there a few minutes after you press Publish — share that link and add it to your Google Business profile.</T>
      {!posts.length && <Empty text="No posts yet." />}
      {posts.map((p: any) => (
        <Card key={p.id} onPress={() => setEd(p)}>
          <Row>{p.image_url ? <Image source={{ uri: p.image_url }} accessibilityLabel={p.image_alt || p.title} style={{ width: 72, height: 41, borderRadius: 6 }} /> : null}
            <View style={{ flex: 1 }}><T bold>{p.title}</T><T size={12} muted>{p.lang === "ar" ? "العربية" : "English"} · {day(p.created_at)}{p.published_at ? ` · published ${day(p.published_at)}` : ""}{p.twin_id ? (p.lang === "ar" ? " · English version too" : " · Arabic version too") : ""}</T></View>
            {p.source === "autopilot" ? <Pill kind="acc" text="autopilot" /> : p.source === "boost" ? <Pill kind="acc" text="Top-3 upgrade" /> : null}<Pill kind={p.status === "Published" ? "good" : p.status === "Draft" ? "warn" : "plain"} text={p.status} /></Row>
          {p.status === "Published" ? <IndexLine url={postUrl(p)} rows={ix.rows} onRows={ix.put} onGbp={() => setGbp(p)} /> : null}
        </Card>))}
      {gbp && <GbpSheet p={gbp} onClose={() => setGbp(null)} />}
      {ed && <PostEditor p={ed} onClose={() => setEd(null)} />}
    </>
  );
}

function PostEditor({ p: first, onClose }: { p: any; onClose: () => void }) {
  const { d, reload } = useData(); const c = useColors();
  const p = (d.blog_posts || []).find((x: any) => x.id === first.id) || first; // picture and Arabic twin arrive while the sheet is open
  const twin = p.twin_id ? (d.blog_posts || []).find((x: any) => x.id === p.twin_id) : null;
  const [f, setF] = useState<any>({ ...first, keywords: (first.keywords || []).join(", ") }), [err, setErr] = useState(""), [step, setStep] = useState("");
  const [pnote, setPnote] = useState(""), [pmsg, setPmsg] = useState("");
  const words = String(f.body || "").split(/\s+/).filter(Boolean).length;
  const checks = [
    { ok: f.title.length > 10 && f.title.length <= 65, text: `Title ${f.title.length} characters (best 30–65)` },
    { ok: (f.meta_description || "").length >= 70 && (f.meta_description || "").length <= 160, text: `Search description ${(f.meta_description || "").length} characters (best 70–160)` },
    { ok: words >= 500, text: `${words} words (500+ ranks better)` },
    { ok: /^#{2}\s/m.test(f.body || ""), text: "Has headings" },
    ...(PRICE_BLANK.test(f.body || "") ? [{ ok: false, text: "Price table: replace every [SAR ___–___] with your real price range" }] : []),
  ];
  const save = async (patch: any = {}) => {
    const { error } = await supabase.from("blog_posts").update({ title: f.title, meta_description: f.meta_description, keywords: String(f.keywords).split(/[,،]/).map((s) => s.trim()).filter(Boolean), body: f.body, slug: f.slug, updated_at: new Date().toISOString(), ...patch }).eq("id", p.id);
    if (error) { setErr(error.message); return false; }
    if (p.status === "Published" || patch.status) siteRebuild(); // the public page changes too
    await reload(["blog_posts"]); return true;
  };
  const live = p.revision_of ? (d.blog_posts || []).find((x: any) => x.id === p.revision_of) : null; // the post this upgrade goes into
  const link = postUrl(live || { slug: f.slug, lang: p.lang, target_path: p.target_path });
  const area = p.area || null; // a Riyadh district page: it goes live, comes down and is deleted together with its other-language page
  const upgrade = !area && !!(p.target_path || p.revision_of);
  // Publish = this post goes public, gets its picture, and its twin in the other language (Arabic for English, English for Arabic) goes public with it.
  const other = p.lang === "ar" ? "English" : "Arabic";
  const publish = async () => {
    setErr("");
    if (PRICE_BLANK.test(f.body || "")) { setErr("Fill in your real prices in the price table first (replace every [SAR ___–___])."); return; }
    if (area) { // both district pages go live together; an older live version of the same addresses makes way
      const now = new Date().toISOString(), ids = [p.id, p.twin_id].filter(Boolean);
      const paths = [p.target_path, twin?.target_path].filter(Boolean);
      const { error: e1 } = await supabase.from("blog_posts").update({ status: "Archived", updated_at: now }).in("target_path", paths).eq("status", "Published").not("id", "in", `(${ids.join(",")})`);
      if (e1) { setErr(e1.message); return; }
      if (p.twin_id) {
        const { error: e2 } = await supabase.from("blog_posts").update({ status: "Published", published_at: twin?.published_at || now, updated_at: now }).eq("id", p.twin_id);
        if (e2) { setErr(e2.message); return; }
      }
      if (!(await save({ status: "Published", published_at: p.published_at || now }))) return; // this also asks the website to rebuild
      onClose(); return;
    }
    if (p.revision_of) { // a Top-3 upgrade of a published post: its text goes into that post, at the same address
      const now = new Date().toISOString();
      const { error } = await supabase.from("blog_posts").update({ title: f.title, meta_description: f.meta_description, keywords: String(f.keywords).split(/[,،]/).map((s) => s.trim()).filter(Boolean), body: f.body, updated_at: now, ...(p.image_url ? { image_url: p.image_url, image_alt: p.image_alt } : {}) }).eq("id", p.revision_of);
      if (error) { setErr(error.message); return; }
      await supabase.from("blog_posts").delete().eq("id", p.id);
      setStep("Updating the other-language version…");
      let problem = "";
      try { await media("retwin", p.revision_of); } catch (e: any) { problem = e.message; }
      setStep(""); siteRebuild(); await reload(["blog_posts"]);
      if (problem) { setErr("The upgrade is live. The other-language version was not updated: " + problem); return; }
      onClose(); return;
    }
    if (p.target_path) { // a Top-3 upgrade of a hand-made page: it takes that page's place (the old page comes back on Unpublish)
      await supabase.from("blog_posts").update({ status: "Archived", updated_at: new Date().toISOString() }).eq("target_path", p.target_path).eq("status", "Published").neq("id", p.id);
      if (!(await save({ status: "Published", published_at: new Date().toISOString() }))) return;
      siteRebuild(); onClose(); return;
    }
    if (!(await save({ status: "Published", published_at: p.published_at || new Date().toISOString() }))) return;
    const problems: string[] = [];
    if (!p.image_url) { // a stand-in photo for now; Claude puts the exact Higgsfield picture on it at its next morning run
      setStep("Making the picture…");
      try { await media("image", p.id); } catch (e: any) { problems.push("Picture: " + e.message); }
    }
    if (!["done", "ready"].includes(p.picture_status || "")) await supabase.from("blog_posts").update({ picture_status: "wanted" }).eq("id", p.id);
    setStep(`Writing the ${other} version…`);
    try {
      const r = await media("arabic", p.id);
      if (r?.post && r.post.status !== "Published") await supabase.from("blog_posts").update({ status: "Published", published_at: r.post.published_at || new Date().toISOString() }).eq("id", r.post.id);
    } catch (e: any) { problems.push(`${other} version: ` + e.message); }
    setStep(""); siteRebuild(); await reload(["blog_posts"]);
    if (problems.length) { setErr("The post is public. Not finished: " + problems.join(" · ") + " Press the button below to try again."); return; }
    onClose();
  };
  const redo = async (what: "image" | "arabic") => {
    setErr(""); setStep(what === "image" ? "Making the picture…" : `Writing the ${other} version…`);
    try {
      const r = await media(what, p.id);
      if (what === "arabic" && r?.post && p.status === "Published" && r.post.status !== "Published") await supabase.from("blog_posts").update({ status: "Published", published_at: new Date().toISOString() }).eq("id", r.post.id);
    } catch (e: any) { setErr(e.message); }
    setStep(""); if (p.status === "Published") siteRebuild(); await reload(["blog_posts"]);
  };
  // A new picture: Claude makes it with Higgsfield at its next morning run (about 10:40), from the topic and the owner's note.
  const wantPicture = async () => {
    setPmsg("");
    const { error } = await supabase.from("blog_posts").update({ picture_status: "wanted", picture_note: pnote.trim() || null, picture_error: null }).eq("id", p.id);
    if (error) { setPmsg(error.message); return; }
    setPnote(""); setPmsg("Asked. Claude makes the new picture with Higgsfield at its next run (every morning about 10:40); the other-language version gets it too.");
    await reload(["blog_posts"]);
  };
  const unpublish = async () => {
    if (!(await save({ status: "Draft" }))) return;
    if (p.twin_id) await supabase.from("blog_posts").update({ status: "Draft", updated_at: new Date().toISOString() }).eq("id", p.twin_id);
    siteRebuild(); await reload(["blog_posts"]); onClose();
  };
  return (
    <Sheet open onClose={onClose} title={p.status === "Published" ? "Published post" : "Draft post"}>
      {area ? <>
        <Row wrap>{(area.photos || []).map((x: any, i: number) => <Image key={i} source={{ uri: x.url }} accessibilityLabel={x.alt} resizeMode="cover" style={{ width: 150, height: 112, borderRadius: 6, backgroundColor: c.sunk }} />)}</Row>
        {(area.photos || []).length ? <T size={12} muted>Photo descriptions (for Google): {(area.photos || []).map((x: any) => x.alt).join(" · ")}</T> : <T size={13} color={c.warn}>No photos on this page. Pages with 2–3 real photos of your work rank better: make the pages again with photos.</T>}
        <T size={13} color={c.accent}>{area.type === "case" ? `Case study: ${area.building} in ${area.district}, ${area.stone}, ${area.m2} m², ${area.year}` : `District page for ${p.lang === "ar" ? area.district_ar || area.district : area.district} (${area.stone})`}: {SITE_URL}{p.target_path}{twin ? ` and ${SITE_URL}${twin.target_path}` : ""}. Publish puts both languages live and in sitemap.xml; Unpublish takes both down.</T>
        {twin ? <T size={13} muted>{other} page: {twin.title} — open it from {area.type === "case" ? "Case studies" : "District pages"} to read it.</T> : null}
      </> : <>
      {p.image_url
        ? <Image source={{ uri: p.image_url }} accessibilityLabel={p.image_alt || p.title} resizeMode="cover" style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: c.sunk }} />
        : <T size={13} muted>No picture yet. Claude makes one for exactly this topic with Higgsfield at its next morning run (about 10:40).</T>}
      {p.picture_status === "done" ? <T size={12} color={c.good}>Picture made with Higgsfield for this topic.</T>
        : p.picture_status === "wanted" ? <T size={12} color={c.accent}>A new picture is asked{p.picture_note ? ` ("${p.picture_note}")` : ""}: Claude makes it with Higgsfield at its next run (every morning about 10:40).</T>
        : p.picture_status === "ready" ? <T size={12} color={c.accent}>The new picture is made; it is being saved and put on the post (within about an hour).</T>
        : p.picture_status === "failed" ? <T size={12} color={c.bad}>The picture could not be saved: {p.picture_error}. Ask for a new one below.</T> : null}
      <Field label="New picture: what should it show? (optional)" value={pnote} onChange={setPnote} placeholder="e.g. white salt stains on a beige limestone facade, close up" />
      {pmsg ? <T size={12} color={c.good}>{pmsg}</T> : null}
      <Row wrap>
        <Btn kind="ghost" icon={<Icon name="spark" />} title={p.image_url ? "New picture (Higgsfield)" : "Make the picture (Higgsfield)"} disabled={!!step || p.picture_status === "wanted"} onPress={wantPicture} />
        {!twin && !upgrade && p.status === "Published" ? <Btn kind="ghost" icon={<Icon name="spark" />} title={`Make the ${other} version`} busy={step.startsWith("Writing")} disabled={!!step} onPress={() => redo("arabic")} /> : null}
      </Row></>}
      {upgrade ? <T size={13} color={c.accent}>Top-3 upgrade{p.boost_query ? ` for "${p.boost_query}"` : ""} of {link}. {p.revision_of ? "Publish copies this text into the live post (same address) and refreshes its other-language version." : "Publish replaces that page with this version (same address). Unpublish puts the old page back."}</T> : null}
      {upgrade || area ? null : <T size={13} muted>{twin ? `${other} version: ${twin.title} (${twin.status === "Published" ? "public" : "draft"}) — open it from the list to read it.` : p.lang === "ar" ? "The English version is written and published together with this post when you press Publish." : "The Arabic version (clear Arabic the way Saudi companies write) is written and published together with this post when you press Publish."}</T>}
      <Field label="Title" value={f.title} onChange={(v) => setF({ ...f, title: v })} />
      <Field label="Search description (shown under the title on Google)" value={f.meta_description} multiline onChange={(v) => setF({ ...f, meta_description: v })} />
      <Field label="Keywords" value={f.keywords} onChange={(v) => setF({ ...f, keywords: v })} />
      <Field label="Link name" value={f.slug} onChange={(v) => setF({ ...f, slug: slugify(v) })} />
      <Field label="Text (## = heading, - = bullet, **bold**)" value={f.body} multiline onChange={(v) => setF({ ...f, body: v })} />
      <View style={{ gap: 4 }}>{checks.map((x, i) => <T key={i} size={13} color={x.ok ? c.good : c.warn}>{x.ok ? "✓" : "!"} {x.text}</T>)}</View>
      <T size={12} muted>Read it once before publishing: every fact about your company must be true.</T>
      {err ? <T color={c.bad}>{err}</T> : null}
      {step ? <T color={c.accent}>{step} (up to a minute)</T> : null}
      <Row wrap>
        <Btn title="Save" disabled={!!step} onPress={async () => { if (await save()) onClose(); }} />
        {p.status !== "Published" || err ? <Btn kind="primary" title={p.status === "Published" ? "Finish publishing" : area ? "Publish both pages" : upgrade ? "Publish (replace the live page)" : "Publish"} busy={!!step} disabled={!!step} onPress={publish} />
          : <Btn title={twin ? (area ? "Unpublish both pages" : "Unpublish (both languages)") : "Unpublish"} disabled={!!step} onPress={unpublish} />}
        {p.status === "Published" && <Btn kind="ghost" icon={<Icon name="share" />} title="Open public page" onPress={() => Linking.openURL(link)} />}
        <Btn kind="ghost" title={area && twin ? "Delete both pages" : "Delete"} onPress={async () => {
          const ids = area && p.twin_id ? [p.id, p.twin_id] : [p.id];
          const { error } = await supabase.from("blog_posts").delete().in("id", ids);
          if (error) setErr(error.message); else { if (p.status === "Published") siteRebuild(); await reload(["blog_posts"]); onClose(); }
        }} />
      </Row>
    </Sheet>
  );
}

// ───────── Riyadh district pages ─────────
// One page per district in English and Arabic (/stone-cladding-<district>-riyadh/ and /ar/…), written by the AI from the
// district, the main stone, the owner's photos of his work there and his own notes. Both are drafts until he presses Publish.
const DISTRICTS = ["Al Malqa", "Al Narjis", "Hittin", "Al Yasmin", "Diriyah", "Al Olaya", "King Fahd Road", "Al Nakheel", "Qurtubah"];
const STONE_TYPES = ["Riyadh Limestone", "Granite", "Marble", "Porcelain"];

function DistrictPages() {
  const { d, reload } = useData(); const c = useColors();
  const all = (d.blog_posts || []).filter((p: any) => p.area && p.area.type !== "case" && p.status !== "Archived");
  const rows = all.filter((p: any) => p.lang === "en" || !all.some((x: any) => x.id === p.twin_id)); // one row per district pair
  const ix = useIndexStatus(all.filter((p: any) => p.status === "Published").map((p: any) => SITE_URL + p.target_path));
  const [gbp, setGbp] = useState<any>(null), [mapNote, setMapNote] = useState(""), [dl, setDl] = useState("");
  const [district, setDistrict] = useState(""), [other, setOther] = useState(""), [stone, setStone] = useState(STONE_TYPES[0]);
  const [photos, setPhotos] = useState<{ uri: string; url: string }[]>([]), [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [ed, setEd] = useState<any>(null);
  const name = (district === "Other" ? other : district).trim();
  const addPhoto = async () => {
    setErr("");
    try {
      const uri = await pickPhoto(false); // from the gallery, made smaller (about 1600 px wide)
      if (!uri) return;
      setBusy("photo");
      const path = `areas/uploads/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const buf = await (await fetch(uri)).arrayBuffer();
      const { error } = await supabase.storage.from("blog").upload(path, buf, { contentType: "image/jpeg", upsert: false });
      if (error) throw new Error(error.message);
      const url = supabase.storage.from("blog").getPublicUrl(path).data.publicUrl;
      setPhotos((x) => [...x, { uri, url }].slice(0, 3));
    } catch (e: any) { setErr("Photo: " + e.message); } finally { setBusy(""); }
  };
  const generate = async () => {
    setBusy("make"); setErr("");
    try {
      const r = await media("area", undefined, { district: name, stone, photos: photos.map((x) => x.url), notes });
      await reload(["blog_posts"]); setEd(r.post); setPhotos([]); setNotes("");
    } catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  };
  return (
    <>
      <Card>
        <H2>Riyadh district pages</H2>
        <T size={13} muted>For each district the AI writes an English page ({SITE_URL}/stone-cladding-[district]-riyadh/) and a Saudi Arabic page (/ar/…) with your company facts, a section on Riyadh's 45°C heat and dust, your prices, local questions, and Google data (LocalBusiness and Service with the district's location). Both are drafts until you press Publish; then they go on the website and in sitemap.xml.</T>
        <T size={13} muted>Give every district real photos of your work there and, if you can, a line about what you did. Google ranks pages that show real local work, and pushes down many near-identical area pages.</T>
        <T bold size={14}>District</T>
        <Row wrap>{[...DISTRICTS, "Other"].map((x) => <Btn key={x} kind={district === x ? "primary" : "ghost"} title={x} onPress={() => setDistrict(x)} />)}</Row>
        {district === "Other" ? <Field label="District name (as on Google Maps)" value={other} onChange={setOther} placeholder="e.g. Al Rabie" /> : null}
        <Select label="Main stone" value={stone} options={STONE_TYPES.map((x) => ({ value: x, label: x }))} onChange={setStone} style={{ maxWidth: 260 }} />
        <T bold size={14}>Photos of your work in this district ({photos.length} of 3)</T>
        <Row wrap>
          {photos.map((x, i) => (
            <View key={x.url} style={{ gap: 4 }}>
              <Image source={{ uri: x.uri }} accessibilityLabel={`Photo ${i + 1}`} style={{ width: 120, height: 90, borderRadius: 6, backgroundColor: c.sunk }} />
              <Btn kind="ghost" title="Remove" onPress={() => setPhotos(photos.filter((y) => y.url !== x.url))} />
            </View>))}
          {photos.length < 3 ? <Btn icon={<Icon name="camera" />} title="Add photo" busy={busy === "photo"} disabled={!!busy} onPress={addPhoto} /> : null}
        </Row>
        {photos.length < 2 ? <T size={13} color={c.warn}>Add 2–3 photos of your own work in this district.</T> : null}
        <Field label="What you did there (optional — only true facts)" value={notes} multiline onChange={setNotes} placeholder="e.g. Villa facade in Riyadh limestone with Up-Down brackets, finished 2024" />
        {err ? <T color={c.bad}>{err}</T> : null}
        <Row wrap>
          <Btn kind="primary" icon={<Icon name="spark" color={c.accentInk} />} title="Generate Area Pages" busy={busy === "make"} disabled={!name || !!busy} onPress={generate} />
        </Row>
        <T size={12} muted>Takes about a minute and a half. Making the pages again for the same district replaces its waiting drafts; a live page stays live until you publish the new one.</T>
      </Card>
      <H2>District pages</H2>
      {!rows.length && <Empty text="No district pages yet." />}
      {rows.map((p: any) => {
        const tw = all.find((x: any) => x.id === p.twin_id);
        return (
          <Card key={p.id}>
            <Row>{p.area.photos?.[0] ? <Image source={{ uri: p.area.photos[0].url }} accessibilityLabel={p.area.photos[0].alt} style={{ width: 72, height: 54, borderRadius: 6 }} /> : null}
              <View style={{ flex: 1 }}><T bold>{p.area.district} · {p.area.stone}</T><T size={12} muted>{SITE_URL}{p.target_path}{p.published_at ? ` · published ${day(p.published_at)}` : ` · made ${day(p.created_at)}`}</T></View>
              <Pill kind={p.status === "Published" ? "good" : "warn"} text={p.status} /></Row>
            <Row wrap>
              <Btn kind="ghost" title="English page" onPress={() => setEd(p)} />
              {tw ? <Btn kind="ghost" title="الصفحة العربية" onPress={() => setEd(tw)} /> : null}
              {p.status === "Published" ? <Btn kind="ghost" icon={<Icon name="share" />} title="Open" onPress={() => Linking.openURL(SITE_URL + p.target_path)} /> : null}
            </Row>
            {p.status === "Published" ? <IndexLine label={p.lang === "ar" ? "العربية" : "English"} url={SITE_URL + p.target_path} rows={ix.rows} onRows={ix.put} onGbp={() => setGbp(p)} /> : null}
            {tw?.status === "Published" ? <IndexLine label={tw.lang === "ar" ? "العربية" : "English"} url={SITE_URL + tw.target_path} rows={ix.rows} onRows={ix.put} /> : null}
            {p.status === "Published" && (p.area?.photos || []).length ? <Row wrap><Btn kind="ghost" icon={<Icon name="share" />} title="Photos for Google Maps" busy={dl === p.id} disabled={!!dl}
              onPress={async () => { setDl(p.id); setMapNote(await downloadMapPhotos(p).catch((e: any) => e.message)); setDl(""); }} /></Row> : null}
          </Card>);
      })}
      {mapNote ? <T size={13} muted>{mapNote}</T> : null}
      {gbp && <GbpSheet p={gbp} onClose={() => setGbp(null)} />}
      {ed && <PostEditor p={ed} onClose={() => setEd(null)} />}
    </>
  );
}

// ───────── SEO case studies from projects ─────────
// On a project (Projects screen): "Publish as SEO Case Study". The installed m² comes from Work done; the owner confirms the
// rest once (kept on the project): district, building, stone, fixing system, year, site photos, notes, client name allowed.
const BUILDINGS = [{ value: "villa", label: "Villa" }, { value: "compound", label: "Residential compound" }, { value: "commercial", label: "Commercial building" }, { value: "tower", label: "Tower" }, { value: "government", label: "Government building" }];
const FIXINGS = [{ value: "updown", label: "Up-Down brackets" }, { value: "pen", label: "PEN pins" }, { value: "cchannel", label: "C-Channel rails" }, { value: "undercut", label: "Undercut anchors" }];

export function CaseStudyButton({ project, installed, lastWork }: { project: any; installed: number; lastWork?: string }) {
  const { d, reload } = useData(); const c = useColors();
  const mine = (d.blog_posts || []).filter((p: any) => p.area?.type === "case" && p.area.project_id === project.id && p.status !== "Archived");
  const en = mine.find((p: any) => p.lang === "en") || mine[0];
  const [f, setF] = useState<any>(null), [busy, setBusy] = useState(""), [err, setErr] = useState(""), [ed, setEd] = useState<any>(null);
  const open = () => {
    const st = project.site || {};
    const known = DISTRICTS.includes(st.district);
    setErr(""); setF({ district: st.district ? (known ? st.district : "Other") : "", other: known ? "" : st.district || "", building: st.building || "villa", stone: st.stone || STONE_TYPES[0],
      m2: String(st.m2 || Math.round(installed) || ""), fixing: st.fixing || ["updown"], year: String(st.year || (lastWork || "").slice(0, 4) || new Date().getFullYear()),
      photos: (st.photos || []).map((u: string) => ({ uri: u, url: u })), notes: st.notes || "", show_client: !!st.show_client });
  };
  const addPhoto = async () => {
    setErr("");
    try {
      const uri = await pickPhoto(false); if (!uri) return;
      setBusy("photo");
      const path = `cases/uploads/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const buf = await (await fetch(uri)).arrayBuffer();
      const { error } = await supabase.storage.from("blog").upload(path, buf, { contentType: "image/jpeg", upsert: false });
      if (error) throw new Error(error.message);
      const url = supabase.storage.from("blog").getPublicUrl(path).data.publicUrl;
      setF((x: any) => ({ ...x, photos: [...x.photos, { uri, url }].slice(0, 4) }));
    } catch (e: any) { setErr("Photo: " + e.message); } finally { setBusy(""); }
  };
  const generate = async () => {
    setBusy("make"); setErr("");
    try {
      const r = await media("case", undefined, { project_id: project.id, district: (f.district === "Other" ? f.other : f.district).trim(), building: f.building, stone: f.stone,
        m2: Number(String(f.m2).replace(/[^\d.]/g, "")) || 0, fixing: f.fixing, year: Number(f.year), photos: f.photos.map((x: any) => x.url), notes: f.notes, show_client: f.show_client });
      await reload(["blog_posts", "projects"]); setF(null); setEd(r.post);
    } catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  };
  const toggle = (k: string) => setF({ ...f, fixing: f.fixing.includes(k) ? f.fixing.filter((x: string) => x !== k) : [...f.fixing, k] });
  return (
    <>
      <Btn icon={<Icon name="spark" size={16} />} title={en ? `SEO case study (${en.status === "Published" ? "live" : "draft"})` : "Publish as SEO Case Study"} onPress={() => (en ? setEd(en) : open())} />
      {en ? <Btn kind="ghost" title="Make it again" onPress={open} /> : null}
      <Sheet open={!!f} onClose={() => setF(null)} title={`SEO case study: ${project.name}`}>
        {f && <>
          <T size={13} muted>The AI writes an English and an Arabic project page for al-swaticontracting.com/projects/… from these facts and your site photos. Only the district is shown, never the address; the client's name only if you tick it. Both are drafts until you press Publish.</T>
          <T bold size={14}>District</T>
          <Row wrap>{[...DISTRICTS, "Other"].map((x) => <Btn key={x} kind={f.district === x ? "primary" : "ghost"} title={x} onPress={() => setF({ ...f, district: x })} />)}</Row>
          {f.district === "Other" ? <Field label="District name (as on Google Maps)" value={f.other} onChange={(v) => setF({ ...f, other: v })} /> : null}
          <Row wrap>
            <Select label="Building" value={f.building} options={BUILDINGS} onChange={(v) => setF({ ...f, building: v })} style={{ minWidth: 200 }} />
            <Select label="Main stone" value={f.stone} options={STONE_TYPES.map((x) => ({ value: x, label: x }))} onChange={(v) => setF({ ...f, stone: v })} style={{ minWidth: 200 }} />
          </Row>
          <Row wrap>
            <Field label={`Facade area, m² (Work done in the ERP: ${Math.round(installed).toLocaleString("en-US")} m²)`} value={f.m2} numeric onChange={(v) => setF({ ...f, m2: v })} />
            <Field label="Year finished" value={f.year} numeric onChange={(v) => setF({ ...f, year: v })} />
          </Row>
          <T bold size={14}>Fixing system</T>
          <Row wrap>{FIXINGS.map((x) => <Btn key={x.value} kind={f.fixing.includes(x.value) ? "primary" : "ghost"} title={x.label} onPress={() => toggle(x.value)} />)}</Row>
          <T bold size={14}>Site photos ({f.photos.length} of 4)</T>
          <Row wrap>
            {f.photos.map((x: any, i: number) => (
              <View key={x.url} style={{ gap: 4 }}>
                <Image source={{ uri: x.uri }} accessibilityLabel={`Photo ${i + 1}`} style={{ width: 120, height: 90, borderRadius: 6, backgroundColor: c.sunk }} />
                <Btn kind="ghost" title="Remove" onPress={() => setF({ ...f, photos: f.photos.filter((y: any) => y.url !== x.url) })} />
              </View>))}
            {f.photos.length < 4 ? <Btn icon={<Icon name="camera" />} title="Add photo" busy={busy === "photo"} disabled={!!busy} onPress={addPhoto} /> : null}
          </Row>
          <T size={12} muted>Use photos of the finished facade without people's faces or car number plates.</T>
          <Field label="Anything special about this job? (optional — only true facts)" value={f.notes} multiline onChange={(v) => setF({ ...f, notes: v })} placeholder="e.g. 3 cm Riyadh stone with Up-Down brackets on a 3-storey villa, cornices and window frames in the same stone" />
          {project.client ? <Btn kind={f.show_client ? "primary" : "ghost"} icon={f.show_client ? <Icon name="check" color={c.accentInk} /> : undefined} title={`Show the client's name (${project.client}) — only if the client agreed`} onPress={() => setF({ ...f, show_client: !f.show_client })} /> : null}
          {err ? <T color={c.bad}>{err}</T> : null}
          <Btn big kind="primary" icon={<Icon name="spark" color={c.accentInk} />} title="Generate the case study" busy={busy === "make"} disabled={!!busy || !(f.district === "Other" ? f.other.trim() : f.district)} onPress={generate} />
          <T size={12} muted>Takes about a minute.</T>
        </>}
      </Sheet>
      {ed && <PostEditor p={ed} onClose={() => setEd(null)} />}
    </>
  );
}

function CaseStudies() {
  const { d } = useData(); const c = useColors();
  const all = (d.blog_posts || []).filter((p: any) => p.area?.type === "case" && p.status !== "Archived");
  const rows = all.filter((p: any) => p.lang === "en" || !all.some((x: any) => x.id === p.twin_id));
  const ix = useIndexStatus(all.filter((p: any) => p.status === "Published").map((p: any) => SITE_URL + p.target_path));
  const [gbp, setGbp] = useState<any>(null), [mapNote, setMapNote] = useState(""), [dl, setDl] = useState("");
  const [ed, setEd] = useState<any>(null);
  return (
    <>
      <Card>
        <H2>Project case studies</H2>
        <T size={13} muted>Easiest: "Project add karein" below (photos + a few facts; the Projects agent cleans the photos and publishes the pages). Or from Projects → a project → "Publish as SEO Case Study". Each becomes an English and an Arabic page at {SITE_URL}/projects/… with your real data (district, building, stone, m², fixing system, year) and site photos, a card on the Projects page, Google data and a place in sitemap.xml.</T>
      </Card>
      <NewWebsiteProject />
      {!rows.length && <Empty text="No case studies yet." />}
      {rows.map((p: any) => {
        const tw = all.find((x: any) => x.id === p.twin_id), a = p.area;
        return (
          <Card key={p.id}>
            <Row>{a.photos?.[0] ? <Image source={{ uri: a.photos[0].url }} accessibilityLabel={a.photos[0].alt} style={{ width: 72, height: 54, borderRadius: 6 }} /> : null}
              <View style={{ flex: 1 }}><T bold>{p.title}</T><T size={12} muted>{a.district} · {a.stone} · {a.m2} m² · {a.year} · {SITE_URL}{p.target_path}</T></View>
              <Pill kind={p.status === "Published" ? "good" : "warn"} text={p.status} /></Row>
            <Row wrap>
              <Btn kind="ghost" title="English page" onPress={() => setEd(p)} />
              {tw ? <Btn kind="ghost" title="الصفحة العربية" onPress={() => setEd(tw)} /> : null}
              {p.status === "Published" ? <Btn kind="ghost" icon={<Icon name="share" />} title="Open" onPress={() => Linking.openURL(SITE_URL + p.target_path)} /> : null}
            </Row>
            {p.status === "Published" ? <IndexLine label={p.lang === "ar" ? "العربية" : "English"} url={SITE_URL + p.target_path} rows={ix.rows} onRows={ix.put} onGbp={() => setGbp(p)} /> : null}
            {tw?.status === "Published" ? <IndexLine label={tw.lang === "ar" ? "العربية" : "English"} url={SITE_URL + tw.target_path} rows={ix.rows} onRows={ix.put} /> : null}
            {p.status === "Published" && (p.area?.photos || []).length ? <Row wrap><Btn kind="ghost" icon={<Icon name="share" />} title="Photos for Google Maps" busy={dl === p.id} disabled={!!dl}
              onPress={async () => { setDl(p.id); setMapNote(await downloadMapPhotos(p).catch((e: any) => e.message)); setDl(""); }} /></Row> : null}
          </Card>);
      })}
      {mapNote ? <T size={13} muted>{mapNote}</T> : null}
      {gbp && <GbpSheet p={gbp} onClose={() => setGbp(null)} />}
      {ed && <PostEditor p={ed} onClose={() => setEd(null)} />}
    </>
  );
}

function Outreach() {
  const { d, reload, profile: me } = useData(); const c = useColors(); const profile = useProfile();
  const list = d.outreach_contacts || [];
  const [add, setAdd] = useState<any>(null), [mail, setMail] = useState<any>(null), [show, setShow] = useState("todo"), [err, setErr] = useState("");
  const sentToday = list.reduce((n: number, o: any) => n + (o.emails || []).filter((e: any) => day(e.at) === day(Date.now())).length, 0);
  const dueFollow = (o: any) => o.status === "Emailed" && o.last_contact && Date.now() - Date.parse(o.last_contact) > 7 * 864e5 && (o.emails || []).length < 3;
  const shown = list.filter((o: any) => show === "all" ? true : show === "todo" ? o.status === "New" || dueFollow(o) : show === "replied" ? ["Replied", "Meeting"].includes(o.status) : o.status === "Emailed");
  const saveContact = async () => {
    setErr("");
    if (!add.name.trim() || !add.source || (!add.email.trim() && !add.phone.trim())) { setErr("Name, how you know them, and an email or phone are needed."); return; }
    const row = { name: add.name.trim(), company: add.company, role: add.role, city: add.city, email: add.email.trim() || null, phone: add.phone, source: add.source, notes: add.notes };
    const r = add.id ? await supabase.from("outreach_contacts").update(row).eq("id", add.id) : await supabase.from("outreach_contacts").insert(row);
    if (r.error) { setErr(/duplicate|unique/i.test(r.error.message) ? "This email is already in the list." : r.error.message); return; }
    await reload(["outreach_contacts"]); setAdd(null);
  };
  const setStatus = async (o: any, status: string) => { await supabase.from("outreach_contacts").update({ status }).eq("id", o.id); reload(["outreach_contacts"]); };
  return (
    <>
      <Card>
        <Row><H2>Outreach</H2><View style={{ flex: 1 }} /><Btn kind="primary" icon={<Icon name="plus" color="#fff" />} title="Contact" onPress={() => setAdd({ name: "", company: "", role: "Project Manager", city: "Riyadh", email: "", phone: "", source: "", notes: "" })} /></Row>
        <T size={13} muted>For people you know or who gave you their contact — project managers, construction managers, consultants. The AI writes one personal email at a time; you read it and send it from your own email. Anyone who says no is never emailed again.</T>
        <Row wrap><Pill kind={sentToday >= DAILY_CAP ? "bad" : "acc"} text={`${sentToday} of ${DAILY_CAP} emails today`} /><Pill text={`${list.length} contacts`} />{list.filter(dueFollow).length ? <Pill kind="warn" text={`${list.filter(dueFollow).length} follow-ups due`} /> : null}</Row>
      </Card>
      <Row wrap>{[["todo", "To do"], ["emailed", "Waiting"], ["replied", "Replied"], ["all", "All"]].map(([k, l]) => <Btn key={k} kind={show === k ? "primary" : "ghost"} title={l} onPress={() => setShow(k)} />)}</Row>
      {!shown.length && <Empty text="Nobody here." />}
      {shown.map((o: any) => (
        <Card key={o.id}>
          <Row><View style={{ flex: 1 }}><T bold>{o.name}{o.company ? ` · ${o.company}` : ""}</T><T size={12} muted>{[o.role, o.city, o.email || o.phone, `via ${o.source}`].filter(Boolean).join(" · ")}</T></View>
            <Pill kind={o.status === "Opted out" || o.status === "Not interested" ? "plain" : ["Replied", "Meeting"].includes(o.status) ? "good" : o.status === "Emailed" ? "acc" : "warn"} text={o.status} /></Row>
          {(o.emails || []).length ? <T size={12} muted>Last email {stamp(o.last_contact)} · {(o.emails || []).length} sent</T> : null}
          <Row wrap>
            {o.email && (o.status === "New" || dueFollow(o)) && <Btn kind="primary" icon={<Icon name="spark" color={c.accentInk} />} title={o.status === "New" ? "Write email" : "Write follow-up"} disabled={sentToday >= DAILY_CAP} onPress={() => setMail({ o, kind: o.status === "New" ? "first" : "follow-up" })} />}
            {o.status === "Emailed" && <Btn title="They replied" onPress={() => setStatus(o, "Replied")} />}
            {o.status === "Replied" && <Btn title="Meeting / BOQ received" onPress={() => setStatus(o, "Meeting")} />}
            {!["Opted out", "Not interested"].includes(o.status) && <Btn kind="ghost" title="Said no / stop" onPress={() => setStatus(o, "Opted out")} />}
            <Btn kind="ghost" title="Edit" onPress={() => setAdd({ ...o, email: o.email || "", phone: o.phone || "", company: o.company || "", notes: o.notes || "" })} />
          </Row>
        </Card>))}
      {add && <Sheet open onClose={() => setAdd(null)} title={add.id ? "Edit contact" : "New contact"}>
        <Row wrap><Field required label="Name" value={add.name} onChange={(v) => setAdd({ ...add, name: v })} /><Field label="Company" value={add.company} onChange={(v) => setAdd({ ...add, company: v })} /></Row>
        <Row wrap><Select label="Role" value={add.role} options={ROLES.map((x) => ({ value: x, label: x }))} onChange={(v) => setAdd({ ...add, role: v })} /><Select label="City" value={add.city} options={CITIES.map((x) => ({ value: x, label: x }))} onChange={(v) => setAdd({ ...add, city: v })} /></Row>
        <Row wrap><Field label="Email" value={add.email} onChange={(v) => setAdd({ ...add, email: v })} /><Field label="Phone / WhatsApp" value={add.phone} onChange={(v) => setAdd({ ...add, phone: v })} /></Row>
        <Select label="How do you know them? *" value={add.source} options={[{ value: "", label: "—" }, ...SOURCES.map((x) => ({ value: x, label: x }))]} onChange={(v) => setAdd({ ...add, source: v })} />
        <Field label="Notes (project they run, where you met, what they need)" value={add.notes} multiline onChange={(v) => setAdd({ ...add, notes: v })} />
        {err ? <T color={c.bad}>{err}</T> : null}
        <Btn big kind="primary" title="Save" onPress={saveContact} />
      </Sheet>}
      {mail && <WriteMail o={mail.o} kind={mail.kind} profile={profile} signature={`${me.name}, ${profile.name}${profile.phone ? ` · ${profile.phone}` : ""}${profile.google_reviews ? `\nOur Google reviews: ${profile.google_reviews}` : ""}`} onClose={() => setMail(null)} />}
    </>
  );
}

function WriteMail({ o, kind, profile, signature, onClose }: { o: any; kind: string; profile: any; signature: string; onClose: () => void }) {
  const { reload } = useData(); const c = useColors();
  const [m, setM] = useState<any>(null), [lang, setLang] = useState("en"), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const write = async () => {
    setBusy(true); setErr("");
    try { setM(await ai("outreach_email", { contact: o, kind, lang, profile, signature })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const send = async () => {
    await Linking.openURL(`mailto:${o.email}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`);
    const at = new Date().toISOString();
    await supabase.from("outreach_contacts").update({ status: "Emailed", last_contact: at, emails: [...(o.emails || []), { at, subject: m.subject, body: m.body, kind }] }).eq("id", o.id);
    await reload(["outreach_contacts"]); onClose();
  };
  return (
    <Sheet open onClose={onClose} title={`${kind === "first" ? "Email" : "Follow-up"} to ${o.name}`}>
      <Row wrap><Select label="Language" value={lang} options={[{ value: "en", label: "English" }, { value: "ar", label: "العربية" }]} onChange={setLang} style={{ maxWidth: 170 }} /></Row>
      <Btn kind="primary" icon={<Icon name="spark" color={c.accentInk} />} title={m ? "Write again" : "Write the email"} busy={busy} onPress={write} />
      {m && <>
        <Field label="Subject" value={m.subject} onChange={(v) => setM({ ...m, subject: v })} />
        <Field label="Email (read it and change anything)" value={m.body} multiline onChange={(v) => setM({ ...m, body: v })} />
        <Btn big kind="primary" icon={<Icon name="share" color={c.accentInk} />} title="Open in my email" onPress={send} />
        <T size={12} muted>Your email app opens with this ready. You press send from your own address. Personal, one-by-one emails from your own account are what people read and reply to.</T>
      </>}
      {err ? <T color={c.bad}>{err}</T> : null}
    </Sheet>
  );
}

export default function Growth() {
  // Back from "Connect YouTube" (state "y.…"): open Videos, where that link is finished.
  const [tab, setTab] = useState<"blog" | "areas" | "cases" | "maps" | "videos" | "outreach">(() => (Platform.OS === "web" && (new URLSearchParams(globalThis.location?.search || "").get("state") || "").startsWith("y.") ? "videos" : "blog"));
  return (
    <Screen>
      <H1>Growth</H1>
      <Row wrap><Btn kind={tab === "blog" ? "primary" : "ghost"} title="Blog (SEO)" onPress={() => setTab("blog")} /><Btn kind={tab === "areas" ? "primary" : "ghost"} title="District pages" onPress={() => setTab("areas")} /><Btn kind={tab === "cases" ? "primary" : "ghost"} title="Case studies" onPress={() => setTab("cases")} /><Btn kind={tab === "maps" ? "primary" : "ghost"} title="Google Maps" onPress={() => setTab("maps")} /><Btn kind={tab === "videos" ? "primary" : "ghost"} title="Videos" onPress={() => setTab("videos")} /><Btn kind={tab === "outreach" ? "primary" : "ghost"} title="Outreach" onPress={() => setTab("outreach")} /></Row>
      <CompanyProfile />
      {tab === "blog" ? <Blog /> : tab === "areas" ? <DistrictPages /> : tab === "cases" ? <CaseStudies /> : tab === "maps" ? <MapsBooster /> : tab === "videos" ? <Videos /> : <Outreach />}
    </Screen>
  );
}
