// Growth: company profile, blog posts for search engines (SEO) and personal outreach to project managers.
// The AI only drafts. Posts go public only when the owner presses Publish; every email is read and sent by the owner himself.
import React, { useState } from "react";
import { Image, Linking, Platform, View } from "react-native";
import { useData } from "../lib/data";
import { day, stamp } from "../lib/fmt";
import { ai, supabase } from "../lib/supabase";
import { Btn, Card, Empty, Field, H1, H2, Icon, Pill, Row, Screen, Select, Sheet, StatStrip, Table, T, useColors } from "../ui";

export const BLOG_URL = "https://hussainkhan-maker.github.io/al-swati-erp/blog/";
const CITIES = ["Riyadh", "Dammam", "Al-Khobar", "Al-Hassa", "Jeddah", "Other"];
const ROLES = ["Project Manager", "Construction Manager", "Consultant", "Developer / Owner", "Main contractor", "Architect", "Other"];
const SOURCES = ["Met on site", "Business card", "Referral", "Worked together before", "They contacted us", "Event / exhibition", "Their website contact page", "Other"];
const DAILY_CAP = 15; // personal emails a day: enough for real conversations, low enough to stay personal
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "post-" + Date.now().toString(36);

/** The "blog-media" server function: "image" makes the post's picture, "arabic" writes its Arabic twin. */
async function media(action: "image" | "arabic", id: string): Promise<any> {
  const { data, error } = await supabase.functions.invoke("blog-media", { body: { action, id } });
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
      <T size={14}>{cur.name} · {cur.services} · {cur.cities}{cur.phone ? ` · ${cur.phone}` : ""}{cur.email ? ` · ${cur.email}` : ""}{cur.google_reviews ? " · Google reviews linked" : ""}</T>
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
      <Field label="Google reviews link (Google Maps → your business → Share)" value={f.google_reviews} onChange={(v) => set("google_reviews", v.trim())} placeholder="https://maps.google.com/?cid=…" />
      <Field label="True facts the AI may use (experience, types of buildings done, approvals) — only what you can prove" value={f.about} multiline onChange={(v) => set("about", v)} />
      {msg ? <T color={c.bad}>{msg}</T> : null}
      <Row><Btn kind="primary" title="Save" onPress={async () => { const { error } = await supabase.from("preferences").upsert({ key: "company_profile", value: f, updated_at: new Date().toISOString() }); if (error) setMsg(error.message); else { await reload(["preferences"]); setF(null); } }} /><Btn kind="ghost" title="Cancel" onPress={() => setF(null)} /></Row>
    </Card>
  );
}

/** SEO autopilot (server function "seo"): Google Search Console numbers, website leads, the weekly report, blog drafts and
 *  Google review messages. It runs every morning by itself; "Run now" is only for checking. Nothing goes out without the owner. */
function SeoAutopilot() {
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
  const t = s?.summary?.totals || {}, web = s?.summary?.web?.week || {};
  const ch = (a: number, b: number) => (b ? ` (${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%)` : "");
  const wa = (text: string) => Linking.openURL("https://wa.me/?text=" + encodeURIComponent(text));
  return (
    <Card>
      <Row wrap><H2>SEO autopilot</H2><View style={{ flex: 1 }} />
        {s?.google?.linked ? <Pill kind="good" text="Google linked" /> : <Pill kind="warn" text="Google Search Console not linked yet" />}</Row>
      <T size={13} muted>Every morning it reads Google's numbers for al-swaticontracting.com, finds searches close to page 1, writes 2 blog drafts a week from them, counts website leads and WhatsApp clicks, and tells the main agent. You only read and press Publish.{s?.last_tick ? ` Last run ${stamp(s.last_tick)}.` : ""}</T>
      {s?.summary && <StatStrip items={[
        { label: "Google clicks · 28 days", value: `${t.clicks ?? 0}${ch(t.clicks || 0, t.clicks_before || 0)}` },
        { label: "Seen in Google · 28 days", value: `${t.impressions ?? 0}${ch(t.impressions || 0, t.impressions_before || 0)}` },
        { label: "Average position", value: t.position ? `${t.position}${t.position_before ? ` (was ${t.position_before})` : ""}` : "-" },
        { label: "Website leads · 7 days", value: String(web.lead || 0) },
        { label: "WhatsApp / call clicks · 7 days", value: `${web.whatsapp || 0} / ${web.call || 0}` },
      ]} />}
      {s?.report?.text ? <Card><T bold>This week's report · {day(s.report.at)}</T>{String(s.report.text).split("\n").map((l: string, i: number) => <T key={i} size={14}>{l}</T>)}</Card> : null}
      {(s?.summary?.striking || []).length > 0 && <>
        <T bold>Close to page 1 (the next posts aim at these)</T>
        <Table cols={["Search", "Position", "Seen", "Clicks", "Page"]} numeric={[1, 2, 3]} rows={s.summary.striking.slice(0, 8).map((x: any) => [x.q, String(x.pos), String(x.impr), String(x.clicks), x.page])} />
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
      <SeoAutopilot />
      <Card>
        <Row><H2>Write a post yourself</H2><View style={{ flex: 1 }} />{today ? <Pill kind="good" text="written today" /> : null}</Row>
        <T size={13} muted>The autopilot already drafts 2 posts a week from real Google searches. Use this for an extra topic of your own. The AI drafts it; you read it and press Publish.</T>
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
          <Row>{p.image_url ? <Image source={{ uri: p.image_url }} accessibilityLabel={p.image_alt || p.title} style={{ width: 72, height: 41, borderRadius: 6 }} /> : null}
            <View style={{ flex: 1 }}><T bold>{p.title}</T><T size={12} muted>{p.lang === "ar" ? "العربية" : "English"} · {day(p.created_at)}{p.published_at ? ` · published ${day(p.published_at)}` : ""}{p.twin_id ? (p.lang === "ar" ? " · English version too" : " · Arabic version too") : ""}</T></View>
            {p.source === "autopilot" ? <Pill kind="acc" text="autopilot" /> : null}<Pill kind={p.status === "Published" ? "good" : p.status === "Draft" ? "warn" : "plain"} text={p.status} /></Row>
        </Card>))}
      {ed && <PostEditor p={ed} onClose={() => setEd(null)} />}
    </>
  );
}

