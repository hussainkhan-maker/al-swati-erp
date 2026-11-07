// Supplier directory and price requests. The AI writes the message; you send it yourself from WhatsApp 1, WhatsApp 2 or email.
import React, { useState } from "react";
import { Linking, View } from "react-native";
import { useFlows } from "../components/Flows";
import { useData } from "../lib/data";
import { ageDays, day, norm } from "../lib/fmt";
import { ai } from "../lib/supabase";
import { Btn, Card, Empty, Field, H1, H2, Icon, Pill, Row, Screen, Select, Sheet, T, useColors } from "../ui";

const CATS = ["Marble", "Granite", "Porcelain", "Ceramic", "Civil", "Fixing", "Other"];
const guessCats = (desc: string) => { const n = norm(desc); return CATS.filter((c) => (c === "Marble" && /marble|رخام|crema|carrara/.test(n)) || (c === "Granite" && /granite|جرانيت|غرانيت/.test(n)) || (c === "Porcelain" && /porcelain|بورسلان/.test(n)) || (c === "Ceramic" && /ceramic|سيراميك/.test(n)) || (c === "Civil" && /cement|sand|اسمنت|رمل|screed/.test(n)) || (c === "Fixing" && /adhesive|grout|anchor|لاصق/.test(n))); };
const waNumber = (s: string) => { let n = String(s || "").replace(/\D/g, ""); if (n.startsWith("00")) n = n.slice(2); if (n.startsWith("05")) n = "966" + n.slice(1); return n; };

