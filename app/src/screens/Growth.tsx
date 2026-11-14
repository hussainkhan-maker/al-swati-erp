// Growth: company profile, blog posts for search engines (SEO) and personal outreach to project managers.
// The AI only drafts. Posts go public only when the owner presses Publish; every email is read and sent by the owner himself.
import React, { useState } from "react";
import { Linking, Platform, View } from "react-native";
import { useData } from "../lib/data";
import { day, stamp } from "../lib/fmt";
import { ai, supabase } from "../lib/supabase";
import { Btn, Card, Empty, Field, H1, H2, Icon, Pill, Row, Screen, Select, Sheet, T, useColors } from "../ui";

export const BLOG_URL = "https://hussainkhan-maker.github.io/al-swati-erp/blog/";
const CITIES = ["Riyadh", "Dammam", "Al-Khobar", "Al-Hassa", "Jeddah", "Other"];
const ROLES = ["Project Manager", "Construction Manager", "Consultant", "Developer / Owner", "Main contractor", "Architect", "Other"];
const SOURCES = ["Met on site", "Business card", "Referral", "Worked together before", "They contacted us", "Event / exhibition", "Their website contact page", "Other"];
const DAILY_CAP = 15; // personal emails a day: enough for real conversations, low enough to stay personal
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "post-" + Date.now().toString(36);

function useProfile() {
  const { d } = useData();
  return { name: "Al-Swati Contracting", services: "Supply and installation of marble, granite, natural stone and porcelain for flooring and facade cladding", cities: "Riyadh, Dammam, Al-Hassa", phone: "", email: "", website: "", about: "",
    ...((d.preferences || []).find((p: any) => p.key === "company_profile")?.value || {}) };
}

function CompanyProfile() {
  const { reload } = useData(); const c = useColors(); const cur = useProfile();
  const [f, setF] = useState<any>(null), [msg, setMsg] = useState("");
  if (!f) return (
    <Card>
      <Row><H2>Company profile</H2><View style={{ flex: 1 }} /><Btn kind="ghost" title="Edit" onPress={() => setF(cur)} /></Row>
      <T size={13} muted>The AI writes only these facts about the company — never invented projects, clients or numbers.</T>
      <T size={14}>{cur.name} · {cur.services} · {cur.cities}{cur.phone ? ` · ${cur.phone}` : ""}{cur.email ? ` · ${cur.email}` : ""}</T>
      {!cur.phone && !cur.email ? <T color={c.warn}>Add a phone or email so readers can contact you.</T> : null}
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
      <Field label="True facts the AI may use (experience, types of buildings done, approvals) — only what you can prove" value={f.about} multiline onChange={(v) => set("about", v)} />
      {msg ? <T color={c.bad}>{msg}</T> : null}
      <Row><Btn kind="primary" title="Save" onPress={async () => { const { error } = await supabase.from("preferences").upsert({ key: "company_profile", value: f, updated_at: new Date().toISOString() }); if (error) setMsg(error.message); else { await reload(["preferences"]); setF(null); } }} /><Btn kind="ghost" title="Cancel" onPress={() => setF(null)} /></Row>
    </Card>
  );
}

function Blog() {
  const { d, reload } = useData(); const c = useColors(); const profile = useProfile();
  const posts = d.blog_posts || [];
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
      <Card>
        <Row><H2>Today's blog post</H2><View style={{ flex: 1 }} />{today ? <Pill kind="good" text="written today" /> : <Pill kind="warn" text="not written yet" />}</Row>
        <T size={13} muted>One useful post a day helps people searching Google for stone and marble work in your cities find you. The AI drafts it; you read it and press Publish.</T>
        <Row wrap>
          <Field label="Topic (or pick an idea below)" value={topic} onChange={setTopic} placeholder="e.g. Choosing marble for villa floors in Riyadh heat" />
          <Field label="Main search phrase" value={kw} onChange={setKw} placeholder="e.g. marble flooring Riyadh" style={{ maxWidth: 240 }} />
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
      <T size={13} muted>Published posts are public at {BLOG_URL} — share that link or add it to your website and Google Business profile.</T>
      {!posts.length && <Empty text="No posts yet." />}
      {posts.map((p: any) => (
        <Card key={p.id} onPress={() => setEd(p)}>
          <Row><View style={{ flex: 1 }}><T bold>{p.title}</T><T size={12} muted>{p.lang === "ar" ? "العربية" : "English"} · {day(p.created_at)}{p.published_at ? ` · published ${day(p.published_at)}` : ""}</T></View>
            <Pill kind={p.status === "Published" ? "good" : p.status === "Draft" ? "warn" : "plain"} text={p.status} /></Row>
        </Card>))}
      {ed && <PostEditor p={ed} onClose={() => setEd(null)} />}
    </>
  );
}

