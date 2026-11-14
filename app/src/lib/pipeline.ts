// Query → quotation → project, done by the app itself.
// The server reads every new client query (app open or not); a clean one (no red gate) becomes a draft quotation with the rates
// we quoted before for the same material; when the client approves the quotation, the project opens by itself.
// Prices are never sent anywhere automatically: the owner still checks the rates, locks and sends.
import { useEffect, useRef } from "react";
import { useData } from "./data";
import { num, stamp } from "./fmt";
import { ai, supabase } from "./supabase";

const isM2 = (u: any) => /^(sqm|m2|m²|م2|م²|متر مربع)$/i.test(String(u || "").trim());

/** Draft quotation from a read query. `hint` gives the price memory for a line (rate we quoted before). */
export async function quoteFromQuery(q: any, d: any, insert: any, update: any, hint?: (d: any, desc: string) => any) {
  // Claim the query first: if the server autopilot (or a second click) already made its quotation, stop here.
  const { data: claim, error: ce } = await supabase.from("inquiries").update({ status: "Priced" }).eq("id", q.id).is("quote_id", null).in("status", ["New", "Under Review", "RFI Sent"]).select("id");
  if (ce) throw new Error(ce.message);
  if (!claim?.length) throw new Error("This query already has a quotation (open Quotations).");
  const src = (q.reading?.a?.lines || []) as any[];
  const lines = src.map((l) => {
    const h = hint ? hint(d, l.desc) : null;
    const rate = h && h.score >= 0.75 && Number(h.sell?.price) > 0 ? Number(h.sell.price) : null;
    return { desc: (l.ref ? l.ref + " · " : "") + l.desc, qty: num(l.qty) || 0, unit: l.unit, rate };
  });
  const pre = lines.filter((l) => l.rate).length;
  const res = await insert("quotes", {
    title: q.subject || q.ref, client: q.from_name, owner: "admin", lines,
    history: [`${stamp(Date.now())} made from ${q.ref}${pre ? `; ${pre} rate(s) filled from earlier quotations, check them` : ""}`],
    rfq: { inquiry_id: q.id, ref: q.ref },
  });
  await update("inquiries", q.id, { status: "Priced", quote_id: res.data?.id || null });
  return res.data?.id as string | undefined;
}

/** Client approved the quotation: open the project with its scope and client rate, mark the query Won. */
export async function projectFromQuote(q: any, d: any, reload: (k?: string[]) => Promise<void>) {
  if (q.project_id) return q.project_id;
  // Claim the quotation first, so a double click or two screens never open two projects.
  const { data: claim, error: ce } = await supabase.from("quotes").update({ status: "Approved" }).eq("id", q.id).is("project_id", null).neq("status", "Approved").select("id");
  if (ce) throw new Error(ce.message);
  if (!claim?.length) throw new Error("This quotation already has a project (open Projects).");
  const m2 = (q.lines || []).filter((l: any) => isM2(l.unit) && Number(l.rate) > 0 && Number(l.qty) > 0);
  const qty = m2.reduce((t: number, l: any) => t + Number(l.qty), 0);
  const rate = qty ? Math.round((m2.reduce((t: number, l: any) => t + Number(l.qty) * Number(l.rate), 0) / qty) * 100) / 100 : 0;
  const { data, error } = await supabase.from("projects").insert({ name: q.title, client: q.client, company: "", fee_pct: 0, quote_id: q.id, scope: q.lines }).select().single();
  if (error) { await supabase.from("quotes").update({ status: q.status }).eq("id", q.id); throw new Error(error.message); }
  if (rate) {
    // Read the terms fresh from the database, so terms saved for other projects a moment ago are kept.
    const { data: pt } = await supabase.from("preferences").select("value").eq("key", "project_terms").maybeSingle();
    const all = { ...((pt?.value as any) || {}), [data.id]: { rate } };
    await supabase.from("preferences").upsert({ key: "project_terms", value: all, updated_at: new Date().toISOString() });
  }
  const { error: e2 } = await supabase.from("quotes").update({ status: "Approved", project_id: data.id, history: [...(q.history || []), `${stamp(Date.now())} client approved; project opened`] }).eq("id", q.id);
  if (e2) throw new Error(e2.message);
  if (q.rfq?.inquiry_id) await supabase.from("inquiries").update({ status: "Won" }).eq("id", q.rfq.inquiry_id);
  await reload(["projects", "preferences", "quotes", "inquiries"]);
  return data.id as string;
}

/** While Super-Admin has the app open, waiting queries are handed to the server autopilot at once
 *  (the server also runs it by itself when a query arrives, and every 30 minutes). */
export function useAutopilot(_hint?: (d: any, desc: string) => any) {
  const { d, role, reload } = useData();
  const busy = useRef(false), last = useRef("");
  const key = ((d.inquiries || []) as any[]).filter((q) => (q.status === "New" && !q.reading) || (q.reading && !q.quote_id && ["New", "Under Review"].includes(q.status))).map((q) => q.id).join(",");
  useEffect(() => {
    if (role !== "admin" || !key || busy.current || last.current === key) return;
    busy.current = true; last.current = key;
    ai("autopilot", {}).then((r: any) => (r?.read || r?.quoted ? reload(["inquiries", "quotes"]) : null)).catch(() => {}).finally(() => { busy.current = false; });
  }, [role, key]);
}
