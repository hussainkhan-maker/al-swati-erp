// Quotations. Super-Admin builds and prices them; Abu's quotations appear live in his account; approval opens the project.
import React, { useState } from "react";
import { View } from "react-native";
import { useData } from "../lib/data";
import { ageDays, day, matchItems, money, num, r2, SAR, stamp } from "../lib/fmt";
import { PRICE_STALE_DAYS } from "../config";
import { ai, supabase } from "../lib/supabase";
import { docHTML, makeAndShare, pdfChecks, quotationDoc } from "../lib/pdf";
import { Btn, Card, Checks, Empty, Field, H1, Icon, Pill, Row, Screen, Select, Sheet, T, useColors } from "../ui";
import { RequestPrices } from "./Suppliers";

const AR: Record<string, string> = { Draft: "مسودة", "Abu Review": "مراجعة أبو", "Sent to Client": "أُرسل للعميل", Approved: "معتمد", Lost: "خسرنا" };
export const pref = (d: any, key: string, dflt: any) => ({ ...dflt, ...((d.preferences || []).find((p: any) => p.key === key)?.value || {}) });
export const quoteTotal = (q: any) => r2((q.lines || []).reduce((s: number, l: any) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0));

export function priceHint(d: any, desc: string) {
  const m = matchItems(desc, d.items || [])[0];
  if (!m) return null;
  const ps = (d.prices || []).filter((p: any) => p.item_id === m.item.id);
  const of = (k: string) => ps.find((p: any) => p.kind === k);
  return { item: m.item, score: m.score, cost: of("cost"), sell: of("sell"), est: of("estimate") };
}

