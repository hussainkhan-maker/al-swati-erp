// Public blog page (no sign-in): …/al-swati-erp/blog/ lists the published posts, …/blog/?p=<link-name> shows one.
// Only posts the owner pressed "Publish" on can be read here (database rule), plus the company's contact card.
import React, { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { supabase } from "../lib/supabase";

const C = { bg: "#F4F8F6", card: "#FFFFFF", ink: "#18211E", muted: "#4F5C57", accent: "#0E6B5C", line: "#D6DCD7", deep: "#0F3B31" };
const base = () => (typeof location !== "undefined" ? location.pathname.replace(/\/blog.*$/, "/blog/") : "/blog/");
const slugNow = () => (typeof location !== "undefined" ? new URLSearchParams(location.search).get("p") : null);

function setHead(title: string, desc: string, lang: string) {
  if (typeof document === "undefined") return;
  document.title = title;
  document.documentElement.lang = lang;
  let m = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
  if (!m) { m = document.createElement("meta"); m.name = "description"; document.head.appendChild(m); }
  m.content = desc;
}

/** Very small markdown: ## headings, - bullets, **bold**, paragraphs. */
function Md({ text, rtl }: { text: string; rtl: boolean }) {
  const al = rtl ? "right" : "left";
  const inline = (s: string, k: number) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => /^\*\*/.test(p) ? <Text key={k + "-" + i} style={{ fontWeight: "700" }}>{p.slice(2, -2)}</Text> : p);
  const blocks = String(text || "").replace(/\r/g, "").split(/\n{2,}/);
  return <View style={{ gap: 14 }}>{blocks.map((b, i) => {
    const t = b.trim(); if (!t) return null;
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) return <Text key={i} accessibilityRole="header" style={{ fontSize: h[1].length <= 2 ? 22 : 18, fontWeight: "800", color: C.ink, textAlign: al, marginTop: 8 }}>{h[2]}</Text>;
    if (/^[-*•]\s/m.test(t)) return <View key={i} style={{ gap: 6 }}>{t.split("\n").map((l, j) => <Text key={j} style={{ fontSize: 17, lineHeight: 27, color: C.ink, textAlign: al }}>• {inline(l.replace(/^[-*•]\s*/, ""), j)}</Text>)}</View>;
    return <Text key={i} style={{ fontSize: 17, lineHeight: 28, color: C.ink, textAlign: al }}>{inline(t.replace(/\n/g, " "), i)}</Text>;
  })}</View>;
}

export default function PublicBlog() {
  const [posts, setPosts] = useState<any[] | null>(null), [co, setCo] = useState<any>({}), [slug, setSlug] = useState<string | null>(slugNow());
  const w = useWindowDimensions().width;
  useEffect(() => {
    supabase.from("blog_posts").select("title, slug, lang, meta_description, body, published_at").eq("status", "Published").order("published_at", { ascending: false }).limit(200).then(({ data }) => setPosts(data || []));
    supabase.from("preferences").select("value").eq("key", "company_profile").maybeSingle().then(({ data }) => setCo(data?.value || {}));
    const onPop = () => setSlug(slugNow());
    if (typeof window !== "undefined") window.addEventListener("popstate", onPop);
    return () => { if (typeof window !== "undefined") window.removeEventListener("popstate", onPop); };
  }, []);
  const go = (s: string | null) => { if (typeof history !== "undefined") history.pushState({}, "", base() + (s ? "?p=" + encodeURIComponent(s) : "")); setSlug(s); if (typeof window !== "undefined") window.scrollTo(0, 0); };
  const post = slug ? (posts || []).find((p) => p.slug === slug) : null;
  const name = co.name || "Al-Swati Contracting";
  useEffect(() => {
    if (post) setHead(`${post.title} | ${name}`, post.meta_description || "", post.lang === "ar" ? "ar" : "en");
    else setHead(`Blog | ${name}`, `${name}: ${co.services || "marble, granite, stone and porcelain flooring and cladding"} in ${co.cities || "Saudi Arabia"}.`, "en");
  }, [post?.slug, name]);
  const pad = w > 800 ? 40 : 18;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ alignItems: "center", paddingBottom: 60 }}>
      <View style={{ width: "100%", backgroundColor: C.deep, paddingVertical: 22, paddingHorizontal: pad, alignItems: "center" }}>
        <View style={{ width: "100%", maxWidth: 820 }}>
          <Pressable onPress={() => go(null)}><Text style={{ color: "#F2FBF7", fontSize: 24, fontWeight: "800" }}>{name}</Text></Pressable>
          <Text style={{ color: "#A9CFC2", fontSize: 14, marginTop: 4 }}>{co.services || "Marble · Granite · Stone · Porcelain"}{co.cities ? ` — ${co.cities}` : ""}</Text>
        </View>
      </View>
      <View style={{ width: "100%", maxWidth: 820, paddingHorizontal: pad, paddingTop: 26, gap: 18 }}>
        {posts === null ? <Text style={{ color: C.muted }}>Loading…</Text>
          : post ? <View style={{ gap: 16, backgroundColor: C.card, borderRadius: 18, padding: pad, borderWidth: 1, borderColor: C.line }}>
              <Pressable onPress={() => go(null)}><Text style={{ color: C.accent, fontWeight: "700" }}>‹ All articles</Text></Pressable>
              <Text accessibilityRole="header" style={{ fontSize: w > 800 ? 34 : 26, fontWeight: "800", color: C.ink, textAlign: post.lang === "ar" ? "right" : "left" }}>{post.title}</Text>
              <Text style={{ color: C.muted }}>{String(post.published_at || "").slice(0, 10)}</Text>
              <Md text={post.body} rtl={post.lang === "ar"} />
            </View>
          : slug ? <Text style={{ color: C.muted }}>This article is not available. <Text style={{ color: C.accent }} onPress={() => go(null)}>See all articles</Text></Text>
          : <>
              <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: "800", color: C.ink }}>Articles</Text>
              {!posts.length && <Text style={{ color: C.muted }}>No articles yet.</Text>}
              {posts.map((p) => (
                <Pressable key={p.slug} onPress={() => go(p.slug)} style={{ backgroundColor: C.card, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: C.line, gap: 6 }}>
                  <Text style={{ fontSize: 20, fontWeight: "800", color: C.ink, textAlign: p.lang === "ar" ? "right" : "left" }}>{p.title}</Text>
                  <Text style={{ fontSize: 15, color: C.muted, lineHeight: 22, textAlign: p.lang === "ar" ? "right" : "left" }}>{p.meta_description}</Text>
                  <Text style={{ fontSize: 13, color: C.accent, fontWeight: "700" }}>Read ›</Text>
                </Pressable>))}
            </>}
        {(co.phone || co.email) ? <View style={{ backgroundColor: C.deep, borderRadius: 18, padding: 20, gap: 6 }}>
          <Text style={{ color: "#F2FBF7", fontSize: 18, fontWeight: "800" }}>Have a project? Ask us for a quotation.</Text>
          {co.phone ? <Text style={{ color: "#A9CFC2", fontSize: 16 }} onPress={() => Linking.openURL("tel:" + co.phone)}>{co.phone}</Text> : null}
          {co.email ? <Text style={{ color: "#A9CFC2", fontSize: 16 }} onPress={() => Linking.openURL("mailto:" + co.email)}>{co.email}</Text> : null}
        </View> : null}
      </View>
    </ScrollView>
  );
}