function PostEditor({ p: first, onClose }: { p: any; onClose: () => void }) {
  const { d, reload } = useData(); const c = useColors();
  const p = (d.blog_posts || []).find((x: any) => x.id === first.id) || first; // picture and Arabic twin arrive while the sheet is open
  const twin = p.twin_id ? (d.blog_posts || []).find((x: any) => x.id === p.twin_id) : null;
  const [f, setF] = useState<any>({ ...first, keywords: (first.keywords || []).join(", ") }), [err, setErr] = useState(""), [step, setStep] = useState("");
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
  // Publish = this post goes public, gets its picture, and (for an English post) its Arabic twin goes public with it.
  const publish = async () => {
    setErr("");
    if (!(await save({ status: "Published", published_at: p.published_at || new Date().toISOString() }))) return;
    const problems: string[] = [];
    if (!p.image_url) {
      setStep("Making the picture…");
      try { await media("image", p.id); } catch (e: any) { problems.push("Picture: " + e.message); }
    }
    if (p.lang !== "ar") {
      setStep("Writing the Arabic version…");
      try {
        const r = await media("arabic", p.id);
        if (r?.post && r.post.status !== "Published") await supabase.from("blog_posts").update({ status: "Published", published_at: r.post.published_at || new Date().toISOString() }).eq("id", r.post.id);
      } catch (e: any) { problems.push("Arabic version: " + e.message); }
    }
    setStep(""); await reload(["blog_posts"]);
    if (problems.length) { setErr("The post is public. Not finished: " + problems.join(" · ") + " Press the button below to try again."); return; }
    onClose();
  };
  const redo = async (what: "image" | "arabic") => {
    setErr(""); setStep(what === "image" ? "Making the picture…" : "Writing the Arabic version…");
    try {
      const r = await media(what, p.id);
      if (what === "arabic" && r?.post && p.status === "Published" && r.post.status !== "Published") await supabase.from("blog_posts").update({ status: "Published", published_at: new Date().toISOString() }).eq("id", r.post.id);
    } catch (e: any) { setErr(e.message); }
    setStep(""); await reload(["blog_posts"]);
  };
  const unpublish = async () => {
    if (!(await save({ status: "Draft" }))) return;
    if (p.twin_id) await supabase.from("blog_posts").update({ status: "Draft", updated_at: new Date().toISOString() }).eq("id", p.twin_id);
    await reload(["blog_posts"]); onClose();
  };
  return (
    <Sheet open onClose={onClose} title={p.status === "Published" ? "Published post" : "Draft post"}>
      {p.image_url
        ? <Image source={{ uri: p.image_url }} accessibilityLabel={p.image_alt || p.title} resizeMode="cover" style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: c.sunk }} />
        : <T size={13} muted>No picture yet. The AI makes one for this topic when you press Publish.</T>}
      <Row wrap>
        <Btn kind="ghost" icon={<Icon name="spark" />} title={p.image_url ? "Make a new picture" : "Make the picture now"} busy={step.startsWith("Making")} disabled={!!step} onPress={() => redo("image")} />
        {p.lang !== "ar" && !twin && p.status === "Published" ? <Btn kind="ghost" icon={<Icon name="spark" />} title="Make the Arabic version" busy={step.startsWith("Writing")} disabled={!!step} onPress={() => redo("arabic")} /> : null}
      </Row>
      {p.lang !== "ar" ? <T size={13} muted>{twin ? `Arabic version: ${twin.title} (${twin.status === "Published" ? "public" : "draft"}) — open it from the list to read it.` : "The Arabic version (clear Arabic the way Saudi companies write) is written and published together with this post when you press Publish."}</T> : null}
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
        {p.status !== "Published" || err ? <Btn kind="primary" title={p.status === "Published" ? "Finish publishing" : "Publish"} busy={!!step} disabled={!!step} onPress={publish} />
          : <Btn title={twin ? "Unpublish (both languages)" : "Unpublish"} disabled={!!step} onPress={unpublish} />}
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