export default function Quotes() {
  const { d, role, update, insert, lang, t, profile } = useData(); const c = useColors();
  const margin = pref(d, "margin", { target: 20, minimum: 12, round_to: 5 }), terms = pref(d, "quote_terms", { validity_days: 15 });
  const [adv, setAdv] = useState<Record<string, any>>({}), [advBusy, setAdvBusy] = useState(""), [pdfQ, setPdfQ] = useState<any>(null);
  const isAdmin = role === "admin", isAbu = role === "abu", arUI = isAbu && lang === "ar";
  const [rates, setRates] = useState<Record<string, string>>({});
  const [nq, setNq] = useState<any>(null), [lost, setLost] = useState<any>(null), [ask, setAsk] = useState<any>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const list = (d.quotes || []).filter((q: any) => !isAbu || q.owner === "abu");

  const hist = (q: any, text: string) => [...(q.history || []), `${stamp(Date.now())} ${text}`];
  const setStatus = async (q: any, s: string, extra: any = {}) => update("quotes", q.id, { status: s, history: hist(q, `status → ${s} (${role})`), ...extra });

  const saveRates = async (q: any) => {
    const changes: string[] = [], warn: string[] = [];
    const lines = q.lines.map((l: any, i: number) => {
      const raw = rates[q.id + ":" + i]; if (raw === undefined) return l;
      const v = raw === "" ? null : num(raw);
      if ((v ?? null) !== (l.rate ?? null)) changes.push(`${l.desc}: ${l.rate ?? "—"} → ${v ?? "—"}`);
      const h = priceHint(d, l.desc);
      if (v && h?.cost && v < Number(h.cost.price)) warn.push(`${l.desc}: rate ${v} is below cost ${h.cost.price}`);
      if (v && h?.cost && v >= Number(h.cost.price) && v < Number(h.cost.price) * (1 + margin.minimum / 100)) warn.push(`${l.desc}: margin under your minimum ${margin.minimum}%`);
      if (v && h?.cost && v > Number(h.cost.price) * 10) warn.push(`${l.desc}: 10× the cost — check for an extra zero`);
      return { ...l, rate: Number.isFinite(v as number) ? v : null };
    });
    if (!changes.length) return;
    await update("quotes", q.id, { lines, history: [...(q.history || []), ...changes.map((x) => `${stamp(Date.now())} ${x} (Super-Admin)`)] });
    for (const l of lines) { const h = priceHint(d, l.desc); if (l.rate > 0 && h && h.score >= 0.75) await insert("prices", { item_id: h.item.id, price: l.rate, kind: "sell", source: "quote", quote_id: q.id }); }
    setRates({}); setMsg({ ...msg, [q.id]: warn.length ? "Saved. Check: " + warn.join(" · ") : "Saved and synced to Abu." });
  };
  const advise = async (q: any) => {
    setAdvBusy(q.id);
    try {
      const lines = q.lines.map((l: any, i: number) => { const h = priceHint(d, l.desc); return { i, desc: l.desc, qty: l.qty, unit: l.unit, rate: l.rate, cost: h?.cost?.price ?? null, last_quoted: h?.sell?.price ?? null, ai_estimate: h?.est?.price ?? null }; });
      const r = await ai("advise", { quote: { title: q.title, client: q.client, lines } });
      setAdv({ ...adv, [q.id]: r });
    } catch (e: any) { setMsg({ ...msg, [q.id]: e.message }); } finally { setAdvBusy(""); }
  };
  const useAdvice = (q: any, all: boolean, i?: number) => {
    const next = { ...rates };
    for (const a of adv[q.id]?.lines || []) if (a.rate > 0 && (all || a.i === i)) next[q.id + ":" + a.i] = String(a.rate);
    setRates(next);
  };
  const approve = async (q: any) => {
    const { data, error } = await supabase.from("projects").insert({ name: q.title, client: q.client, company: "", fee_pct: 0, quote_id: q.id, scope: q.lines }).select().single();
    if (error) { setMsg({ ...msg, [q.id]: error.message }); return; }
    await setStatus(q, "Approved", { project_id: data.id });
    setMsg({ ...msg, [q.id]: "Project opened. Set its company and service fee under More → Projects." });
  };

  return (
    <Screen>
      <Row><View style={{ flex: 1 }}><H1>{arUI ? "عروض الأسعار" : "Quotations"}</H1></View>{isAdmin && <Btn kind="primary" icon={<Icon name="plus" color="#fff" />} title="New" onPress={() => setNq({ title: "", client: "", owner: "admin", lines: [{ desc: "", qty: "", unit: "sqm" }] })} />}</Row>
      {arUI && <T muted>أي تعديل من المدير يظهر هنا فوراً.</T>}
      {list.length ? list.map((q: any) => {
        const editable = isAdmin && ["Draft", "Abu Review"].includes(q.status);
        const blank = (q.lines || []).filter((l: any) => !(Number(l.rate) > 0)).length;
        return (
          <Card key={q.id}>
            <Row><View style={{ flex: 1 }}><T bold size={17}>{q.title}</T><T muted size={13}>{q.client || ""} · {q.owner === "abu" ? (arUI ? "لأبو" : "For Abu") : "Own"} · {day(q.updated_at)}</T></View>
              <Pill kind={q.status === "Approved" ? "good" : q.status === "Lost" ? "bad" : "acc"} text={arUI ? AR[q.status] : q.status} /></Row>
            {(q.lines || []).map((l: any, i: number) => {
              const h = isAdmin ? priceHint(d, l.desc) : null;
              return (
                <View key={i} style={{ gap: 4, borderTopWidth: 1, borderColor: c.line, paddingTop: 8 }}>
                  <T>{l.desc}</T>
                  <Row>
                    <T muted style={{ flex: 1 }}>{money(l.qty)} {l.unit}</T>
                    {editable ? <Field value={rates[q.id + ":" + i] ?? (l.rate ?? "")} numeric placeholder={arUI ? "السعر" : "Rate"} onChange={(v) => setRates({ ...rates, [q.id + ":" + i]: v })} style={{ maxWidth: 120 }} />
                      : <T bold>{Number(l.rate) > 0 ? money(l.rate) : "—"}</T>}
                    <T bold style={{ minWidth: 90 }}>{money((Number(l.qty) || 0) * (Number(l.rate) || 0))}</T>
                  </Row>
                  {h && <Row wrap>
                    <T size={12} muted>{h.item.name}</T>
                    {h.cost && <Pill kind={ageDays(h.cost.created_at) > PRICE_STALE_DAYS ? "warn" : "good"} text={`cost ${money(h.cost.price)} · ${ageDays(h.cost.created_at)}d`} />}
                    {h.sell && <Pill kind="acc" text={`last quoted ${money(h.sell.price)}`} />}
                    {!h.cost && h.est && <Pill kind="warn" text={`AI estimate ${money(h.est.price)} · verify`} />}
                  </Row>}
                  {isAdmin && !h && <T size={12} muted>No price on file. Ask suppliers below.</T>}
                  {(() => { const a = (adv[q.id]?.lines || []).find((x: any) => x.i === i); return a ? <Row wrap><Pill kind="acc" text={a.rate > 0 ? `AI: ${money(a.rate)}` : "AI: ask suppliers"} /><T size={12} muted style={{ flex: 1 }}>{a.reason}</T>{editable && a.rate > 0 && <Btn kind="ghost" title="Use" onPress={() => useAdvice(q, false, i)} />}</Row> : null; })()}
                </View>);
            })}
            <Row wrap><T bold>{arUI ? "الإجمالي" : "Total"}: {SAR(quoteTotal(q))}</T><T muted size={13}>+ VAT 15% = {SAR(r2(quoteTotal(q) * 1.15))}</T>{blank > 0 && <Pill kind="warn" text={`${blank} ${arUI ? "بدون سعر" : "without rate"}`} />}</Row>
            {adv[q.id]?.summary ? <Card style={{ backgroundColor: c.sunk }}><Row><Icon name="spark" color={c.accent} /><T bold>Advisor</T></Row><T>{adv[q.id].summary}</T>{editable && <Btn title="Use all suggested rates" onPress={() => useAdvice(q, true)} />}<T size={12} muted>Nothing changes until you press Save rates.</T></Card> : null}
            {msg[q.id] ? <T color={c.accent}>{msg[q.id]}</T> : null}
            {isAdmin && <Row wrap>
              {editable && <Btn kind="primary" title="Save rates" onPress={() => saveRates(q)} />}
              {editable && <Btn icon={<Icon name="spark" />} title="AI advice" busy={advBusy === q.id} onPress={() => advise(q)} />}
              <Btn icon={<Icon name="share" />} title="Quotation PDF" disabled={blank > 0} onPress={() => setPdfQ(q)} />
              {editable && <Btn icon={<Icon name="truck" />} title="Ask suppliers" onPress={() => setAsk({ quote_id: q.id, items: q.lines.map((l: any) => ({ desc: l.desc, qty: l.qty, unit: l.unit })) })} />}
              {q.status === "Draft" && q.owner === "abu" && <Btn title="Send to Abu" onPress={() => setStatus(q, "Abu Review")} />}
              {editable && <Btn title="Mark sent" disabled={blank > 0} onPress={() => setStatus(q, "Sent to Client")} />}
              {q.status === "Sent to Client" && <Btn kind="primary" title="Approved → open project" onPress={() => approve(q)} />}
              {q.status === "Sent to Client" && <Btn kind="danger" title="Lost" onPress={() => setLost({ q, why: "" })} />}
            </Row>}
            {isAbu && q.status === "Abu Review" && <Btn big kind="primary" title={lang === "ur" ? "ٹھیک ہے، ایڈمن کو واپس بھیجیں" : lang === "en" ? "Approve and send back" : "موافق، أعده للمدير"} onPress={() => setStatus(q, "Draft")} />}
            {q.lost_reason ? <T muted size={13}>Lost: {q.lost_reason}</T> : null}
            {(q.history || []).slice(-4).reverse().map((h: string, i: number) => <T key={i} size={12} muted>{h}</T>)}
          </Card>);
      }) : <Empty text={arUI ? "لا توجد عروض بعد." : "No quotations yet. Make one here or from a client query."} />}

      <Sheet open={!!nq} onClose={() => setNq(null)} title="New quotation">
        {nq && <>
          <Field label="Title" value={nq.title} onChange={(v) => setNq({ ...nq, title: v })} />
          <Field label="Client" value={nq.client} onChange={(v) => setNq({ ...nq, client: v })} />
          <Select label="For" value={nq.owner} onChange={(v) => setNq({ ...nq, owner: v })} options={[{ value: "admin", label: "My own" }, { value: "abu", label: "Abu (appears in his account)" }]} />
          {nq.lines.map((l: any, i: number) => <Row key={i} wrap>
            <Field label="Item" value={l.desc} onChange={(v) => setNq({ ...nq, lines: nq.lines.map((x: any, j: number) => (j === i ? { ...x, desc: v } : x)) })} />
            <Field label="Qty" value={l.qty} numeric onChange={(v) => setNq({ ...nq, lines: nq.lines.map((x: any, j: number) => (j === i ? { ...x, qty: v } : x)) })} style={{ maxWidth: 100 }} />
            <Field label="Unit" value={l.unit} onChange={(v) => setNq({ ...nq, lines: nq.lines.map((x: any, j: number) => (j === i ? { ...x, unit: v } : x)) })} style={{ maxWidth: 90 }} />
          </Row>)}
          <Btn kind="ghost" icon={<Icon name="plus" />} title="Line" onPress={() => setNq({ ...nq, lines: [...nq.lines, { desc: "", qty: "", unit: "sqm" }] })} />
          <T size={13} muted>Rates stay blank. You fill them on the quotation, next to the price suggestions.</T>
          <Btn big kind="primary" title="Create" disabled={!nq.title || !nq.lines.some((l: any) => l.desc)} onPress={async () => {
            await insert("quotes", { title: nq.title, client: nq.client, owner: nq.owner, lines: nq.lines.filter((l: any) => l.desc).map((l: any) => ({ desc: l.desc, qty: num(l.qty) || 0, unit: l.unit, rate: null })), history: [`${stamp(Date.now())} created by Super-Admin`] });
            setNq(null);
          }} />
        </>}
      </Sheet>
      <Sheet open={!!lost} onClose={() => setLost(null)} title="Why was it lost?">
        {lost && <><Field label="Reason (rate too high, time too short, client chose another…)" value={lost.why} onChange={(v) => setLost({ ...lost, why: v })} />
          <Btn big kind="primary" title="Save" onPress={async () => { await setStatus(lost.q, "Lost", { lost_reason: lost.why }); setLost(null); }} /></>}
      </Sheet>
      {ask && <RequestPrices init={ask} onClose={() => setAsk(null)} />}
      {pdfQ && (() => {
        const L = (lang === "ur" ? "en" : lang) as any, doc = quotationDoc(pdfQ, L, terms), html = docHTML(doc, L, profile.name), ch = pdfChecks(t, doc, html);
        const tooLow = (pdfQ.lines || []).filter((l: any) => { const h = priceHint(d, l.desc); return h?.cost && Number(l.rate) < Number(h.cost.price); });
        const all = [...ch, { s: tooLow.length ? "bad" : "good", text: tooLow.length ? `${tooLow.length} lines below cost` : "No line below cost" } as any];
        return (
          <Sheet open onClose={() => setPdfQ(null)} title="Quotation PDF">
            <T>{doc.title}</T>
            <T bold>{SAR(quoteTotal(pdfQ))} + VAT = {SAR(r2(quoteTotal(pdfQ) * 1.15))}</T>
            <Checks list={all} />
            <Btn big kind="primary" icon={<Icon name="share" color={c.accentInk} />} title="Make PDF and send (WhatsApp / email)" disabled={all.some((x) => x.s === "bad")} onPress={async () => {
              await makeAndShare(doc, html);
              if (["Draft", "Abu Review"].includes(pdfQ.status) && isAdmin) await setStatus(pdfQ, "Sent to Client");
              setPdfQ(null);
            }} />
            <T size={12} muted>The phone's share sheet opens: choose WhatsApp 1, WhatsApp 2 or email. After sending, the quotation is marked "Sent to Client".</T>
          </Sheet>);
      })()}
    </Screen>
  );
}

export function QuoteChecks({ q }: { q: any }) {
  const blank = (q.lines || []).filter((l: any) => !(Number(l.rate) > 0)).length;
  return <Checks list={[{ s: blank ? "warn" : "good", text: blank ? `${blank} lines without a rate` : "Every line has a rate" }]} />;
}
