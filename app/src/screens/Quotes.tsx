// Quotations. Super-Admin builds and prices them; Abu's quotations appear live in his account; approval opens the project.
import React, { useState } from "react";
import { View } from "react-native";
import { useData } from "../lib/data";
import { ageDays, day, matchItems, money, num, r2, SAR, stamp } from "../lib/fmt";
import { PRICE_STALE_DAYS } from "../config";
import { ai, supabase } from "../lib/supabase";
import { docHTML, makeAndShare, pdfChecks, quotationDoc } from "../lib/pdf";
import { Btn, Card, Checks, Empty, Field, H1, Icon, Pill, Row, Screen, Select, Sheet, T, Table, useColors } from "../ui";
import { lineCalc, QUOTE_DEFAULTS, quoteGuards, quoteTotals } from "../lib/checks";
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

// Quotation lines as they are stored: numbers as numbers, empty boxes as null.
const cleanLines = (ls: any[]) => (ls || []).map((l: any) => ({ ...l, qty: num(l.qty) || 0, waste: l.waste === "" || l.waste == null ? null : num(l.waste), cost: l.cost === "" || l.cost == null ? null : num(l.cost), install: l.install === "" || l.install == null ? null : num(l.install), rate: l.rate === "" || l.rate == null ? null : num(l.rate) }));

const sig = (ls: any[]) => JSON.stringify(cleanLines(ls).map((l: any) => [l.desc, l.unit, l.qty, l.waste, l.cost, l.install, l.rate]));

