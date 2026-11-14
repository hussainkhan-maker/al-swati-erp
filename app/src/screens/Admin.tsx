// Super-Admin screens: dashboard, money, projects & subcontractors, people, team on site, audit log.
import React, { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { useFlows } from "../components/Flows";
import { active, pname, useData } from "../lib/data";
import { day, money, num, SAR, stamp } from "../lib/fmt";
import { pricesFor } from "../lib/match";
import { invoicesOf, STATE_LABEL, waitText } from "../lib/invoices";
import { ai, supabase } from "../lib/supabase";
import { Bars, Btn, Card, Checks, CountUp, DEEP, ELEV, Empty, Marble, SectionHead, Segmented, StatStrip, Field, H1, H2, Icon, Kpi, MonthCal, Photo, Pill, Rise, Row, Screen, Select, Sheet, T, Table, Tile, useColors, useWide } from "../ui";

const sum = (a: any[], k: string) => a.reduce((s, x) => s + (Number(x[k]) || 0), 0);
const TYPE: Record<string, string> = { income: "Income", loan: "Loan", purchase: "Purchase", expense: "Expense", subpay: "Sub payment" };

const dkey = (x: any) => String(x.paid_on || x.work_date || x.created_at || "").slice(0, 10);
/** Retention and client rate per project (kept in preferences "project_terms"). */
export const termsOf = (d: any, pid: string) => (((d.preferences || []).find((p: any) => p.key === "project_terms")?.value || {})[pid] || {}) as { retention?: number; rate?: number };
const isRelease = (x: any) => /^retention release/i.test(String(x.description || ""));
/** What the client owes on one project. Payments arrive after VAT and after the client keeps the retention:
 *  received ex VAT = (100 − retention)% of the work it pays for. The service fee is charged on that received amount (done by the database). */
export function clientAccount(d: any, pid: string) {
  const t = termsOf(d, pid), r = Math.min(Math.max(Number(t.retention) || 0, 0), 50) / 100, rate = Number(t.rate) || 0;
  const inc = active(d.txns).filter((x: any) => x.type === "income" && x.project_id === pid);
  const base = (x: any) => Number(x.gross || 0) - Number(x.vat ?? Number(x.gross || 0) - Number(x.gross || 0) / 1.15);
  const normal = inc.filter((x: any) => !isRelease(x)).reduce((s2: number, x: any) => s2 + base(x), 0);
  const released = inc.filter(isRelease).reduce((s2: number, x: any) => s2 + base(x), 0);
  const m2 = (d.project_ledger || []).find((l: any) => l.project_id === pid)?.installed || 0;
  const covered = r < 1 ? normal / (1 - r) : normal;          // work value those payments paid for (incl. retention)
  const workValue = Number(m2) * rate;                          // m² done × client rate (before VAT)
  // Retention is only kept on work actually done: an advance payment for work not done yet is the client's credit, not a debt.
  const retHeld = Math.max(0, (rate ? Math.min(covered, workValue) : covered) * r - released);
  const unpaidWork = rate ? Math.max(0, workValue - covered) : 0;
  const credit = rate ? Math.max(0, covered - workValue) : 0;   // paid in advance
  return { r: r * 100, rate, m2: Number(m2), received: normal + released, covered, retHeld, workValue, unpaidWork, credit, owes: unpaidWork + retHeld };
}
const TYPE_ICON: Record<string, string> = { income: "cash", loan: "pct", purchase: "receipt", expense: "tag", subpay: "people", progress: "ruler" };

const isM2 = (u: any) => /^(sqm|m2|m²|م2|م²|متر مربع)$/i.test(String(u || "").trim());
/** Quoted vs done vs bought (m²) for one project, and "teach the AI" from what really happened. */
function VarianceCard({ x, done }: { x: any; done: number }) {
  const { d } = useData(); const c = useColors();
  const scope = (x.scope || (d.quotes || []).find((q: any) => q.id === x.quote_id)?.lines || []) as any[];
  const quoted = scope.filter((l) => isM2(l.unit)).reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const bought = active(d.txns || []).filter((t: any) => t.type === "purchase" && t.project_id === x.id)
    .reduce((s: number, t: any) => s + (t.lines || []).filter((l: any) => isM2(l.unit)).reduce((z: number, l: any) => z + (Number(l.qty) || 0), 0), 0);
  const [teach, setTeach] = useState<any>(null), [msg, setMsg] = useState("");
  if (!quoted && !bought) return null;
  const pct = quoted ? Math.round((done / quoted) * 1000) / 10 : null;
  const waste = done > 0 && bought > 0 ? Math.round(((bought - done) / done) * 1000) / 10 : null;
  const over = pct != null && pct > 103;
  return (
    <Card>
      <Row><H2>Quoted vs done</H2><View style={{ flex: 1 }} /><Btn kind="ghost" icon={<Icon name="spark" />} title="Teach the AI from this project" onPress={() => setTeach({ note: "" })} /></Row>
      <Row wrap>
        <Pill text={`Quoted ${money(quoted)} m²`} /><Pill kind={over ? "bad" : "acc"} text={`Done ${money(done)} m²${pct != null ? ` (${pct}%)` : ""}`} />
        {bought > 0 && <Pill text={`Stone bought ${money(bought)} m²`} />}
        {waste != null && <Pill kind={waste > 18 ? "bad" : waste > 15 ? "warn" : "good"} text={`Real waste ${waste}%`} />}
      </Row>
      {over && <T size={13} color={c.bad}>More m² done than quoted: is the extra a variation the client must pay for? Raise it before the next invoice.</T>}
      {msg ? <T size={13} color={c.accent}>{msg}</T> : null}
      <Sheet open={!!teach} onClose={() => setTeach(null)} title="Teach the AI from this project">
        {teach && <>
          <T size={14}>The AI will remember this for the next quotations: quoted {money(quoted)} m², done {money(done)} m²{bought ? `, bought ${money(bought)} m²` : ""}{waste != null ? `, real waste ${waste}%` : ""}.</T>
          <Field label="Why was it different? (drawings changed, AI read wrong, more cutting, breakage…)" value={teach.note} multiline onChange={(v) => setTeach({ ...teach, note: v })} />
          <Btn big kind="primary" title={teach.busy ? "Saving…" : "Save the lesson"} disabled={teach.busy} onPress={async () => {
            setTeach({ ...teach, busy: true });
            try {
              const r = await ai("learn", { text: `Project "${x.name}" (${(scope[0]?.desc || "stone work").slice(0, 80)}): quoted ${quoted} m2, actually done ${done} m2${bought ? `, stone bought ${bought} m2` : ""}${waste != null ? `, real cutting waste ${waste}%` : ""}. Owner's reason: ${teach.note || "not given"}. Use this when estimating similar work.` });
              setTeach(null); setMsg(`Saved: ${r.action_for_agents || r.observed_rule || "lesson stored"}`);
            } catch (e: any) { setTeach({ ...teach, busy: false }); setMsg(e.message); }
          }} />
        </>}
      </Sheet>
    </Card>
  );
}

export function Dashboard({ go }: { go?: (k: string) => void } = {}) {
  const { d, profile, reload } = useData(); const flows = useFlows(); const c = useColors(); const wide = useWide();
  const L = d.project_ledger || [], rep = (d.agent_reports || [])[0];
  // Morning briefing: made the first time Super-Admin opens the app each day (no schedule or secret key needed).
  const [brief, setBrief] = useState(""), riyadhDay = (t: any) => new Date(new Date(t).getTime() + 3 * 3600e3).toISOString().slice(0, 10);
  const makeBrief = async (force = false) => {
    setBrief("busy");
    try { const r = await ai("briefing", { force }); if (!r.skipped) await reload(["agent_reports"]); setBrief(r.skipped && force ? "Made less than 30 minutes ago." : ""); }
    catch (e: any) { setBrief(e.message); }
  };
  useEffect(() => { if (d.agent_reports && (!rep || riyadhDay(rep.created_at) !== riyadhDay(Date.now()))) makeBrief(); }, [!!d.agent_reports]);
  const vat = sum(d.vat_by_company || [], "vat");
  const newQ = (d.inquiries || []).filter((q: any) => q.status === "New").length;
  const [chart, setChart] = useState<"m2" | "in" | "out">("m2");
  const [kd, setKd] = useState<string | null>(null); // which money box is opened for details
  const tx = active(d.txns), pr = active(d.progress);
  // Last 7 days, oldest first.
  const days = Array.from({ length: 7 }, (_, i) => { const t = new Date(Date.now() - (6 - i) * 864e5); return t.toISOString().slice(0, 10); });
  const series = days.map((k) => ({
    label: new Date(k + "T12:00:00").toLocaleString("en", { weekday: "short" }),
    value: chart === "m2" ? sum(pr.filter((x: any) => dkey(x) === k), "qty")
      : chart === "in" ? sum(tx.filter((x: any) => x.type === "income" && dkey(x) === k), "gross")
      : tx.filter((x: any) => ["subpay", "expense", "purchase"].includes(x.type) && dkey(x) === k).reduce((t: number, x: any) => t + (Number(x.amount ?? x.total) || 0), 0),
  }));
  const marks: Record<string, number> = {};
  [...tx, ...pr].forEach((x: any) => { const k = dkey(x); marks[k] = (marks[k] || 0) + 1; });
  const recent = [...tx.map((x: any) => ({ ...x, kind: x.type })), ...pr.map((x: any) => ({ ...x, kind: "progress" }))]
    .sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8);
  const totalM2 = sum(pr, "qty");
  const hour = new Date().getHours(), greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Page header: date, title and the three things done most often. No banner: the numbers below are the point.
  const hero = (
    <View style={{ flexDirection: wide ? "row" : "column", flexWrap: "wrap", alignItems: wide ? "flex-end" : "flex-start", gap: 12, paddingBottom: 4 }}>
      <View style={{ flex: 1, minWidth: 240, gap: 2 }}>
        {!wide && <T size={13} muted>{new Date().toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</T>}
        <H1>{greet}, {profile.name}</H1>
        <T size={14} muted>{L.length} projects running, {money(totalM2)} m² installed so far.</T>
      </View>
      <Row wrap>
        <Btn kind="primary" icon={<Icon name="plus" size={16} color={c.accentInk} />} title="New entry" onPress={() => flows("speak")} />
        <Btn icon={<Icon name="receipt" size={16} />} title="Purchase invoice" onPress={() => flows("purchase")} />
        <Btn icon={<Icon name="doc" size={16} />} title="Statement" onPress={() => flows("statement")} />
      </Row>
    </View>
  );
  // Money at a glance: four main figures in one strip, three smaller ones under it. Each opens its breakdown.
  const main: [string, string, string][] = [["net", "Cash in hand from clients", SAR(sum(L, "net"))], ["owes", "Clients still owe (ex VAT)", SAR((d.projects || []).reduce((s2: number, p: any) => s2 + clientAccount(d, p.id).owes, 0))],
    ["cost", "Costs (ex VAT)", SAR(sum(L, "cost"))], ["profit", "Profit estimate", SAR(sum(L, "profit"))]];
  const minor: [string, string, string][] = [["sub_work", "Subcontract work", SAR(sum(L, "sub_work"))], ["loan_balance", "Company loans open", SAR(sum(L, "loan_balance"))], ["vat", "Purchase VAT to recover", SAR(vat)]];
  // The one dark element of the page: the money position on a verde-marble slab. Each figure opens its breakdown.
  const kpis = (
    <View style={[{ backgroundColor: DEEP.bg, borderRadius: 14, overflow: "hidden" }, ELEV]}>
      <Marble />
      <View style={{ flexDirection: wide ? "row" : "column", flexWrap: "wrap", paddingVertical: wide ? 22 : 8, paddingHorizontal: wide ? 8 : 0 }}>
        {main.map(([k, l, v], i) => (
          <Pressable key={k} onPress={() => setKd(k)} style={({ hovered }: any) => ({ flex: 1, minWidth: 190, paddingVertical: wide ? 4 : 14, paddingHorizontal: 20, gap: 6, borderColor: "rgba(255,255,255,0.12)", borderLeftWidth: wide && i ? 1 : 0, borderTopWidth: !wide && i ? 1 : 0, opacity: hovered ? 0.85 : 1, cursor: "pointer" } as any)}>
            <T size={13} color={DEEP.muted}>{l}</T>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 5 }}><CountUp value={Number(String(v).replace(/[^\d.-]/g, "")) || 0} size={wide ? 26 : 22} color={k === "profit" && sum(L, "profit") < 0 ? "#F2A497" : "#FFFFFF"} style={{ letterSpacing: -0.6 }} /><T size={13} color={DEEP.muted}>SAR</T></View>
          </Pressable>))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(0,0,0,0.14)", paddingHorizontal: wide ? 8 : 0 }}>
        {minor.map(([k, l, v]) => (
          <Pressable key={k} onPress={() => setKd(k)} style={({ hovered }: any) => ({ flexGrow: 1, flexDirection: "row", gap: 8, alignItems: "baseline", paddingVertical: 12, paddingHorizontal: 20, cursor: "pointer", opacity: hovered ? 0.75 : 1 } as any)}>
            <T size={13} color={DEEP.muted}>{l}</T><T size={14} bold color={DEEP.ink}>{v}</T>
          </Pressable>))}
      </View>
    </View>
  );
  const chartCard = (
    <Rise i={3}><Card style={{ gap: 14 }}>
      <SectionHead title="This week" sub={chart === "m2" ? "Square metres installed each day" : chart === "in" ? "Money received each day (SAR)" : "Money paid out each day (SAR)"}
        right={<Segmented value={chart} options={[["m2", "m²"], ["in", "In"], ["out", "Out"]]} onChange={(k) => setChart(k as any)} />} />
      <Bars data={series} unit={chart === "m2" ? "" : ""} />
    </Card></Rise>
  );
  const recentCard = (
    <Rise i={4}><Card style={{ gap: 4 }}>
      <SectionHead title="Recent activity" action={go ? "All entries" : undefined} onAction={() => go?.("money")} />
      {recent.length ? recent.map((x: any) => (
        <Row key={x.kind + x.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: c.line }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: x.kind === "income" ? c.goodSoft : c.sunk, alignItems: "center", justifyContent: "center" }}><Icon name={TYPE_ICON[x.kind] || "doc"} size={16} color={x.kind === "income" ? c.good : c.muted} /></View>
          <View style={{ flex: 1 }}>
            <T bold>{x.kind === "progress" ? `${x.sub_name} · ${money(x.qty)} ${x.unit || "m²"}` : `${TYPE[x.kind]}${x.sub_name ? " · " + x.sub_name : x.supplier ? " · " + x.supplier : ""}`}</T>
            <T muted size={13}>{pname(d, x.project_id)} · {dkey(x)}{x.method ? " · " + x.method : ""}</T>
          </View>
          {x.kind !== "progress" && <T bold color={x.kind === "income" ? c.good : c.ink}>{x.kind === "income" ? "+" : "−"}{money(x.gross ?? x.total ?? x.amount)}</T>}
        </Row>)) : <T muted>Nothing yet. Your entries will show here.</T>}
    </Card></Rise>
  );
  // Supplier price watch: an invoice line in the last 30 days that costs 5%+ more than the lowest earlier price for the same material.
  const rises = useMemo(() => {
    const out: string[] = [], since = Date.now() - 30 * 864e5;
    for (const t of active(d.txns || []).filter((t: any) => t.type === "purchase" && Date.parse(t.paid_on || t.created_at) > since).slice(0, 40)) {
      const when = String(t.paid_on || t.created_at).slice(0, 10);
      for (const l of (t.lines || []).slice(0, 15)) {
        if (!(Number(l.price) > 0) || !l.name) continue;
        const before = pricesFor(d, l.name).filter((b) => b.from === "invoice" && b.date < when);
        if (before.length && Number(l.price) > before[0].price * 1.05)
          out.push(`${l.name}: ${t.supplier || "?"} charged ${money(l.price)} on ${when}; lowest before ${money(before[0].price)} from ${before[0].supplier || "?"} (${before[0].date})`);
        if (out.length >= 5) return out;
      }
    }
    return out;
  }, [d.txns]);
  const waiting = invoicesOf(d).filter((v: any) => v.left > 0.5).sort((a: any, b: any) => b.age - a.age); // longest wait first
  const side = <>
    <Rise i={2}><Card><MonthCal marks={marks} /><T size={12} muted>A dot marks a day with a payment or work entry.</T></Card></Rise>
    <Rise i={3}><Card>
      <SectionHead title="Today's briefing" sub="From the main agent" />
      {rep ? <>
        <T size={15}>{rep.summary}</T>
        <Checks list={(rep.items || []).slice(0, 6).map((i: any) => ({ s: i.level === "bad" ? "bad" : "warn", text: i.text }))} />
        <T size={12} muted>{stamp(rep.created_at)}</T>
      </> : <T muted>{brief === "busy" ? "The main agent is checking everything…" : "No report yet."}</T>}
      <Row><Btn kind="ghost" icon={<Icon name="spark" size={16} color={c.accent} />} title={brief === "busy" ? "Checking…" : "Check again"} busy={brief === "busy"} onPress={() => makeBrief(true)} />{brief && brief !== "busy" ? <T size={12} muted style={{ flex: 1 }}>{brief}</T> : null}</Row>
      {newQ > 0 && <Pill kind="warn" text={`${newQ} new client queries`} />}
      {rises.map((r, i) => <T key={i} size={13} color={c.bad}>▲ {r}</T>)}
      {(() => { const wait = (d.quotes || []).filter((q: any) => q.status === "Draft" && !q.rfq?.lock && (q.lines || []).length && (q.lines || []).every((l: any) => Number(l.rate) > 0)); return wait.length ? <Pill kind="bad" text={`${wait.length} quotation(s) waiting for your Approve & Lock`} /> : null; })()}
    </Card></Rise>
    {waiting.length ? <Rise i={4}><Card style={{ gap: 6 }}>
      <SectionHead title="Waiting for payment" sub={`${money(waiting.reduce((s2: number, v: any) => s2 + v.left, 0))} SAR on ${waiting.length} invoice${waiting.length === 1 ? "" : "s"}, longest wait first`} />
      {waiting.slice(0, 6).map((v: any) => (
        <Row key={v.id} style={{ paddingVertical: 6, borderTopWidth: 1, borderColor: c.line }}>
          <View style={{ flex: 1 }}><T bold size={14}>{pname(d, v.project_id)}, invoice {v.invoice_no}</T>
            <T size={12} color={v.state === "late" || v.state === "missed" ? c.bad : v.state === "slow" ? c.warn : c.muted}>{waitText(v)}{v.paid > 0 ? `, ${money(v.paid)} received` : ""}</T></View>
          <T bold color={v.state === "late" || v.state === "missed" ? c.bad : c.warn}>{money(v.left)}</T>
        </Row>))}
    </Card></Rise> : null}
  </>;
  const table = <Rise i={5} style={{ gap: 10 }}>
    <SectionHead title="Projects" action={go ? "Open projects" : undefined} onAction={() => go?.("projects")} />
    <Table cols={["Project", "Company", "Fee %", "m² done", "In hand", "Costs", "Sub work", "Loan open", "Profit est."]} numeric={[2, 3, 4, 5, 6, 7, 8]}
      rows={L.map((l: any) => [l.name, l.company || "—", String(l.fee_pct), money(l.installed), money(l.net), money(l.cost), money(l.sub_work), money(l.loan_balance), money(l.profit)])} />
    <T size={12} muted>Profit estimate = cash in hand + loans already deducted − costs (ex VAT) − subcontract work done (meters × rate). Calculated by the database.</T>
  </Rise>;
  // Details behind each money box (opens on click).
  const KD: Record<string, [string, () => React.ReactNode]> = {
    net: ["Cash in hand, by project", () => <Table cols={["Project", "Received (gross)", "VAT", "Fee", "Loan cut", "In hand"]} numeric={[1, 2, 3, 4, 5]} rows={L.map((l: any) => [l.name, money(l.gross), money(l.vat), money(l.fee), money(l.loan_deducted), money(l.net)])} />],
    owes: ["What each client still owes (before VAT)", () => <Table cols={["Project", "m² done", "Work value", "Received", "Retention kept", "Still owes"]} numeric={[1, 2, 3, 4, 5]} rows={(d.projects || []).map((p: any) => { const a = clientAccount(d, p.id); return [p.name, money(a.m2), a.rate ? money(a.workValue) : "rate not set", money(a.received), money(a.retHeld), money(a.owes)]; })} />],
    cost: ["Costs by project (ex VAT)", () => <Table cols={["Project", "Costs"]} numeric={[1]} rows={L.map((l: any) => [l.name, money(l.cost)])} />],
    sub_work: ["Subcontractors: work, paid, balance", () => <Table cols={["Subcontractor", "m²", "Earned", "Paid", "Balance"]} numeric={[1, 2, 3, 4]} rows={(d.sub_ledger || []).map((x: any) => [x.name, money(x.qty), money(x.earned), money(x.paid), money(Number(x.earned) - Number(x.paid))])} />],
    profit: ["Profit estimate by project", () => <Table cols={["Project", "In hand", "Costs", "Sub work", "Profit est."]} numeric={[1, 2, 3, 4]} rows={L.map((l: any) => [l.name, money(l.net), money(l.cost), money(l.sub_work), money(l.profit)])} />],
    loan_balance: ["Company loans still open", () => <Table cols={["Project", "Loan open"]} numeric={[1]} rows={L.map((l: any) => [l.name, money(l.loan_balance)])} />],
    vat: ["Purchase VAT to recover", () => <>
      <Table cols={["Company (VAT in this name)", "VAT to recover"]} numeric={[1]} rows={[...(d.vat_by_company || []).map((x: any) => [x.company || "—", money(x.vat)]), ["Total", money(vat)]]} />
      <T bold>Invoices</T>
      <Table cols={["Date", "Supplier", "Invoice", "Company", "VAT", "Total"]} numeric={[4, 5]} rows={tx.filter((x: any) => x.type === "purchase" && Number(x.vat_amount) > 0).map((x: any) => [dkey(x), x.supplier || "", x.invoice_no || "", x.vat_company || "", money(x.vat_amount), money(x.total)])} />
    </>],
  };
  return (
    <Screen>
      <Sheet open={!!kd} onClose={() => setKd(null)} title={kd ? KD[kd][0] : ""}>{kd ? KD[kd][1]() : null}</Sheet>
      {wide ? (
        <View style={{ flexDirection: "row", gap: 18, alignItems: "flex-start" }}>
          <View style={{ flex: 2.2, gap: 16 }}><Rise i={0}>{hero}</Rise><Rise i={1}>{kpis}</Rise><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}><View style={{ flex: 1.3, minWidth: 280 }}>{chartCard}</View><View style={{ flex: 1, minWidth: 280 }}>{recentCard}</View></View>{table}</View>
          <View style={{ flex: 1, gap: 16, minWidth: 300 }}>{side}</View>
        </View>
      ) : <><Rise i={0}>{hero}</Rise><Rise i={1}>{kpis}</Rise>{chartCard}{side}{recentCard}{table}</>}
    </Screen>
  );
}

