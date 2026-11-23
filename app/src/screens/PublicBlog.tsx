// The old public blog address (…/al-swati-erp/blog/ and …/blog/?p=<link-name>) now sends visitors and Google to the
// company website, where every published post is a real page: https://al-swaticontracting.com/blog/<slug>/ (English) and
// /ar/blog/<slug without -ar>/ (Arabic). One address per article keeps the ranking on the company's own domain, and
// "noindex" tells Google not to keep this app address in its results.
import React, { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { supabase } from "../lib/supabase";
import { BLOG_URL, SITE_URL, postUrl } from "./Growth";

function noindex() {
  if (typeof document === "undefined") return;
  document.title = "Blog | Al-Swati Contracting";
  let m = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
  if (!m) { m = document.createElement("meta"); m.name = "robots"; document.head.appendChild(m); }
  m.content = "noindex, follow";
}

export default function PublicBlog() {
  const [to, setTo] = useState(BLOG_URL);
  useEffect(() => {
    noindex();
    if (typeof location === "undefined") return;
    const qs = new URLSearchParams(location.search), slug = qs.get("p");
    const go = (u: string) => { setTo(u); location.replace(u); };
    if (!slug) { go(qs.get("lang") === "ar" ? SITE_URL + "/ar/blog/" : BLOG_URL); return; }
    supabase.from("blog_posts").select("slug, lang").eq("slug", slug).eq("status", "Published").maybeSingle()
      .then(({ data }) => go(data ? postUrl(data) : /-ar$/.test(slug) ? SITE_URL + "/ar/blog/" : BLOG_URL), () => go(BLOG_URL));
  }, []);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#1a1a1a", gap: 10 }}>
      <Text style={{ color: "#f5f5f5", fontSize: 18 }}>Our blog is on our website</Text>
      <Pressable onPress={() => Linking.openURL(to)}><Text style={{ color: "#c9a25b", fontSize: 16 }}>{to}</Text></Pressable>
    </View>
  );
}