export default function Suppliers() {
  const { d, role, insert, update, lang } = useData(); const c = useColors(); const flows = useFlows();
  const ar = role === "abu" && lang === "ar";
  const [f, setF] = useState<any>(null), [err, setErr] = useState(""), [q, setQ] = useState(""), [find, setFind] = useState(false);
  const reqs = d.supplier_requests || [];
  const list = (d.suppliers || []).filter((s: any) => !q || norm([s.name, s.city, ...(s.categories || [])].join(" ")).includes(norm(q)));
  const save = async () => {
    setErr("");
    try { const row = { name: f.name.trim(), city: f.city, cr_no: f.cr_no, cr_verified: !!f.cr_verified, phone: f.phone, whatsapp: f.whatsapp, email: f.email, categories: f.categories, lang: f.lang, notes: f.notes, website: f.website || null };
      if (!row.name) throw new Error("Name is required");
      if (f.id) await update("suppliers", f.id, row); else await insert("suppliers", row); setF(null);
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <Screen>
      <Row><View style={{ flex: 1 }}><H1>{ar ? "الموردون" : "Suppliers"}</H1></View><Btn kind="primary" icon={<Icon name="plus" color="#fff" />} title={ar ? "إضافة" : "Add"} onPress={() => setF({ name: "", city: "Riyadh", categories: [], lang: "ar" })} /></Row>
      <Btn big icon={<Icon name="spark" color={c.accent} />} title={ar ? "ابحث عن موردين جدد (ذكاء اصطناعي)" : "Find new suppliers (AI)"} onPress={() => setFind(true)} />
      <Field value={q} onChange={setQ} placeholder={ar ? "بحث: رخام، الرياض…" : "Search: marble, Riyadh…"} />
      {list.length ? list.map((s: any) => {
        const mine = reqs.filter((r: any) => r.supplier_id === s.id), open = mine.filter((r: any) => r.status === "Sent");
        const rated = mine.filter((r: any) => r.rating); const avg = rated.length ? (rated.reduce((a: number, r: any) => a + r.rating, 0) / rated.length).toFixed(1) : null;
        return (
          <Card key={s.id}>
            <Row><View style={{ flex: 1 }}><T bold size={17}>{s.name}</T><T muted size={13}>{[s.city, (s.categories || []).join(", "), s.cr_no && `CR ${s.cr_no}`].filter(Boolean).join(" · ")}</T></View>
              {s.cr_verified ? <Pill kind="good" text="CR checked" /> : <Pill kind="warn" text="CR not checked" />}</Row>
            {s.approved === false && <Card style={{ borderColor: c.warn }}>
              <T size={13}>{ar ? "وجده الذكاء الاصطناعي. راجع البيانات ثم اعتمد." : "Found by AI search. Check the details, then approve."}</T>
              {s.website ? <Btn kind="ghost" title={s.website} onPress={() => Linking.openURL(/^https?:/.test(s.website) ? s.website : "https://" + s.website)} /> : null}
              <Row wrap><Btn kind="primary" title={ar ? "اعتماد" : "Approve"} onPress={() => update("suppliers", s.id, { approved: true })} /><Btn kind="ghost" title={ar ? "تعديل" : "Edit"} onPress={() => setF({ ...s })} /></Row>
            </Card>}
            <Row wrap>{avg && <Pill kind="acc" text={`★ ${avg}`} />}{open.length > 0 && <Pill kind={open.some((r: any) => ageDays(r.sent_at) >= 2) ? "bad" : "warn"} text={`${open.length} waiting for reply`} />}</Row>
            {open.map((r: any) => (
              <Card key={r.id} style={{ backgroundColor: c.sunk }}>
                <T size={13}>{day(r.sent_at)} · {(r.items || []).length} items · {r.channel}</T>
                <Row wrap>
                  <Btn title={ar ? "ردّ — سجّل الأسعار" : "Replied — record prices"} onPress={async () => { await update("supplier_requests", r.id, { status: "Replied", replied_at: new Date().toISOString() }); flows("speak", { text: `${s.name}: ` }); }} />
                  <Btn kind="ghost" title={ar ? "لم يرد" : "No reply"} onPress={() => update("supplier_requests", r.id, { status: "No reply" })} />
                </Row>
              </Card>))}
            <Row wrap>
              {s.whatsapp ? <Btn icon={<Icon name="share" />} title="WhatsApp" onPress={() => Linking.openURL(`https://wa.me/${waNumber(s.whatsapp)}`)} /> : null}
              {s.phone ? <Btn title={ar ? "اتصال" : "Call"} onPress={() => Linking.openURL(`tel:${s.phone}`)} /> : null}
              <Btn kind="ghost" title={ar ? "تعديل" : "Edit"} onPress={() => setF({ ...s })} />
            </Row>
          </Card>);
      }) : <Empty text={ar ? "لا يوجد موردون بعد." : "No suppliers yet. Add the ones you already work with first."} />}

      {find && <FindSuppliers onClose={() => setFind(false)} />}
      <Sheet open={!!f} onClose={() => setF(null)} title={f?.id ? (ar ? "تعديل مورد" : "Edit supplier") : (ar ? "مورد جديد" : "New supplier")}>
        {f && <>
          <Field label={ar ? "الاسم" : "Name"} value={f.name} onChange={(v) => setF({ ...f, name: v })} />
          <Row><Field label={ar ? "المدينة" : "City"} value={f.city} onChange={(v) => setF({ ...f, city: v })} /><Field label="CR no." value={f.cr_no} numeric onChange={(v) => setF({ ...f, cr_no: v })} /></Row>
          <Btn kind={f.cr_verified ? "primary" : "default"} title={f.cr_verified ? "✓ CR checked on the Ministry of Commerce site" : "I checked the CR (Saudi registration)"} onPress={() => setF({ ...f, cr_verified: !f.cr_verified })} />
          <Row><Field label="WhatsApp" value={f.whatsapp} numeric onChange={(v) => setF({ ...f, whatsapp: v })} /><Field label={ar ? "هاتف" : "Phone"} value={f.phone} numeric onChange={(v) => setF({ ...f, phone: v })} /></Row>
          <Field label="Email" value={f.email} onChange={(v) => setF({ ...f, email: v.trim() })} />
          <Field label={ar ? "الموقع" : "Website"} value={f.website} onChange={(v) => setF({ ...f, website: v.trim() })} />
          <T bold>{ar ? "يبيع" : "Sells"}</T>
          <Row wrap>{CATS.map((k) => { const on = (f.categories || []).includes(k); return <Btn key={k} kind={on ? "primary" : "default"} title={k} onPress={() => setF({ ...f, categories: on ? f.categories.filter((x: string) => x !== k) : [...(f.categories || []), k] })} />; })}</Row>
          <Select label={ar ? "لغة الرسائل" : "Message language"} value={f.lang} onChange={(v) => setF({ ...f, lang: v })} options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }, { value: "ur", label: "اردو" }]} />
          <Field label={ar ? "ملاحظات" : "Notes"} value={f.notes} onChange={(v) => setF({ ...f, notes: v })} multiline />
          {err ? <T color={c.bad}>{err}</T> : null}
          <Btn big kind="primary" title={ar ? "احفظ" : "Save"} onPress={save} />
        </>}
      </Sheet>
    </Screen>
  );
}