export default function Quotes() {
  const { d, role, update, insert, lang, t, profile } = useData(); const c = useColors();
  const margin = pref(d, "margin", { target: 20, minimum: 12, round_to: 5 }), terms = pref(d, "quote_terms", { validity_days: 15 });
  const [adv, setAdv] = useState<Record<string, any>>({}), [advBusy, setAdvBusy] = useState(""), [pdfQ, setPdfQ] = useState<any>(null);
  const isAdmin = role === "admin", isAbu = role === "abu", arUI = isAbu && lang === "ar";
  const [rates, setRates] = useState<Record<string, string>>({});
  const [nq, setNq] = useState<any>(null), [lost, setLost] = useState<any>(null), [ask, setAsk] = useState<any>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [eb, setEb] = useState<Record<string, any[]>>({}); // lines being edited, per quotation
  const [tried, setTried] = useState<Record<string, boolean>>({}), [lk, setLk] = useState<any>(null), [unl, setUnl] = useState<any>(null);
  const minMargin = Number(margin.minimum_safe ?? Math.max(QUOTE_DEFAULTS.minMargin, Number(margin.minimum) || 0));
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
  const saveLines = async (q: any) => {
    const lines = cleanLines(eb[q.id] || []);
    await update("quotes", q.id, { lines, history: hist(q, "lines edited (Super-Admin)") });
    for (const l of lines) { const h = priceHint(d, l.desc); if (l.rate > 0 && h && h.score >= 0.75) await insert("prices", { item_id: h.item.id, price: l.rate, kind: "sell", source: "quote", quote_id: q.id }); }
    setEb((prev) => { const next = { ...prev }; delete next[q.id]; return next; }); setMsg((m) => ({ ...m, [q.id]: "Saved." }));
  };
  // Second AI: an independent senior estimator checks the lines against what was read from the BOQ / drawings.
  const audit = async (q: any) => {
    setAdvBusy("audit" + q.id);
    try {
      const lines = (q.lines || []).map((l: any, i: number) => ({ i, desc: l.desc, qty: l.qty, unit: l.unit, waste: lineCalc(l).waste }));
      const inq = (d.inquiries || []).find((x: any) => x.id === q.rfq?.inquiry_id); // what the AI read from the client's BOQ / drawings
      const r = await ai("audit_takeoff", { lines, source: inq?.reading?.a || {} });
      await update("quotes", q.id, { rfq: { ...(q.rfq || {}), audit: { ...r, at: new Date().toISOString(), ack: [] } }, history: hist(q, "second AI check done") });
    } catch (e: any) { setMsg({ ...msg, [q.id]: e.message }); } finally { setAdvBusy(""); }
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
        const locked = !!q.rfq?.lock;
        const editable = isAdmin && ["Draft", "Abu Review"].includes(q.status) && !locked;
        const lines = eb[q.id] || q.lines || [];
        const tot = quoteTotals(lines), guards = quoteGuards({ ...q, lines }, minMargin);
        const setL = (i: number, k: string, v: any) => setEb((prev) => ({ ...prev, [q.id]: (prev[q.id] || q.lines || []).map((l: any, j: number) => (j === i ? { ...l, [k]: v } : l)) }));
        const dirty = !!eb[q.id] && sig(eb[q.id]) !== sig(q.lines || []); // unsaved changes only if something really differs
        const au = q.rfq?.audit;
        return (
          <Card key={q.id}>
            <Row><View style={{ flex: 1 }}><T bold size={17}>{q.title}</T><T muted size={13}>{q.client || ""} · {q.owner === "abu" ? (arUI ? "لأبو" : "For Abu") : "Own"} · {day(q.updated_at)}</T></View>
              {locked && <Pill kind="good" text="🔒 Approved & locked" />}
              <Pill kind={q.status === "Approved" ? "good" : q.status === "Lost" ? "bad" : "acc"} text={arUI ? AR[q.status] : q.status} /></Row>
            {isAdmin && !locked && q.status === "Draft" && <T size={13} muted>Step 1: quantities and costs · Step 2: second AI check · Step 3: Approve & Lock · then PDF to client.</T>}
            {lines.map((l: any, i: number) => {
              const h = isAdmin ? priceHint(d, l.desc) : null, x = lineCalc(l), a = (au?.lines || []).find((z: any) => z.i === i);
              return (
                <View key={i} style={{ gap: 6, borderTopWidth: 1, borderColor: c.line, paddingTop: 10 }}>
                  <T bold>{i + 1}. {l.desc}</T>
                  {editable ? <Row wrap>
                    <Field label="Qty (net, billed)" value={l.qty} numeric onChange={(v) => setL(i, "qty", v)} style={{ maxWidth: 130 }} />
                    <Field label="Unit" value={l.unit} onChange={(v) => setL(i, "unit", v)} style={{ maxWidth: 80 }} />
                    <Field label="Waste %" value={l.waste ?? ""} numeric placeholder={String(QUOTE_DEFAULTS.waste)} onChange={(v) => setL(i, "waste", v)} style={{ maxWidth: 100 }} />
                    <Field label="Material cost / unit" value={l.cost ?? ""} numeric onChange={(v) => setL(i, "cost", v)} style={{ maxWidth: 150 }} />
                    <Field label="Install / unit" value={l.install ?? ""} numeric onChange={(v) => setL(i, "install", v)} style={{ maxWidth: 130 }} />
                    <Field required label="Selling rate" value={l.rate ?? ""} numeric onChange={(v) => setL(i, "rate", v)} style={{ maxWidth: 130 }} />
                  </Row> : <T muted>{money(x.net)} {l.unit} × {Number(l.rate) > 0 ? money(l.rate) : "—"} = <T bold>{money(x.sell)}</T></T>}
                  {isAdmin && <Row wrap>
                    <Pill kind="acc" text={`Buy ${money(x.buy)} ${l.unit || ""} (incl. ${x.waste}% waste)`} />
                    <Pill kind="acc" text={`Real cost ${money(x.unitCost)} / ${l.unit || "unit"}`} />
                    {x.margin != null && <Pill kind={x.margin < minMargin ? "bad" : "good"} text={`Margin ${x.margin}%`} />}
                    {h?.cost && <Pill kind={ageDays(h.cost.created_at) > PRICE_STALE_DAYS ? "warn" : "good"} text={`lowest cost on file ${money(h.cost.price)} · ${ageDays(h.cost.created_at)}d`} />}
                    {h?.cost && editable && Number(l.cost) !== Number(h.cost.price) && <Btn kind="ghost" title="Use this cost" onPress={() => setL(i, "cost", h.cost.price)} />}
                    {h?.sell && <Pill kind="acc" text={`last quoted ${money(h.sell.price)}`} />}
                    {!h?.cost && h?.est && <Pill kind="warn" text={`AI estimate ${money(h.est.price)} · verify`} />}
                  </Row>}
                  {a && a.level !== "ok" && <Row wrap>
                    <Pill kind={a.level === "high" ? "bad" : "warn"} text={`AI auditor: ${a.issue}${a.suggest_qty ? ` (suggests ${a.suggest_qty})` : ""}`} />
                    {a.level === "high" && editable && <Btn kind="ghost" title={(au.ack || []).includes(i) ? "✓ checked by me" : "I checked it"} onPress={() => update("quotes", q.id, { rfq: { ...q.rfq, audit: { ...au, ack: (au.ack || []).includes(i) ? au.ack.filter((z: number) => z !== i) : [...(au.ack || []), i] } } })} />}
                  </Row>}
                  {(() => { const ad = (adv[q.id]?.lines || []).find((z: any) => z.i === i); return ad ? <Row wrap><Pill kind="acc" text={ad.rate > 0 ? `Advisor: ${money(ad.rate)}` : "Advisor: ask suppliers"} /><T size={12} muted style={{ flex: 1 }}>{ad.reason}</T>{editable && ad.rate > 0 && <Btn kind="ghost" title="Use" onPress={() => setL(i, "rate", ad.rate)} />}</Row> : null; })()}
                </View>);
            })}
            <View style={{ backgroundColor: c.accentSoft, borderRadius: 14, padding: 12, gap: 4 }}>
              <Row><T style={{ flex: 1 }}>Total to client (before VAT)</T><T bold>{SAR(tot.sell)}</T></Row>
              <Row><T style={{ flex: 1 }}>VAT 15%</T><T>{SAR(tot.vat)}</T></Row>
              {isAdmin && <><Row><T style={{ flex: 1 }}>Our real cost (material + waste + installation)</T><T>{SAR(tot.cost)}</T></Row>
                <Row><T bold style={{ flex: 1 }}>Profit · margin</T><T bold color={tot.margin < minMargin ? c.bad : c.good}>{SAR(tot.profit)} · {tot.margin}%</T></Row></>}
            </View>
            {au && <Card style={{ backgroundColor: c.sunk }}>
              <Row><Icon name="spark" color={c.accent} /><T bold>Second AI check</T><T muted size={12}>{stamp(au.at)}</T></Row>
              <T>{au.summary}</T>
              {(au.missing || []).length > 0 && <T size={14}>Maybe missing: {au.missing.join(", ")}</T>}
              {(au.rfis || []).length > 0 && <T size={14}>Ask the consultant (RFI): {au.rfis.join(" · ")}</T>}
            </Card>}
            {adv[q.id]?.summary ? <Card style={{ backgroundColor: c.sunk }}><Row><Icon name="spark" color={c.accent} /><T bold>Price advisor</T></Row><T>{adv[q.id].summary}</T>{editable && <Btn title="Use all suggested rates" onPress={() => setEb({ ...eb, [q.id]: lines.map((l: any, j: number) => { const ad = (adv[q.id]?.lines || []).find((z: any) => z.i === j); return ad?.rate > 0 ? { ...l, rate: ad.rate } : l; }) })} />}</Card> : null}
            {isAdmin && !locked && (tried[q.id] ? <Checks list={guards} /> : null)}
            {msg[q.id] ? <T color={c.accent}>{msg[q.id]}</T> : null}
            {isAdmin && <Row wrap>
              {editable && dirty && <Btn kind="primary" title="Save" onPress={() => saveLines(q)} />}
              {editable && <Btn icon={<Icon name="spark" />} title="Second AI check" busy={advBusy === "audit" + q.id} onPress={() => audit(q)} />}
              {editable && <Btn icon={<Icon name="spark" />} title="Price advice" busy={advBusy === q.id} onPress={() => advise(q)} />}
              {editable && <Btn icon={<Icon name="truck" />} title="Ask suppliers" onPress={() => setAsk({ quote_id: q.id, items: lines.map((l: any) => ({ desc: l.desc, qty: lineCalc(l).buy, unit: l.unit })) })} />}
              {editable && <Btn kind="primary" icon={<Icon name="check" color={c.accentInk} />} title="Approve & Lock" onPress={() => { setTried({ ...tried, [q.id]: true }); if (!dirty && !guards.some((g) => g.s === "bad")) setLk({ q, ...terms, guarantee: terms.guarantee || "" }); else if (dirty) setMsg({ ...msg, [q.id]: "Press Save first." }); }} />}
              {locked && ["Draft", "Abu Review"].includes(q.status) && <Btn kind="ghost" title="Unlock to change" onPress={() => setUnl({ q, why: "" })} />}
              {q.status === "Draft" && q.owner === "abu" && <Btn title="Send to Abu" onPress={() => setStatus(q, "Abu Review")} />}
              <Btn icon={<Icon name="share" />} title="Quotation PDF" disabled={!locked} onPress={() => setPdfQ(q)} />
              {q.status === "Sent to Client" && <Btn kind="primary" title="Client approved → open project" onPress={() => approve(q)} />}
              {q.status === "Sent to Client" && <Btn kind="danger" title="Lost" onPress={() => setLost({ q, why: "" })} />}
            </Row>}
            {isAdmin && !locked && <T size={12} muted>The PDF opens only after Approve & Lock. Rules: every line has quantity, cost and rate; margin at least {minMargin}%; AI warnings checked.</T>}
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
      <Sheet open={!!lk} onClose={() => setLk(null)} title="Approve & Lock">
        {lk && (() => { const tt = quoteTotals(lk.q.lines); return <>
          <T bold size={17}>{lk.q.title}</T>
          <Table cols={["", "SAR"]} numeric={[1]} rows={[["Total to client (before VAT)", money(tt.sell)], ["VAT 15%", money(tt.vat)], ["Total with VAT", money(r2(tt.sell + tt.vat))], ["Our real cost", money(tt.cost)], [`Profit (${tt.margin}%)`, money(tt.profit)]]} />
          <Field required label="Payment terms" value={lk.payment} onChange={(v) => setLk({ ...lk, payment: v })} placeholder="e.g. 30% advance, 60% against progress, 10% on handover" />
          <Field label="Guarantee / warranty" value={lk.guarantee} onChange={(v) => setLk({ ...lk, guarantee: v })} placeholder="e.g. 1 year on installation workmanship" />
          <Row wrap><Field label="Valid for (days)" value={lk.validity_days} numeric onChange={(v) => setLk({ ...lk, validity_days: v })} style={{ maxWidth: 160 }} /><Field label="Notes" value={lk.notes} onChange={(v) => setLk({ ...lk, notes: v })} /></Row>
          <T size={13} muted>After locking, prices cannot change unless you unlock (the reason is kept in the history). Then the PDF can be made and sent.</T>
          <Btn big kind="primary" icon={<Icon name="check" color={c.accentInk} />} title="Approve & Lock" disabled={!String(lk.payment || "").trim()} onPress={async () => {
            if (!String(lk.payment || "").trim()) return; // payment terms are required before locking
            const lock = { at: new Date().toISOString(), by: profile.name, total: tt.sell, cost: tt.cost, margin: tt.margin, terms: { payment: lk.payment, guarantee: lk.guarantee, validity_days: num(lk.validity_days) || 15, notes: lk.notes || "" } };
            await update("quotes", lk.q.id, { rfq: { ...(lk.q.rfq || {}), lock }, history: hist(lk.q, `approved & locked: ${money(tt.sell)} SAR, margin ${tt.margin}%`) });
            setLk(null);
          }} />
        </>; })()}
      </Sheet>
      <Sheet open={!!unl} onClose={() => setUnl(null)} title="Unlock the quotation">
        {unl && <><Field required label="Why do you need to change it?" value={unl.why} onChange={(v) => setUnl({ ...unl, why: v })} />
          <Btn big kind="danger" title="Unlock" disabled={!unl.why.trim()} onPress={async () => { await update("quotes", unl.q.id, { rfq: { ...(unl.q.rfq || {}), lock: null }, history: hist(unl.q, `unlocked: ${unl.why}`) }); setUnl(null); }} /></>}
      </Sheet>
      <Sheet open={!!lost} onClose={() => setLost(null)} title="Why was it lost?">
        {lost && <><Field label="Reason (rate too high, time too short, client chose another…)" value={lost.why} onChange={(v) => setLost({ ...lost, why: v })} />
          <Btn big kind="primary" title="Save" onPress={async () => { await setStatus(lost.q, "Lost", { lost_reason: lost.why }); setLost(null); }} /></>}
      </Sheet>
      {ask && <RequestPrices init={ask} onClose={() => setAsk(null)} />}
      {pdfQ && (() => {
        const L = (lang === "ur" ? "en" : lang) as any, doc = quotationDoc(pdfQ, L, pdfQ.rfq?.lock?.terms || terms), html = docHTML(doc, L, profile.name), ch = pdfChecks(t, doc, html);
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