export function Money() {
  const { d, update } = useData(); const flows = useFlows(); const c = useColors(), wide = useWide();
  const [cx, setCx] = useState<any>(null), [why, setWhy] = useState(""), [err, setErr] = useState("");
  const [filter, setFilter] = useState("all");
  const list = (d.txns || []).filter((x: any) => filter === "all" || x.type === filter);
  return (
    <Screen>
      <View style={{ flexDirection: wide ? "row" : "column", alignItems: wide ? "flex-end" : "flex-start", gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}><H1>Money</H1>
          <T muted size={14}>Say “Received 115,000 for Malqa”, “Took a 50,000 loan for Narjis”, “Paid Uzair 2,000”. VAT and the project's fee are worked out for you.</T></View>
        <Row wrap>
          <Btn kind="primary" icon={<Icon name="mic" size={16} color={c.accentInk} />} title="Speak or type" onPress={() => flows("speak")} />
          <Btn icon={<Icon name="receipt" size={16} />} title="Invoice" onPress={() => flows("purchase")} />
          <Btn icon={<Icon name="doc" size={16} />} title="Statement" onPress={() => flows("statement")} />
        </Row>
      </View>
      <Select value={filter} onChange={setFilter} style={{ maxWidth: 260 }} options={[{ value: "all", label: "All entries" }, ...Object.entries(TYPE).map(([k, v]) => ({ value: k, label: v }))]} />
      {list.length ? <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 10, overflow: "hidden" }}>
        {list.map((x: any, i: number) => { const off = x.status === "cancelled"; return (
          <View key={x.id} style={{ flexDirection: "row", alignItems: "flex-start", gap: 14, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: i ? 1 : 0, borderColor: c.line, opacity: off ? 0.55 : 1 }}>
            {wide ? <View style={{ width: 84 }}><T size={13} muted>{day(x.paid_on || x.created_at)}</T></View> : null}
            {x.receipt_path ? <Photo path={x.receipt_path} /> : null}
            <View style={{ flex: 1, gap: 3 }}>
              <Row wrap style={{ gap: 6 }}><Pill kind={x.type === "income" ? "good" : x.type === "loan" ? "acc" : "plain"} text={TYPE[x.type]} />{off && <Pill kind="bad" text="Cancelled" />}{(x.flags || []).length > 0 && <Pill kind="warn" text={`${x.flags.length} warning`} />}
                <T bold>{(x.split || []).length > 1 ? x.split.map((s: any) => `${pname(d, s.project_id)} ${s.pct}%`).join(", ") : pname(d, x.project_id)}</T></Row>
              <T muted size={13}>{[x.supplier, x.description, x.sub_name, x.vat_company && `VAT to ${x.vat_company}`, !wide && day(x.created_at)].filter(Boolean).join(", ")}</T>
              {x.type === "income" && <T size={13} muted>VAT {money(x.vat)}, fee {x.fee_pct}% {money(x.fee)}{Number(x.loan) ? `, loan −${money(x.loan)}` : ""}, in hand {money(x.net)}</T>}
              {off && x.cancel_reason ? <T size={13} color={c.bad}>Reason: {x.cancel_reason}</T> : null}
            </View>
            <View style={{ alignItems: "flex-end", gap: 2 }}>
              <T bold size={15} style={off ? { textDecorationLine: "line-through" } : undefined}>{money(x.gross ?? x.total ?? x.amount)}</T>
              {!off && <Pressable onPress={() => { setCx(x); setWhy(""); setErr(""); }} style={{ cursor: "pointer" } as any}><T size={13} color={c.accent}>Cancel</T></Pressable>}
            </View>
          </View>); })}
      </View> : <Empty text="No entries yet. Speak or type the first one." />}
      <Sheet open={!!cx} onClose={() => setCx(null)} title="Cancel this entry">
        <T muted>Money entries are never deleted. The entry stays, crossed out, with your reason in the audit log.</T>
        <Field label="Reason" value={why} onChange={setWhy} />
        {err ? <T color="#B42318">{err}</T> : null}
        <Btn big kind="danger" title="Cancel entry" disabled={!why.trim()} onPress={async () => { try { await update("txns", cx.id, { status: "cancelled", cancel_reason: why.trim() }); setCx(null); } catch (e: any) { setErr(e.message); } }} />
      </Sheet>
    </Screen>
  );
}