/** From a client query or quotation: pick suppliers, let the AI write each message, send it yourself, and track replies. */
export function RequestPrices({ init, onClose }: { init: { items: any[]; inquiry_id?: string; quote_id?: string }; onClose: () => void }) {
  const { d, insert, profile } = useData(); const c = useColors();
  const need = [...new Set(init.items.flatMap((i: any) => guessCats(i.desc)))];
  const fit = (d.suppliers || []).filter((s: any) => s.approved !== false).filter((s: any) => !need.length || (s.categories || []).some((k: string) => need.includes(k)));
  const [pick, setPick] = useState<string[]>(fit.slice(0, 5).map((s: any) => s.id));
  const [msgs, setMsgs] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [sent, setSent] = useState<string[]>([]), [err, setErr] = useState("");
  const draft = async () => {
    setBusy(true); setErr("");
    try {
      const out: Record<string, string> = {};
      for (const id of pick) { const s = (d.suppliers || []).find((x: any) => x.id === id); const r = await ai("supplier_msg", { supplier: s.name, lang: s.lang, city: s.city, items: init.items, signature: profile.name + " · Al-Swati" }); out[id] = r.text; }
      setMsgs(out);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const send = async (s: any, channel: "whatsapp" | "email") => {
    const text = msgs[s.id];
    const url = channel === "whatsapp" ? `https://wa.me/${waNumber(s.whatsapp || s.phone)}?text=${encodeURIComponent(text)}` : `mailto:${s.email}?subject=${encodeURIComponent("Price request")}&body=${encodeURIComponent(text)}`;
    await Linking.openURL(url);
    await insert("supplier_requests", { supplier_id: s.id, inquiry_id: init.inquiry_id || null, quote_id: init.quote_id || null, items: init.items, message: text, channel, status: "Sent", sent_at: new Date().toISOString() });
    setSent([...sent, s.id]);
  };
  return (
    <Sheet open onClose={onClose} title="Ask suppliers for prices">
      <T muted>{init.items.length} items · looking for: {need.join(", ") || "any"}</T>
      <H2>Choose suppliers</H2>
      <Row wrap>{(fit.length ? fit : d.suppliers || []).map((s: any) => { const on = pick.includes(s.id); return <Btn key={s.id} kind={on ? "primary" : "default"} title={s.name} onPress={() => setPick(on ? pick.filter((x) => x !== s.id) : [...pick, s.id])} />; })}</Row>
      {!(d.suppliers || []).length && <T muted>Add suppliers first under More → Suppliers.</T>}
      <Btn big kind="primary" icon={<Icon name="spark" color={c.accentInk} />} title="Write the messages" busy={busy} disabled={!pick.length} onPress={draft} />
      {err ? <T color={c.bad}>{err}</T> : null}
      {pick.filter((id) => msgs[id]).map((id) => { const s = (d.suppliers || []).find((x: any) => x.id === id);
        return (
          <Card key={id}>
            <Row><T bold style={{ flex: 1 }}>{s.name}</T>{sent.includes(id) && <Pill kind="good" text="Sent" />}</Row>
            <Field value={msgs[id]} multiline onChange={(v) => setMsgs({ ...msgs, [id]: v })} />
            <Row wrap>
              {(s.whatsapp || s.phone) ? <Btn kind="primary" icon={<Icon name="share" color={c.accentInk} />} title="Open in WhatsApp" onPress={() => send(s, "whatsapp")} /> : null}
              {s.email ? <Btn title="Open in email" onPress={() => send(s, "email")} /> : null}
            </Row>
            <T size={12} muted>WhatsApp opens with the message ready. If you have two WhatsApps, the phone asks which one. You press send.</T>
          </Card>); })}
    </Sheet>
  );
}

/** Supplier finder agent: searches the web for Saudi suppliers. Results wait for your approval; nothing is added by itself. */
function FindSuppliers({ onClose }: { onClose: () => void }) {
  const { d, insert } = useData(); const c = useColors();
  const [m, setM] = useState(""), [city, setCity] = useState("Riyadh"), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [res, setRes] = useState<any[]>([]), [added, setAdded] = useState<string[]>([]);
  const known = (n: string) => (d.suppliers || []).some((s: any) => norm(s.name) === norm(n));
  const search = async () => {
    setBusy(true); setErr(""); setRes([]);
    try { const r = await ai("find_suppliers", { material: m, city }); setRes((r.suppliers || []).filter((s: any) => s?.name)); if (!(r.suppliers || []).length) setErr("Nothing found. Try another material name or city."); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const add = async (s: any) => {
    const cats = (s.categories || []).filter((k: string) => CATS.includes(k));
    await insert("suppliers", { name: s.name, city: s.city || city, phone: s.phone || null, whatsapp: s.whatsapp || null, email: s.email || null, website: s.website || null, cr_no: s.cr_no || null,
      categories: cats.length ? cats : guessCats(m), lang: "ar", notes: [s.note, s.source_url && `Found at: ${s.source_url}`].filter(Boolean).join("\n"), source: "ai-search", approved: false });
    setAdded([...added, s.name]);
  };
  return (
    <Sheet open onClose={onClose} title="Find new suppliers">
      <Field label="Material (e.g. Crema Marfil marble 2 cm, porcelain 60×120)" value={m} onChange={setM} />
      <Field label="City" value={city} onChange={setCity} />
      <Btn big kind="primary" icon={<Icon name="spark" color={c.accentInk} />} title="Search the web" busy={busy} disabled={m.trim().length < 3} onPress={search} />
      {busy && <T muted>The AI is searching company sites and directories. About a minute.</T>}
      {err ? <T color={c.bad}>{err}</T> : null}
      {res.map((s, i) => (
        <Card key={i}>
          <Row><View style={{ flex: 1 }}><T bold>{s.name}</T><T muted size={13}>{[s.city, (s.categories || []).join(", "), s.cr_no && `CR ${s.cr_no}`].filter(Boolean).join(" · ")}</T></View>
            {known(s.name) ? <Pill kind="plain" text="Already in list" /> : added.includes(s.name) ? <Pill kind="good" text="Added" /> : null}</Row>
          {s.note ? <T size={14}>{s.note}</T> : null}
          <T size={13} muted>{[s.phone, s.whatsapp && `WA ${s.whatsapp}`, s.email, s.website].filter(Boolean).join(" · ") || "No contact found"}</T>
          <Row wrap>
            {s.source_url ? <Btn kind="ghost" title="Open source page" onPress={() => Linking.openURL(s.source_url)} /> : null}
            {!known(s.name) && !added.includes(s.name) && <Btn kind="primary" title="Add for approval" onPress={() => add(s)} />}
          </Row>
        </Card>))}
      {res.length > 0 && <T size={12} muted>Check the CR on the Ministry of Commerce site before you approve a new supplier.</T>}
    </Sheet>
  );
}