function PostEditor({ p, onClose }: { p: any; onClose: () => void }) {
  const { reload } = useData(); const c = useColors();
  const [f, setF] = useState<any>({ ...p, keywords: (p.keywords || []).join(", ") }), [err, setErr] = useState("");
  const words = String(f.body || "").split(/\s+/).filter(Boolean).length;
  const checks = [
    { ok: f.title.length > 10 && f.title.length <= 65, text: `Title ${f.title.length} characters (best 30–65)` },
    { ok: (f.meta_description || "").length >= 70 && (f.meta_description || "").length <= 160, text: `Search description ${(f.meta_description || "").length} characters (best 70–160)` },
    { ok: words >= 500, text: `${words} words (500+ ranks better)` },
    { ok: /^#{2}\s/m.test(f.body || ""), text: "Has headings" },
  ];
  const save = async (patch: any = {}) => {
    const { error } = await supabase.from("blog_posts").update({ title: f.title, meta_description: f.meta_description, keywords: String(f.keywords).split(/[,،]/).map((s) => s.trim()).filter(Boolean), body: f.body, slug: f.slug, updated_at: new Date().toISOString(), ...patch }).eq("id", p.id);
    if (error) { setErr(error.message); return false; } await reload(["blog_posts"]); return true;
  };
  const link = BLOG_URL + "?p=" + encodeURIComponent(f.slug);
  return (
    <Sheet open onClose={onClose} title={p.status === "Published" ? "Published post" : "Draft post"}>
      <Field label="Title" value={f.title} onChange={(v) => setF({ ...f, title: v })} />
      <Field label="Search description (shown under the title on Google)" value={f.meta_description} multiline onChange={(v) => setF({ ...f, meta_description: v })} />
      <Field label="Keywords" value={f.keywords} onChange={(v) => setF({ ...f, keywords: v })} />
      <Field label="Link name" value={f.slug} onChange={(v) => setF({ ...f, slug: slugify(v) })} />
      <Field label="Text (## = heading, - = bullet, **bold**)" value={f.body} multiline onChange={(v) => setF({ ...f, body: v })} />
      <View style={{ gap: 4 }}>{checks.map((x, i) => <T key={i} size={13} color={x.ok ? c.good : c.warn}>{x.ok ? "✓" : "!"} {x.text}</T>)}</View>
      <T size={12} muted>Read it once before publishing: every fact about your company must be true.</T>
      {err ? <T color={c.bad}>{err}</T> : null}
      <Row wrap>
        <Btn title="Save" onPress={async () => { if (await save()) onClose(); }} />
        {p.status !== "Published" ? <Btn kind="primary" title="Publish" onPress={async () => { if (await save({ status: "Published", published_at: new Date().toISOString() })) onClose(); }} />
          : <Btn title="Unpublish" onPress={async () => { if (await save({ status: "Draft" })) onClose(); }} />}
        {p.status === "Published" && <Btn kind="ghost" icon={<Icon name="share" />} title="Open public page" onPress={() => Linking.openURL(link)} />}
        <Btn kind="ghost" title="Delete" onPress={async () => { const { error } = await supabase.from("blog_posts").delete().eq("id", p.id); if (error) setErr(error.message); else { await reload(["blog_posts"]); onClose(); } }} />
      </Row>
    </Sheet>
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
      {mail && <WriteMail o={mail.o} kind={mail.kind} profile={profile} signature={`${me.name}, ${profile.name}${profile.phone ? ` · ${profile.phone}` : ""}`} onClose={() => setMail(null)} />}
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
  const [tab, setTab] = useState<"blog" | "outreach">("blog");
  return (
    <Screen>
      <H1>Growth</H1>
      <Row wrap><Btn kind={tab === "blog" ? "primary" : "ghost"} title="Blog (SEO)" onPress={() => setTab("blog")} /><Btn kind={tab === "outreach" ? "primary" : "ghost"} title="Outreach" onPress={() => setTab("outreach")} /></Row>
      <CompanyProfile />
      {tab === "blog" ? <Blog /> : <Outreach />}
    </Screen>
  );
}