export function Projects() {
  const { d, insert, update, reload } = useData(); const flows = useFlows(); const c = useColors();
  const [p, setP] = useState<any>(null), [s, setS] = useState<any>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [det, setDet] = useState<any>(null); // one entry opened for full details
  const [rel, setRel] = useState<any>(null); // retention release for one subcontractor
  const [inv, setInv] = useState<any>(null), [invErr, setInvErr] = useState(""), [invDel, setInvDel] = useState(false); // company invoice being added or changed
  const isDate = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
  const saveInv = async () => {
    setInvErr("");
    if (String(inv.due_on || "").trim() && !isDate(inv.due_on)) { setInvErr("Write the promised date like 2026-11-21."); return; }
    const row = { amount: num(inv.amount), issued_on: isDate(inv.issued_on) ? inv.issued_on.trim() : new Date().toISOString().slice(0, 10), due_on: isDate(inv.due_on) ? inv.due_on.trim() : null, note: inv.note || null };
    const { error } = inv.id ? await supabase.from("company_invoices").update(row).eq("id", inv.id)
      : await supabase.from("company_invoices").insert({ ...row, project_id: inv.project_id, invoice_no: String(inv.invoice_no).trim() });
    if (error) { setInvErr(/duplicate|unique/i.test(error.message) ? "This invoice number is already saved for this project." : error.message); return; }
    setInv(null); await reload(["company_invoices"]);
  };
  const cancelInv = async () => { // an invoice entered by mistake; payments already linked to it stay in the money records
    if (!invDel) { setInvDel(true); return; }
    const { error } = await supabase.from("company_invoices").update({ status: "cancelled" }).eq("id", inv.id);
    if (error) { setInvErr(error.message); return; }
    setInv(null); setInvDel(false); await reload(["company_invoices"]);
  };
  const [hist, setHist] = useState<Record<string, string | null>>({}); // project id → "" (all) or a subcontractor name; missing = closed
  const staff = (d.profiles || []).filter((x: any) => ["supervisor", "engineer"].includes(x.role));
  // Everything that happened on one project, newest first: payments, invoices, expenses and work done (m²).
  const historyOf = (pid: string, sub: string) => [
    ...active(d.txns).filter((t: any) => t.project_id === pid || (t.split || []).some((q: any) => q.project_id === pid)).map((t: any) => ({ ...t, kind: t.type })),
    ...active(d.progress).filter((r: any) => r.project_id === pid).map((r: any) => ({ ...r, kind: "progress" })),
  ].filter((x: any) => !sub || (sub === "__exp" ? ["expense", "purchase"].includes(x.kind) : String(x.sub_name || "").toLowerCase() === sub.toLowerCase()))
   .sort((a: any, b: any) => (dkey(b) + b.created_at).localeCompare(dkey(a) + a.created_at));
  const membersOf = (pid: string) => (d.project_members || []).filter((m: any) => m.project_id === pid).map((m: any) => m.user_id);
  const L = (pid: string) => (d.project_ledger || []).find((l: any) => l.project_id === pid) || {};
  const lc = (x: any) => String(x || "").toLowerCase();
  const subsOf = (pid: string) => (d.subcontractors || []).filter((x: any) => (x.projects || []).includes(pid));
  // Each subcontractor's account on one project: meters done, earned at their rate, paid, balance.
  const subRows = (pid: string) => subsOf(pid).map((x: any) => {
    const pr = active(d.progress).filter((r: any) => r.project_id === pid && lc(r.sub_name) === lc(x.name));
    const qty = sum(pr, "qty"), earned = pr.reduce((t: number, r: any) => t + (Number(r.qty) || 0) * (Number(r.rate) || 0), 0);
    const paid = sum(active(d.txns).filter((t: any) => t.type === "subpay" && t.project_id === pid && lc(t.sub_name) === lc(x.name)), "amount");
    return [x.name, money(qty), money(earned), money(paid), money(earned - paid)];
  });
  const subNums = (pid: string) => subsOf(pid).map((x: any) => {
    const pr = active(d.progress).filter((r: any) => r.project_id === pid && lc(r.sub_name) === lc(x.name));
    const qty = sum(pr, "qty"), earned = pr.reduce((t: number, r: any) => t + (Number(r.qty) || 0) * (Number(r.rate) || 0), 0);
    const paid = sum(active(d.txns).filter((t: any) => t.type === "subpay" && t.project_id === pid && lc(t.sub_name) === lc(x.name)), "amount");
    // Same retention % as the client keeps on this project: held back from each subcontractor until handover / defects period.
    const rp = (Number(termsOf(d, pid).retention) || 0) / 100;
    const released = sum(active(d.txns).filter((t: any) => t.type === "subpay" && t.project_id === pid && lc(t.sub_name) === lc(x.name) && /^Retention release/i.test(String(t.description || ""))), "amount");
    const held = Math.max(0, earned * rp - released), now = earned - paid - held;
    return { x, qty, earned, paid, due: earned - paid, held, now, released, rp };
  });
  const saveLinks = async (pid: string, want: string[]) => {
    for (const x of d.subcontractors || []) {
      const has = (x.projects || []).includes(pid), on = want.includes(x.id);
      if (has !== on) { const { error } = await supabase.from("subcontractors").update({ projects: on ? [...(x.projects || []), pid] : (x.projects || []).filter((q: string) => q !== pid) }).eq("id", x.id); if (error) throw error; }
    }
  };

  // Add a brand-new subcontractor straight from the project screen; it is ticked for this project.
  const addNewSub = async () => {
    const name = String(p.newSub || "").trim(); if (!name) return;
    setErr("");
    try {
      if ((d.subcontractors || []).some((x: any) => String(x.name).toLowerCase() === name.toLowerCase())) throw new Error(name + " is already in the list: tap the name to tick it.");
      const { data, error } = await supabase.from("subcontractors").insert({ name, rate: num(p.newRate || 0), unit: "sqm", projects: p.id ? [p.id] : [] }).select("id").single();
      if (error) throw error;
      await reload(["subcontractors"]);
      setP({ ...p, newSub: "", newRate: "", subs: [...(p.subs || []), data.id] });
    } catch (e: any) { setErr(e.message); }
  };

  const saveProject = async () => {
    setBusy(true); setErr("");
    try {
      const row = { name: p.name.trim(), client: p.client, company: p.company, fee_pct: num(p.fee_pct || 0) };
      if (!row.name || !(row.fee_pct >= 0 && row.fee_pct <= 20)) throw new Error("Name is required and the fee must be 0–20%.");
      let id = p.id;
      if (id) await update("projects", id, row); else id = (await insert("projects", row)).data?.id;
      const now = membersOf(id), want: string[] = p.members || [];
      const add = want.filter((u) => !now.includes(u)), del = now.filter((u: string) => !want.includes(u));
      if (add.length) await supabase.from("project_members").insert(add.map((u) => ({ project_id: id, user_id: u })));
      for (const u of del) await supabase.from("project_members").delete().eq("project_id", id).eq("user_id", u);
      if (id) await saveLinks(id, p.subs || []);
      if (id) {
        const ret = num(p.ret || 0), rate = num(p.rate || 0);
        if (!(ret >= 0 && ret <= 30)) throw new Error("Retention must be between 0 and 30%.");
        const all = { ...((d.preferences || []).find((q: any) => q.key === "project_terms")?.value || {}), [id]: { retention: ret, rate } };
        const { error } = await supabase.from("preferences").upsert({ key: "project_terms", value: all, updated_at: new Date().toISOString() });
        if (error) throw error;
        await saveContact("project", id, { pm_name: p.pm_name || "", pm_phone: p.pm_phone || "", pm_email: p.pm_email || "", cm_name: p.cm_name || "", cm_phone: p.cm_phone || "", cm_email: p.cm_email || "" });
        await reload(["preferences"]);
      }
      await reload(["subcontractors"]); setSel(id); setP(null);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const saveSub = async () => {
    setBusy(true); setErr("");
    try { const row = { name: s.name.trim(), rate: num(s.rate), unit: s.unit || "sqm", projects: s.projects || [] }; if (!row.name || !(row.rate >= 0)) throw new Error("Name and rate are required.");
      let id = s.id;
      if (id) await update("subcontractors", id, row); else id = (await insert("subcontractors", row)).data?.id;
      if (id && (s.phone || s.iqama || contacts.sub?.[id])) { await saveContact("sub", id, { phone: s.phone || "", iqama: s.iqama || "" }); await reload(["preferences"]); }
      setS(null); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  // Contacts kept with the project / subcontractor (PM, CM, phone, iqama) in preferences "contacts".
  const contacts = ((d.preferences || []).find((q: any) => q.key === "contacts")?.value || {}) as any;
  const saveContact = async (kind: "project" | "sub", id: string, v: any) => {
    const all = { ...contacts, [kind]: { ...(contacts[kind] || {}), [id]: v } };
    const { error } = await supabase.from("preferences").upsert({ key: "contacts", value: all, updated_at: new Date().toISOString() });
    if (error) throw error;
  };
  const openProject = (x: any) => setP({ ...x, members: membersOf(x.id), subs: subsOf(x.id).map((q: any) => q.id), ret: termsOf(d, x.id).retention ?? "", rate: termsOf(d, x.id).rate ?? "", ...(contacts.project?.[x.id] || {}) });
  const wide = useWide();
  const projects = d.projects || [];
  const [sel, setSel] = useState<string | null>(null);
  const cur = projects.find((x: any) => x.id === sel) || (wide ? projects[0] : null);
  const [hf, setHf] = useState(""); // history filter: "" = everything, or a subcontractor name

  const list = (
    <View style={{ gap: 10 }}>
      <Row><View style={{ flex: 1 }}><H1>Projects</H1></View><Btn kind="primary" icon={<Icon name="plus" color="#fff" />} title="New" onPress={() => setP({ name: "", client: "", company: "", fee_pct: "", members: [], subs: [], ret: "", rate: "" })} /></Row>
      {projects.length ? <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 10, overflow: "hidden" }}>
        {projects.map((x: any, i: number) => { const a = clientAccount(d, x.id), on = cur?.id === x.id && wide; return (
          <Pressable key={x.id} onPress={() => { setSel(x.id); setHf(""); }} style={({ hovered }: any) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderColor: c.line, borderLeftWidth: 3, borderLeftColor: on ? c.accent : "transparent", backgroundColor: on ? c.accentSoft : hovered ? c.sunk : c.surface, cursor: "pointer" } as any)}>
            <View style={{ flex: 1 }}><T bold>{x.name}</T><T muted size={13}>{[x.client, x.company].filter(Boolean).join(", ") || "No client set"}</T></View>
            <View style={{ alignItems: "flex-end" }}><T bold size={14}>{money(a.m2)} m²</T><T muted size={12}>owes {money(a.owes)}</T></View>
          </Pressable>); })}
      </View> : <Empty text="No projects yet. Press New to add the first one." />}
    </View>
  );

  const detail = cur && (() => {
    const x = cur, a = clientAccount(d, x.id), subs = subsOf(x.id), pc = contacts.project?.[x.id] || {};
    const rows = historyOf(x.id, hf);
    return (
      <View style={{ gap: 14 }}>
        {!wide && <Btn kind="ghost" title="‹ All projects" onPress={() => setSel(null)} />}
        <View style={{ gap: 10 }}>
          <Row style={{ alignItems: "flex-start" }}><View style={{ flex: 1, gap: 2 }}><H1>{x.name}</H1>
            <T size={14} muted>{x.client ? `Client: ${x.client}` : "No client set"}</T></View>
            <Btn title="Edit project" onPress={() => openProject(x)} />
          </Row>
          {/* Project facts, each with its own label (instead of one long sentence). */}
          <View style={[{ flexDirection: "row", flexWrap: "wrap", backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 12, paddingVertical: 4 }, ELEV]}>
            {([["Company", x.company || "—"], ["Service fee", `${x.fee_pct}%`], ["Retention", a.r ? `${money(a.r)}%` : "Not set"], ["Client rate", a.rate ? `${money(a.rate)} SAR / m²` : "Not set"],
              ...(pc.pm_name ? [["Project manager", `${pc.pm_name}${pc.pm_phone ? "\n" + pc.pm_phone : ""}`]] : []), ...(pc.cm_name ? [["Construction manager", `${pc.cm_name}${pc.cm_phone ? "\n" + pc.cm_phone : ""}`]] : [])] as [string, string][]).map(([k, v]) => (
              <View key={k} style={{ flexGrow: 1, flexBasis: wide ? 150 : 130, paddingVertical: 10, paddingHorizontal: 16, gap: 2 }}>
                <T size={12} muted>{k}</T><T size={14} bold color={v === "Not set" ? c.muted : c.ink}>{v}</T>
              </View>))}
          </View>
          <Row wrap>
            <Btn kind="primary" icon={<Icon name="cash" size={16} color={c.accentInk} />} title="Payment received" onPress={() => flows("speak", { intent: "income", project_id: x.id })} />
            <Btn icon={<Icon name="people" size={16} />} title="Pay subcontractor" onPress={() => flows("speak", { intent: "subpay", project_id: x.id, sub_name: subs.length === 1 ? subs[0].name : "" })} />
            <Btn icon={<Icon name="ruler" size={16} />} title="Work done (m²)" onPress={() => flows("speak", { intent: "progress", project_id: x.id })} />
            <Btn icon={<Icon name="receipt" size={16} />} title="Expense / purchase" onPress={() => flows("speak", { intent: "expense", project_id: x.id })} />
            <Btn icon={<Icon name="pct" size={16} />} title={`Loan from ${x.company || "company"}`} onPress={() => flows("speak", { intent: "loan", project_id: x.id })} />
            <Btn icon={<Icon name="doc" size={16} />} title="Statement" onPress={() => flows("statement", { kind: "project", target: x.name, project_id: x.id })} />
          </Row>
        </View>

        <StatStrip items={[{ label: "Installed", value: money(a.m2) + " m²" }, { label: "Client still owes", value: SAR(a.owes) }, { label: "Received from client", value: SAR(a.received) },
          { label: "Expenses (ex VAT)", value: SAR(Number(L(x.id).cost) || 0), onPress: () => setHf("__exp") },
          { label: "Pay subcontractors now", value: SAR(subNums(x.id).reduce((t, r) => t + Math.max(0, r.now), 0)), tone: subNums(x.id).some((r) => r.now > 0.5) ? "bad" : undefined },
          { label: "Retention held from subs", value: SAR(subNums(x.id).reduce((t, r) => t + r.held, 0)) }, { label: "Retention kept by client", value: SAR(a.retHeld) }]} />
        {!a.rate && <T muted size={13}>Add the client rate per m² (Edit) to see the work value and what is still to come.</T>}
        <VarianceCard x={x} done={a.m2} />

        <Rise i={5}><Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
          <View style={{ padding: 18, paddingBottom: 12 }}><SectionHead title="Invoices" sub={(() => { const open = invoicesOf(d, x.id).filter((v: any) => v.left > 0.5); return open.length
              ? `${money(open.reduce((s2: number, v: any) => s2 + v.left, 0))} SAR still to come from ${x.company || "the company"}, oldest invoice waiting ${Math.max(...open.map((v: any) => v.age))} days. Click an invoice to add a date they promise.`
              : `Invoices ${x.company || "the company"} raised for our work: what was paid and what is still to come`; })()}
            right={<Btn icon={<Icon name="plus" size={16} />} title="Add invoice" onPress={() => { setInvErr(""); setInvDel(false); setInv({ project_id: x.id, invoice_no: "", amount: "", issued_on: new Date().toISOString().slice(0, 10), due_on: "", note: "" }); }} />} /></View>
          {invoicesOf(d, x.id).length ? invoicesOf(d, x.id).map((v: any) => { const [lab, kind] = STATE_LABEL[v.state as keyof typeof STATE_LABEL]; return (
            <Pressable key={v.id} onPress={() => { setInvErr(""); setInvDel(false); setInv({ ...v, amount: String(v.amount), due_on: v.due_on || "", note: v.note || "" }); }} style={({ hovered }: any) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 18, borderTopWidth: 1, borderColor: c.line, backgroundColor: hovered ? c.sunk : c.surface, cursor: "pointer" } as any)}>
              <View style={{ flex: 1.4 }}><T bold size={14}>Invoice {v.invoice_no}</T><T size={12} color={v.state === "late" || v.state === "missed" ? c.bad : v.state === "slow" ? c.warn : c.muted}>{day(v.issued_on)}, {waitText(v).toLowerCase()}{v.note ? ", " + v.note : ""}</T></View>
              {wide ? <View style={{ flex: 1, alignItems: "flex-end" }}><T size={12} muted>Amount</T><T size={14}>{money(v.amount)}</T></View> : null}
              <View style={{ flex: 1, alignItems: "flex-end" }}><T size={12} muted>Received</T><T size={14} color={c.good}>{money(v.paid)}</T></View>
              <View style={{ flex: 1, alignItems: "flex-end" }}><T size={12} muted>Still to come</T><T size={14} bold color={v.state === "late" || v.state === "missed" ? c.bad : v.left > 0.5 ? c.warn : c.good}>{money(v.left)}</T></View>
              <View style={{ width: 120, alignItems: "flex-end" }}><Pill kind={kind} text={lab} /></View>
              <View style={{ width: 150, alignItems: "flex-end" }}>{v.left > 0.5 ? <Btn kind="ghost" title="Payment received" onPress={() => flows("speak", { intent: "income", project_id: x.id, amount: String(v.left), invoice_no: v.invoice_no })} /> : <T size={12} muted>Settled</T>}</View>
            </Pressable>); }) : <View style={{ paddingHorizontal: 18, paddingBottom: 18 }}><T muted>No invoices yet. Add each invoice {x.company || "the company"} raises, then pick it when the payment comes (part payments add up).</T></View>}
        </Card></Rise>

        {/* Money the company lent us to run the work, and what it has cut back from its payments. */}
        <Rise i={5}><Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
          {(() => { const co = x.company || "the company", tx = active(d.txns || []).filter((t: any) => t.project_id === x.id && (t.type === "loan" || (t.type === "income" && Number(t.loan) > 0)))
              .sort((p: any, q: any) => dkey(q).localeCompare(dkey(p)));
            const taken = tx.filter((t: any) => t.type === "loan").reduce((s2: number, t: any) => s2 + (Number(t.amount) || 0), 0), cut = tx.filter((t: any) => t.type === "income").reduce((s2: number, t: any) => s2 + (Number(t.loan) || 0), 0), open = taken - cut;
            return <>
              <View style={{ padding: 18, paddingBottom: 12 }}><SectionHead title={`Loan from ${co}`} sub={`Money ${co} gave us to run the work, and what they cut back from their payments`}
                right={<Btn icon={<Icon name="plus" size={16} />} title="Loan taken" onPress={() => flows("speak", { intent: "loan", project_id: x.id })} />} /></View>
              <View style={{ flexDirection: "row", borderTopWidth: 1, borderColor: c.line }}>
                {([["Taken", taken, c.ink], ["Cut back so far", cut, c.good], ["Still to cut", open, open > 0.5 ? c.warn : c.good]] as [string, number, string][]).map(([k, v, col], i) => (
                  <View key={k} style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 18, borderLeftWidth: i ? 1 : 0, borderColor: c.line, gap: 2 }}><T size={12} muted>{k}</T><T size={16} bold color={col}>{money(v)}</T></View>))}
              </View>
              {tx.length ? tx.slice(0, 8).map((t: any) => (
                <View key={t.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 18, borderTopWidth: 1, borderColor: c.line }}>
                  <View style={{ width: 90 }}><T size={13} muted>{day(t.paid_on || t.created_at)}</T></View>
                  <View style={{ flex: 1 }}><T size={14}>{t.type === "loan" ? `${co} gave us a loan` : `${co} cut it from a payment of ${money(t.gross)}${t.invoice_no ? ` (invoice ${t.invoice_no})` : ""}`}</T>{t.description ? <T size={12} muted>{t.description}</T> : null}</View>
                  <T size={14} bold color={t.type === "loan" ? c.ink : c.good}>{t.type === "loan" ? "+" + money(t.amount) : "−" + money(t.loan)}</T>
                </View>)) : <View style={{ paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: 1, borderColor: c.line }}><T muted>{`No loan yet. When ${co} gives money, press "Loan taken". When they cut it back, enter the cut in the payment form ("Loan ${co} cut from this payment").`}</T></View>}
            </>; })()}
        </Card></Rise>

        <Rise i={5}><Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
          <View style={{ padding: 18, paddingBottom: 12 }}><SectionHead title="Subcontractors" sub={a.r ? `We keep ${money(a.r)}% retention from each one, the same as the client keeps from us` : "Set the project's retention (Edit project) to keep the same % from subcontractors"} right={<Btn icon={<Icon name="plus" size={16} />} title="Add" onPress={() => setS({ name: "", rate: "", unit: "sqm", projects: [x.id] })} />} /></View>
          {subs.length ? (() => { const R = subNums(x.id), tot = R.reduce((t, r) => ({ qty: t.qty + r.qty, earned: t.earned + r.earned, paid: t.paid + r.paid, now: t.now + Math.max(0, r.now), held: t.held + r.held }), { qty: 0, earned: 0, paid: 0, now: 0, held: 0 });
            const cell = (v: any, o: any = {}) => <View style={{ ...(o.w ? { width: o.w } : { flex: o.f || 1 }), alignItems: o.left ? "flex-start" : "flex-end", justifyContent: "center" }}>{typeof v === "string" ? <T size={o.h ? 12 : 14} bold={o.b} muted={o.h} color={o.col}>{v}</T> : v}</View>;
            return <View>
              <View style={{ flexDirection: "row", gap: 12, paddingVertical: 8, paddingHorizontal: 18, backgroundColor: c.sunk, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.line }}>
                {cell("Name", { f: 1.6, left: true, h: true })}{wide && cell("Rate", { h: true })}{cell("m² done", { h: true })}{wide && cell("Earned", { h: true })}{wide && cell("Paid", { h: true })}{cell("Pay now", { h: true })}{cell("Held", { h: true })}{cell("", { w: 150 })}
              </View>
              {R.map((r, i) => { const sc = contacts.sub?.[r.x.id] || {}; return (
                <Pressable key={r.x.id} onPress={() => setS({ ...r.x, ...sc })} style={({ hovered }: any) => ({ flexDirection: "row", gap: 12, paddingVertical: 11, paddingHorizontal: 18, borderTopWidth: i ? 1 : 0, borderColor: c.line, backgroundColor: hovered ? c.sunk : c.surface, cursor: "pointer" } as any)}>
                  {cell(<View><T bold size={14}>{r.x.name}</T>{sc.phone ? <T size={12} muted>{sc.phone}</T> : null}</View>, { f: 1.6, left: true })}
                  {wide && cell(`${money(r.x.rate)} / ${r.x.unit === "sqm" ? "m²" : r.x.unit}`, { col: c.muted })}{cell(money(r.qty))}{wide && cell(money(r.earned))}{wide && cell(money(r.paid))}
                  {cell(money(Math.max(0, r.now)), { b: true, col: r.now > 0.5 ? c.warn : c.good })}
                  {cell(r.held > 0.5 ? money(r.held) : r.released > 0 ? "Released" : "—", { col: c.muted })}
                  {cell(<View style={{ flexDirection: "row", gap: 2 }}>
                    {r.now > 0.5 ? <Btn kind="ghost" title="Pay" onPress={() => flows("speak", { intent: "subpay", project_id: x.id, sub_name: r.x.name, amount: String(Math.round(r.now * 100) / 100) })} /> : null}
                    {r.held > 0.5 ? <Btn kind="ghost" title="Release" onPress={() => setRel({ pid: x.id, name: r.x.name, held: r.held, full: r.earned * r.rp })} /> : null}
                    {r.now <= 0.5 && r.held <= 0.5 ? <T size={12} muted>Settled</T> : null}</View>, { w: 150 })}
                </Pressable>); })}
              <View style={{ flexDirection: "row", gap: 12, paddingVertical: 11, paddingHorizontal: 18, borderTopWidth: 1, borderColor: c.line, backgroundColor: c.sunk }}>
                {cell("Total", { f: 1.6, left: true, b: true })}{wide && cell("")}{cell(money(tot.qty), { b: true })}{wide && cell(money(tot.earned), { b: true })}{wide && cell(money(tot.paid), { b: true })}{cell(money(tot.now), { b: true, col: tot.now > 0.5 ? c.warn : c.good })}{cell(money(tot.held), { b: true, col: c.muted })}{cell("", { w: 150 })}
              </View>
            </View>; })() : <View style={{ paddingHorizontal: 18, paddingBottom: 18 }}><T muted>No subcontractors on this project yet. Press Add.</T></View>}
        </Card></Rise>

        <Rise i={6}><Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
          <View style={{ padding: 18, paddingBottom: 12, gap: 8 }}>
            <SectionHead title="History" sub="Everything on this project, newest first. Click a line for the full details." right={<Select value={hf} onChange={setHf} style={{ width: 210 }} options={[{ value: "", label: "Everything" }, { value: "__exp", label: "Expenses and purchases" }, ...subs.map((q: any) => ({ value: q.name, label: q.name }))]} />} />
            {hf === "__exp" ? <T size={13} color={c.accent}>{rows.length} expense and purchase entries, {money(rows.reduce((t: number, r: any) => t + (Number(r.total ?? r.amount) || 0), 0))} SAR with VAT</T>
              : hf ? <T size={13} color={c.accent}>{hf}: {money(sum(rows.filter((r: any) => r.kind === "progress"), "qty"))} m² done, paid {money(sum(rows.filter((r: any) => r.kind === "subpay"), "amount"))} SAR</T> : null}
          </View>
          {rows.length ? rows.map((r: any, i: number) => { const inc = r.kind === "income", prog = r.kind === "progress"; return (
            <Pressable key={r.kind + r.id} onPress={() => setDet(r)} style={({ hovered }: any) => ({ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 10, paddingHorizontal: 18, borderTopWidth: 1, borderColor: c.line, backgroundColor: hovered ? c.sunk : c.surface, cursor: "pointer" } as any)}>
              {wide ? <View style={{ width: 88 }}><T size={13} muted>{dkey(r)}</T></View> : null}
              <View style={{ width: 96 }}><Pill kind={inc ? "good" : prog ? "acc" : "plain"} text={prog ? "Work done" : TYPE[r.kind]} /></View>
              <View style={{ flex: 1 }}><T size={14} bold>{r.sub_name || r.supplier || (inc ? "Payment from the client" : r.description) || "—"}</T>
                <T muted size={12}>{[!wide && dkey(r), r.method, r.invoice_no && "Invoice " + r.invoice_no, Number(r.vat_amount) > 0 && `VAT ${money(r.vat_amount)} to ${r.vat_company || "?"}`].filter(Boolean).join(", ")}</T></View>
              <T bold size={14} color={inc ? c.good : c.ink}>{prog ? `${money(r.qty)} m²` : `${inc ? "+" : "−"}${money(r.gross ?? r.total ?? r.amount)}`}</T>
            </Pressable>); }) : <View style={{ paddingHorizontal: 18, paddingBottom: 18 }}><T muted>Nothing yet.</T></View>}
        </Card></Rise>
      </View>
    );
  })();

  return (
    <Screen>
      {wide ? (
        <View style={{ flexDirection: "row", gap: 18, alignItems: "flex-start" }}>
          <View style={{ width: 340 }}>{list}</View>
          <View style={{ flex: 1 }}>{detail || <Empty text="Choose a project on the left." />}</View>
        </View>
      ) : (cur ? detail : list)}

      <Sheet open={!!inv} onClose={() => setInv(null)} title={inv?.id ? `Invoice ${inv.invoice_no}` : "Add invoice"}>
        {inv && <>
          {inv.id ? <T muted size={13}>{waitText(inv)}{inv.paid > 0 ? `, ${money(inv.paid)} received so far` : ""}.</T>
            : <Field required label="Invoice number" value={inv.invoice_no} onChange={(v) => setInv({ ...inv, invoice_no: v })} />}
          <Row wrap>
            <Field required label="Amount on the invoice (SAR, with VAT)" value={inv.amount} numeric onChange={(v) => setInv({ ...inv, amount: v })} />
            <Field label="Invoice date (YYYY-MM-DD)" value={inv.issued_on} onChange={(v) => setInv({ ...inv, issued_on: v })} />
          </Row>
          {inv.id ? <Field label="Date they promised to pay (YYYY-MM-DD, if they gave one)" value={inv.due_on} onChange={(v) => setInv({ ...inv, due_on: v })} placeholder="e.g. 2026-11-21" /> : null}
          <Field label={inv.id ? "Note (e.g. they said the rest next week)" : "Note (optional)"} value={inv.note} onChange={(v) => setInv({ ...inv, note: v })} />
          {invErr ? <T color={c.bad}>{invErr}</T> : null}
          <Btn big kind="primary" title={inv.id ? "Save changes" : "Save invoice"} disabled={!String(inv.invoice_no).trim() || !(num(inv.amount) > 0)} onPress={saveInv} />
          {inv.id ? <Btn kind={invDel ? "danger" : "ghost"} title={invDel ? "Press again to remove this invoice" : "Remove invoice (entered by mistake)"} onPress={cancelInv} />
            : <T size={12} muted>No need to know when they will pay. The app counts the days from the invoice date: after 30 days it turns amber, after 60 days red. When money comes, press "Payment received"; part payments add up.</T>}
        </>}
      </Sheet>
      <Sheet open={!!rel} onClose={() => setRel(null)} title={rel ? `Release retention · ${rel.name}` : ""}>
        {rel && <>
          <T size={14}>We are holding {money(rel.held)} SAR of {rel.name}'s money as retention on this project.</T>
          <T size={13} muted>Usual practice: release half when his work is inspected and handed over (snag list closed), and the rest after the defects period (often 12 months) or when the client releases our retention.</T>
          <Row wrap>
            {rel.held > rel.full / 2 + 0.5 ? <Btn kind="primary" title={`Release half at handover (${money(Math.min(rel.held, rel.full / 2))})`} onPress={() => { const amt = Math.round(Math.min(rel.held, rel.full / 2) * 100) / 100; setRel(null); flows("speak", { intent: "subpay", project_id: rel.pid, sub_name: rel.name, amount: String(amt), relRet: true }); }} /> : null}
            <Btn kind={rel.held > rel.full / 2 + 0.5 ? "default" : "primary"} title={`Release all that is left (${money(rel.held)})`} onPress={() => { const amt = Math.round(rel.held * 100) / 100; setRel(null); flows("speak", { intent: "subpay", project_id: rel.pid, sub_name: rel.name, amount: String(amt), relRet: true }); }} />
          </Row>
          <T size={12} muted>If you had to pay someone else to fix his defects, release less: change the amount in the next step.</T>
        </>}
      </Sheet>
      <Sheet open={!!det} onClose={() => setDet(null)} title="Entry details">
        {det && <>
          <Table cols={["", ""]} rows={([
            ["Date", dkey(det)], ["Entered on", stamp(det.created_at)], ["What", det.kind === "progress" ? "Work done" : TYPE[det.kind]], ["Project", pname(d, det.project_id)],
            det.sub_name && ["Subcontractor", det.sub_name], det.supplier && ["Supplier", det.supplier], det.invoice_no && ["Invoice number", det.invoice_no],
            det.kind === "progress" && ["m²", money(det.qty) + " " + (det.unit || "")], det.kind === "progress" && det.rate && ["Rate", money(det.rate)],
            det.kind !== "progress" && ["Amount (SAR)", money(det.gross ?? det.total ?? det.amount)],
            Number(det.vat_amount) > 0 && ["VAT", money(det.vat_amount)], det.vat_company && ["VAT in the name of", det.vat_company],
            det.type === "income" && ["VAT · fee · loan cut", `${money(det.vat)} · ${money(det.fee)} · ${money(det.loan)}`], det.type === "income" && ["In hand", money(det.net)],
            det.method && ["Paid by", det.method], (det.description || det.work) && ["Note", det.description || det.work],
            (det.lines || []).length > 0 && ["Items", det.lines.map((l: any) => `${l.name} ${l.qty ?? ""} ${l.unit ?? ""} × ${l.price ?? ""}`).join("\n")],
            (det.flags || []).length > 0 && ["Warnings accepted", det.flags.join("; ")], det.heard && ["Typed / spoken", det.heard],
          ].filter(Boolean) as string[][])} />
          {det.receipt_path ? <><T bold>Invoice photo</T><Photo path={det.receipt_path} size={260} /></> : null}
        </>}
      </Sheet>
      <Sheet open={!!p} onClose={() => setP(null)} title={p?.id ? "Edit project" : "New project"}>
        {p && <>
          <Field required label="Project name" value={p.name} onChange={(v) => setP({ ...p, name: v })} />
          <Field label="Client" value={p.client} onChange={(v) => setP({ ...p, client: v })} />
          <Field label="Company the project is under" value={p.company} onChange={(v) => setP({ ...p, company: v })} />
          <Field required label="Service fee % (charged on the amount after VAT)" value={p.fee_pct} numeric onChange={(v) => setP({ ...p, fee_pct: v })} />
          <Row wrap>
            <Field label="Retention % kept by the client (usually 10–20)" value={p.ret} numeric onChange={(v) => setP({ ...p, ret: v })} />
            <Field label="Client rate per m² (SAR, before VAT)" value={p.rate} numeric onChange={(v) => setP({ ...p, rate: v })} />
          </Row>
          <T size={13} muted>With the client rate, the app works out: m² done × rate = work value, minus what the client paid (plus the retention he keeps) = what he still owes.</T>
          <T bold>Client's people (optional, for later)</T>
          <Row wrap>
            <Field label="Project manager (PM)" value={p.pm_name} onChange={(v) => setP({ ...p, pm_name: v })} />
            <Field label="PM phone" value={p.pm_phone} numeric onChange={(v) => setP({ ...p, pm_phone: v })} />
            <Field label="PM email" value={p.pm_email} onChange={(v) => setP({ ...p, pm_email: v })} />
          </Row>
          <Row wrap>
            <Field label="Construction manager (CM)" value={p.cm_name} onChange={(v) => setP({ ...p, cm_name: v })} />
            <Field label="CM phone" value={p.cm_phone} numeric onChange={(v) => setP({ ...p, cm_phone: v })} />
            <Field label="CM email" value={p.cm_email} onChange={(v) => setP({ ...p, cm_email: v })} />
          </Row>
          <T bold>Site staff (supervisors and engineers)</T>
          <T size={13} muted>Tick who works on this site. They will see only the projects they are ticked on, and can report progress there.</T>
          {!staff.length && <T size={13} muted>No supervisor or engineer yet. Add them first in More → People (role: Supervisor or Engineer); then they show here.</T>}
          <Row wrap>{staff.map((u: any) => { const on = (p.members || []).includes(u.id); return <Btn key={u.id} kind={on ? "primary" : "default"} title={`${u.name} · ${u.role}`} onPress={() => setP({ ...p, members: on ? p.members.filter((m: string) => m !== u.id) : [...(p.members || []), u.id] })} />; })}</Row>
          <T bold>Subcontractors on this project</T>
          <T size={13} muted>Tap a name to tick or untick it. A new one: write the name (and rate per m²) below and tap Add.</T>
          <Row wrap>{(d.subcontractors || []).map((u: any) => { const on = (p.subs || []).includes(u.id); return <Btn key={u.id} kind={on ? "primary" : "default"} title={(on ? "✓ " : "") + u.name} onPress={() => setP({ ...p, subs: on ? p.subs.filter((m: string) => m !== u.id) : [...(p.subs || []), u.id] })} />; })}</Row>
          <Row wrap>
            <View style={{ flexGrow: 2, flexBasis: 160 }}><Field label="New subcontractor name" value={p.newSub || ""} onChange={(v) => setP({ ...p, newSub: v })} /></View>
            <View style={{ flexGrow: 1, flexBasis: 100 }}><Field label="Rate per m² (SAR)" value={p.newRate || ""} numeric onChange={(v) => setP({ ...p, newRate: v })} /></View>
          </Row>
          <Btn icon={<Icon name="plus" />} title="Add subcontractor" disabled={!String(p.newSub || "").trim()} onPress={addNewSub} />
          <T size={13} muted>The fee is locked: only Super-Admin can change it, and every change is in the audit log.</T>
          {err ? <T color="#B42318">{err}</T> : null}
          <Btn big kind="primary" title="Save" busy={busy} onPress={saveProject} />
        </>}
      </Sheet>
      <Sheet open={!!s} onClose={() => setS(null)} title={s?.id ? "Edit subcontractor" : "New subcontractor"}>
        {s && <>
          <Field required label="Name" value={s.name} onChange={(v) => setS({ ...s, name: v })} />
          <Row wrap><Field label="Phone (optional)" value={s.phone} numeric onChange={(v) => setS({ ...s, phone: v })} /><Field label="Iqama number (optional)" value={s.iqama} numeric onChange={(v) => setS({ ...s, iqama: v })} /></Row>
          <Row><Field required label="Rate (SAR)" value={s.rate} numeric onChange={(v) => setS({ ...s, rate: v })} /><Select label="Unit" value={s.unit} onChange={(v) => setS({ ...s, unit: v })} options={["sqm", "rft", "pcs"].map((u) => ({ value: u, label: u }))} /></Row>
          <T bold>Projects</T>
          <Row wrap>{(d.projects || []).map((q: any) => { const on = (s.projects || []).includes(q.id); return <Btn key={q.id} kind={on ? "primary" : "default"} title={q.name} onPress={() => setS({ ...s, projects: on ? s.projects.filter((m: string) => m !== q.id) : [...(s.projects || []), q.id] })} />; })}</Row>
          <T size={13} muted>Work already reported keeps its rate. Work reported before any rate was set takes this one.</T>
          {err ? <T color="#B42318">{err}</T> : null}
          <Btn big kind="primary" title="Save" busy={busy} onPress={saveSub} />
        </>}
      </Sheet>
    </Screen>
  );
}

