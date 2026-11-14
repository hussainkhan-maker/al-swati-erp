// Query → quotation → project, done by the app itself.
// The AI reads every new client query; a clean one (no red gate) becomes a draft quotation with the rates
// we quoted before for the same material; when the client approves the quotation, the project opens by itself.
// Prices are never sent anywhere automatically: the owner still checks the rates, locks and sends.
import { useEffect, useRef } from "react";
import { rfqGates } from "./checks";
import { useData } from "./data";
import { matchItems, num, stamp } from "./fmt";
import { ai, supabase } from "./supabase";

const isM2 = (u: any) => /^(sqm|m2|m²|م2|م²|متر مربع)$/i.test(String(u || "").trim());

/** Draft quotation from a read query. `hint` gives the price memory for a line (rate we quoted before). */
export async function quoteFromQuery(q: any, d: any, insert: any, update: any, hint?: (d: any, desc: string) => any) {
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
  const m2 = (q.lines || []).filter((l: any) => isM2(l.unit) && Number(l.rate) > 0 && Number(l.qty) > 0);
  const qty = m2.reduce((t: number, l: any) => t + Number(l.qty), 0);
  const rate = qty ? Math.round((m2.reduce((t: number, l: any) => t + Number(l.qty) * Number(l.rate), 0) / qty) * 100) / 100 : 0;
  const { data, error } = await supabase.from("projects").insert({ name: q.title, client: q.client, company: "", fee_pct: 0, quote_id: q.id, scope: q.lines }).select().single();
  if (error) throw new Error(error.message);
  if (rate) {
    const all = { ...((d.preferences || []).find((p: any) => p.key === "project_terms")?.value || {}), [data.id]: { rate } };
    await supabase.from("preferences").upsert({ key: "project_terms", value: all, updated_at: new Date().toISOString() });
  }
  const { error: e2 } = await supabase.from("quotes").update({ status: "Approved", project_id: data.id, history: [...(q.history || []), `${stamp(Date.now())} client approved; project opened`] }).eq("id", q.id);
  if (e2) throw new Error(e2.message);
  if (q.rfq?.inquiry_id) await supabase.from("inquiries").update({ status: "Won" }).eq("id", q.rfq.inquiry_id);
  await reload(["projects", "preferences", "quotes", "inquiries"]);
  return data.id as string;
}

/** Runs while Super-Admin has the app open: reads new queries and turns clean ones into draft quotations. */
export function useAutopilot(hint?: (d: any, desc: string) => any) {
  const { d, role, insert, update, reload } = useData();
  const tried = useRef<Set<string>>(new Set()), busy = useRef(false);
  const inq = (d.inquiries || []) as any[];
  const unread = inq.filter((q) => q.status === "New" && !q.reading && !tried.current.has("r" + q.id)).map((q) => q.id).join(",");
  const ready = inq.filter((q) => q.reading && !q.quote_id && ["New", "Under Review"].includes(q.status) && !tried.current.has("q" + q.id)).map((q) => q.id).join(",");
  useEffect(() => {
    if (role !== "admin" || busy.current || (!unread && !ready)) return;
    busy.current = true;
    (async () => {
      try {
        // 1. Read up to two new queries at a time (each reading costs AI tokens).
        const toRead = inq.filter((q) => unread.split(",").includes(q.id)).slice(0, 2);
        for (const q of toRead) { tried.current.add("r" + q.id); try { await ai("rfq", { inquiry_id: q.id }); } catch { /* shown on the query when opened */ } }
        if (toRead.length) { await reload(["inquiries"]); return; }
        // 2. A read query with lines and no red gate becomes a draft quotation.
        for (const q of inq.filter((x) => ready.split(",").includes(x.id))) {
          tried.current.add("q" + q.id);
          const r = q.reading, lines = r?.a?.lines || [];
          const gates = rfqGates(q.body || "", r?.a || {}, r?.b || {}, (desc: string) => !!matchItems(desc, d.items || [])[0]);
          if (!lines.length || gates.some((g: any) => g.s === "bad")) continue;
          await quoteFromQuery(q, d, insert, update, hint);
        }
      } finally { busy.current = false; }
    })();
  }, [role, unread, ready]);
}