/** A starting password the person changes on first sign-in: 10 letters and digits, no look-alikes (0/O, 1/l). */
// Starting password: 12 characters from the device's secure random source (no look-alike letters like l/1, O/0).
const startPassword = () => {
  const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789", b = new Uint32Array(12);
  if (typeof crypto !== "undefined" && (crypto as any).getRandomValues) (crypto as any).getRandomValues(b); else for (let i = 0; i < 12; i++) b[i] = Math.floor(Math.random() * 2 ** 32);
  const p = [...b].map((x) => a[x % a.length]).join("");
  return /\d/.test(p) ? p : p.slice(0, 11) + "7";
};
const waTo = (phone: string) => { let n = String(phone || "").replace(/\D/g, ""); if (n.startsWith("00")) n = n.slice(2); if (n.startsWith("05")) n = "966" + n.slice(1); return n; };

export function People() {
  const { d, update } = useData();
  const [f, setF] = useState<any>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [reset, setReset] = useState<any>(null), [done, setDone] = useState<any>(null);
  const ROLE: Record<string, string> = { admin: "Super-Admin", abu: "Abu", engineer: "Engineer", supervisor: "Supervisor" };
  const call = async (body: any) => {
    setBusy(true); setErr("");
    const { data, error } = await supabase.functions.invoke("invite-user", { body });
    setBusy(false);
    if (error || (data as any)?.error) { setErr((data as any)?.error || error!.message); return null; }
    return (data as any) || {};
  };
  const add = async () => { if (await call(f)) { setDone({ name: f.name, email: f.email, phone: f.phone, password: f.password }); setF(null); } };
  const doReset = async () => { const r = await call({ action: "reset", user_id: reset.id, password: reset.password }); if (r) { setDone({ ...reset, email: r.email || "" }); setReset(null); } };
  const message = (x: any) => `AL-Swati app\nEmail: ${x.email}\nStarting password: ${x.password}\nAfter signing in, choose your own password.`;
  return (
    <Screen>
      <Row><View style={{ flex: 1 }}><H1>People</H1></View><Btn kind="primary" icon={<Icon name="plus" color="#fff" />} title="Add person" onPress={() => { setErr(""); setF({ name: "", email: "", role: "supervisor", phone: "", projects: [], password: startPassword() }); }} /></Row>
      <T muted size={13}>Each person signs in with their own email and a password only they know. If they forget it, set a new starting password here and send it to their phone.</T>
      {(d.profiles || []).map((u: any) => (
        <Card key={u.id}>
          <Row><View style={{ flex: 1 }}><T bold>{u.name}</T><T muted size={13}>{ROLE[u.role]} · {u.phone || "no phone"}</T></View><Pill kind={u.active ? "good" : "bad"} text={u.active ? "Active" : "Off"} /></Row>
          <Row wrap>
            <Btn kind="ghost" title={u.active ? "Switch off" : "Switch on"} onPress={() => update("profiles", u.id, { active: !u.active })} />
            <Btn kind="ghost" title="New password" onPress={() => { setErr(""); setReset({ id: u.id, name: u.name, phone: u.phone, password: startPassword() }); }} />
          </Row>
        </Card>))}
      <Sheet open={!!f} onClose={() => setF(null)} title="Add person">
        {f && <>
          <Field label="Name" value={f.name} onChange={(v) => setF({ ...f, name: v })} />
          <Field label="Email (their Gmail, used to sign in)" value={f.email} onChange={(v) => setF({ ...f, email: v.trim() })} />
          <Field label="Phone (for a new password if they forget)" value={f.phone} numeric onChange={(v) => setF({ ...f, phone: v })} />
          <Select label="Role" value={f.role} onChange={(v) => setF({ ...f, role: v })} options={Object.entries(ROLE).map(([k, v]) => ({ value: k, label: v }))} />
          {["supervisor", "engineer"].includes(f.role) && <><T bold>Sites</T><Row wrap>{(d.projects || []).map((p: any) => { const on = f.projects.includes(p.id); return <Btn key={p.id} kind={on ? "primary" : "default"} title={p.name} onPress={() => setF({ ...f, projects: on ? f.projects.filter((x: string) => x !== p.id) : [...f.projects, p.id] })} />; })}</Row></>}
          <Field label="Starting password (they change it on first sign-in)" value={f.password} onChange={(v) => setF({ ...f, password: v.trim() })} />
          {err ? <T color="#B42318">{err}</T> : null}
          <Btn big kind="primary" title="Add" busy={busy} disabled={!f.name || !/.+@.+\..+/.test(f.email) || waTo(f.phone).length < 9 || f.password.length < 10} onPress={add} />
        </>}
      </Sheet>
      <Sheet open={!!reset} onClose={() => setReset(null)} title={`New password for ${reset?.name || ""}`}>
        {reset && <>
          <Field label="New starting password" value={reset.password} onChange={(v) => setReset({ ...reset, password: v.trim() })} />
          <T muted size={13}>Their old password stops working now. They sign in with this one, then choose their own.</T>
          {err ? <T color="#B42318">{err}</T> : null}
          <Btn big kind="primary" title="Set new password" busy={busy} disabled={reset.password.length < 10} onPress={doReset} />
        </>}
      </Sheet>
      <Sheet open={!!done} onClose={() => setDone(null)} title="Send the sign-in details">
        {done && <>
          <T>{message(done)}</T>
          {done.phone ? <Btn big kind="primary" icon={<Icon name="share" color="#fff" />} title="Send on WhatsApp" onPress={() => Linking.openURL(`https://wa.me/${waTo(done.phone)}?text=${encodeURIComponent(message(done))}`)} /> : null}
          {done.phone ? <Btn title="Send as SMS" onPress={() => Linking.openURL(`sms:${done.phone}?body=${encodeURIComponent(message(done))}`)} /> : null}
          <T muted size={13}>You press send. Nobody else sees this password, and it works only until they choose their own.</T>
        </>}
      </Sheet>
    </Screen>
  );
}

export function Team() {
  const { d } = useData();
  const latest = useMemo(() => { const m: Record<string, any> = {}; (d.locations || []).forEach((l: any) => { if (!m[l.user_id]) m[l.user_id] = l; }); return m; }, [d.locations]);
  const staff = (d.profiles || []).filter((x: any) => ["supervisor", "engineer"].includes(x.role));
  return (
    <Screen>
      <H1>Team on site</H1>
      <T muted size={13}>Location is recorded only from 06:00 to 18:00, about every 10 minutes. Each person agreed to this on their phone.</T>
      {staff.map((u: any) => { const l = latest[u.id]; const sites = (d.project_members || []).filter((m: any) => m.user_id === u.id).map((m: any) => pname(d, m.project_id));
        return (
          <Card key={u.id}>
            <Row><View style={{ flex: 1 }}><T bold>{u.name}</T><T muted size={13}>{u.role} · {sites.join(", ") || "no site"}</T></View>
              {l ? <Pill kind={Date.now() - Date.parse(l.at) < 30 * 60e3 ? "good" : "plain"} text={stamp(l.at).slice(11)} /> : <Pill text="no location today" />}</Row>
            {l && <Btn icon={<Icon name="pin" />} title="Open in maps" onPress={() => Linking.openURL(`https://maps.google.com/?q=${l.lat},${l.lng}`)} />}
          </Card>); })}
    </Screen>
  );
}

export function Audit() {
  const { d } = useData();
  const who = (id: string) => (d.profiles || []).find((p: any) => p.id === id)?.name || "system";
  const what = (a: any) => { const n = a.new || a.old || {}; return [a.table_name, a.op.toLowerCase(), n.name || n.title || n.type || n.sub_name || "", n.gross ?? n.total ?? n.amount ?? n.qty ?? "", a.op === "UPDATE" && n.status === "cancelled" ? `cancelled: ${n.cancel_reason}` : ""].filter(Boolean).join(" · "); };
  return (
    <Screen>
      <H1>Audit log</H1>
      <T muted size={13}>Every save, change and cancel, with who did it. Nobody can edit this list.</T>
      {(d.audit_log || []).map((a: any) => <Card key={a.id}><T size={13} muted>{stamp(a.at)} · {who(a.user_id)}</T><T>{what(a)}</T></Card>)}
    </Screen>
  );
}
