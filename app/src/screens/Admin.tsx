// Super-Admin screens: dashboard, money, projects & subcontractors, people, team on site, audit log.
import React, { useMemo, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { useFlows } from "../components/Flows";
import { active, pname, useData } from "../lib/data";
import { day, money, num, SAR, stamp } from "../lib/fmt";
import { supabase } from "../lib/supabase";
import { Bars, Btn, Card, Checks, DEEP, Empty, Field, H1, H2, Icon, Kpi, MonthCal, Photo, Pill, Rise, Row, Screen, Select, Sheet, T, Table, Tile, useColors, useWide } from "../ui";

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
  const retHeld = Math.max(0, covered * r - released);          // retention the client is still keeping
  const workValue = Number(m2) * rate;                          // m² done × client rate (before VAT)
  const unpaidWork = rate ? Math.max(0, workValue - covered) : 0;
  return { r: r * 100, rate, m2: Number(m2), received: normal + released, covered, retHeld, workValue, unpaidWork, owes: unpaidWork + retHeld };
}
const TYPE_ICON: Record<string, string> = { income: "cash", loan: "pct", purchase: "receipt", expense: "tag", subpay: "people", progress: "ruler" };

export function Dashboard() {
  const { d, profile } = useData(); const flows = useFlows(); const c = useColors(); const wide = useWide();
  const L = d.project_ledger || [], rep = (d.agent_reports || [])[0];
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

  const hero = (
    <Rise i={0}>
      <View style={{ backgroundColor: DEEP.bg, borderRadius: 24, padding: wide ? 28 : 20, gap: 14, overflow: "hidden" }}>
        <View style={{ position: "absolute", right: -60, top: -60, width: 220, height: 220, borderRadius: 110, backgroundColor: DEEP.bg2 }} />
        <View style={{ position: "absolute", right: 60, bottom: -90, width: 180, height: 180, borderRadius: 90, backgroundColor: DEEP.bg2, opacity: 0.6 }} />
        <T size={13} color={DEEP.muted}>{new Date().toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</T>
        <T size={wide ? 30 : 24} bold color={DEEP.ink}>{greet}, {profile.name}</T>
        <T size={15} color={DEEP.muted}>Stone · Marble · Granite · Porcelain — {L.length} projects, {money(totalM2)} m² done in total.</T>
        <Row wrap>
          <Btn kind="primary" icon={<Icon name="mic" color={c.accentInk} />} title="New entry" onPress={() => flows("speak")} />
          <Btn icon={<Icon name="receipt" />} title="Purchase invoice" onPress={() => flows("purchase")} />
          <Btn icon={<Icon name="doc" />} title="Statement PDF" onPress={() => flows("statement")} />
          <Btn icon={<Icon name="spark" />} title="Ask your AI" onPress={() => flows("ask")} />
        </Row>
      </View>
    </Rise>
  );
  const kpis = (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      {[["net", "Cash in hand from clients", SAR(sum(L, "net")), true], ["owes", "Client still owes (ex VAT)", SAR((d.projects || []).reduce((s2: number, p: any) => s2 + clientAccount(d, p.id).owes, 0))], ["cost", "Costs (ex VAT)", SAR(sum(L, "cost"))], ["sub_work", "Subcontract work", SAR(sum(L, "sub_work"))],
        ["profit", "Profit (estimate)", SAR(sum(L, "profit"))], ["loan_balance", "Company loans open", SAR(sum(L, "loan_balance"))], ["vat", "Purchase VAT to recover", SAR(vat)]]
        .map(([k, l, v, h]: any, i) => <Rise key={l} i={i + 1} style={{ flexGrow: 1, flexBasis: wide ? 200 : 150 }}><Kpi hero={h} label={l} value={v} onPress={() => setKd(k)} /></Rise>)}
    </View>
  );
  const chartCard = (
    <Rise i={7}><Card>
      <Row><View style={{ flex: 1 }}><H2>This week</H2></View>
        {([["m2", "m² done"], ["in", "Money in"], ["out", "Paid out"]] as const).map(([k, l]) => <Btn key={k} kind={chart === k ? "primary" : "default"} title={l} onPress={() => setChart(k)} />)}
      </Row>
      <Bars data={series} unit={chart === "m2" ? "" : ""} />
    </Card></Rise>
  );
  const recentCard = (
    <Rise i={8}><Card>
      <H2>Recent activity</H2>
      {recent.length ? recent.map((x: any) => (
        <Row key={x.kind + x.id}>
          <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }}><Icon name={TYPE_ICON[x.kind] || "doc"} size={20} color={c.accent} /></View>
          <View style={{ flex: 1 }}>
            <T bold>{x.kind === "progress" ? `${x.sub_name} · ${money(x.qty)} ${x.unit || "m²"}` : `${TYPE[x.kind]}${x.sub_name ? " · " + x.sub_name : x.supplier ? " · " + x.supplier : ""}`}</T>
            <T muted size={13}>{pname(d, x.project_id)} · {dkey(x)}{x.method ? " · " + x.method : ""}</T>
          </View>
          {x.kind !== "progress" && <T bold>{money(x.gross ?? x.total ?? x.amount)}</T>}
        </Row>)) : <T muted>Nothing yet. Your entries will show here.</T>}
    </Card></Rise>
  );
  const side = <>
    <Rise i={3}><Card><MonthCal marks={marks} /><T size={12} muted>A dot = a payment or work entry that day.</T></Card></Rise>
    <Rise i={5}><Card>
      <Row><Icon name="spark" color={c.accent} /><H2>Main agent · today</H2></Row>
      {rep ? <>
        <T size={15}>{rep.summary}</T>
        <Checks list={(rep.items || []).slice(0, 6).map((i: any) => ({ s: i.level === "bad" ? "bad" : "warn", text: i.text }))} />
        <T size={12} muted>{stamp(rep.created_at)}</T>
      </> : <T muted>The first report arrives at 07:00 once the AI key and the daily schedule are switched on.</T>}
      {newQ > 0 && <Pill kind="warn" text={`${newQ} new client queries`} />}
      {(() => { const wait = (d.quotes || []).filter((q: any) => q.status === "Draft" && !q.rfq?.lock && (q.lines || []).length && (q.lines || []).every((l: any) => Number(l.rate) > 0)); return wait.length ? <Pill kind="bad" text={`${wait.length} quotation(s) waiting for your Approve & Lock`} /> : null; })()}
    </Card></Rise>
  </>;
  const table = <>
    <H2>Projects</H2>
    <Table cols={["Project", "Company", "Fee %", "m² done", "In hand", "Costs", "Sub work", "Loan open", "Profit est."]} numeric={[2, 3, 4, 5, 6, 7, 8]}
      rows={L.map((l: any) => [l.name, l.company || "—", String(l.fee_pct), money(l.installed), money(l.net), money(l.cost), money(l.sub_work), money(l.loan_balance), money(l.profit)])} />
    <T size={12} muted>Profit estimate = cash in hand + loans already deducted − costs (ex VAT) − subcontract work done (meters × rate). Calculated by the database.</T>
  </>;
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
          <View style={{ flex: 2.2, gap: 16 }}>{hero}{kpis}<View style={{ flexDirection: "row", gap: 16, alignItems: "flex-start" }}><View style={{ flex: 1.3 }}>{chartCard}</View><View style={{ flex: 1 }}>{recentCard}</View></View>{table}</View>
          <View style={{ flex: 1, gap: 16, minWidth: 300 }}>{side}</View>
        </View>
      ) : <>{hero}{kpis}{chartCard}{side}{recentCard}{table}</>}
    </Screen>
  );
}

export function Money() {
  const { d, update } = useData(); const flows = useFlows();
  const [cx, setCx] = useState<any>(null), [why, setWhy] = useState(""), [err, setErr] = useState("");
  const [filter, setFilter] = useState("all");
  const list = (d.txns || []).filter((x: any) => filter === "all" || x.type === filter);
  return (
    <Screen>
      <H1>Money</H1>
      <Row wrap>
        <Btn kind="primary" icon={<Icon name="mic" color="#fff" />} title="Speak or type" onPress={() => flows("speak")} />
        <Btn icon={<Icon name="receipt" />} title="Invoice" onPress={() => flows("purchase")} />
        <Btn icon={<Icon name="doc" />} title="Statement" onPress={() => flows("statement")} />
      </Row>
      <T muted size={13}>Say “Received 115,000 for Malqa”, “Took a 50,000 loan for Narjis”, “Paid Uzair 2,000”. VAT and the project's fee are taken out by the database.</T>
      <Select value={filter} onChange={setFilter} options={[{ value: "all", label: "All entries" }, ...Object.entries(TYPE).map(([k, v]) => ({ value: k, label: v }))]} />
      {list.length ? list.map((x: any) => (
        <Card key={x.id} style={x.status === "cancelled" ? { opacity: 0.5 } : undefined}>
          <Row>
            {x.receipt_path ? <Photo path={x.receipt_path} /> : null}
            <View style={{ flex: 1, gap: 2 }}>
              <Row wrap><Pill kind={x.type === "income" ? "good" : x.type === "loan" ? "acc" : "plain"} text={TYPE[x.type]} />{x.status === "cancelled" && <Pill kind="bad" text="Cancelled" />}{(x.flags || []).length > 0 && <Pill kind="warn" text={`${x.flags.length} warning`} />}</Row>
              <T bold>{(x.split || []).length > 1 ? x.split.map((s: any) => `${pname(d, s.project_id)} ${s.pct}%`).join(" · ") : pname(d, x.project_id)}</T>
              <T muted size={13}>{[x.supplier, x.description, x.sub_name, x.vat_company && `VAT → ${x.vat_company}`].filter(Boolean).join(" · ")} · {day(x.created_at)}</T>
              {x.type === "income" && <T size={13} muted>VAT {money(x.vat)} · fee {x.fee_pct}% {money(x.fee)}{Number(x.loan) ? ` · loan −${money(x.loan)}` : ""} → in hand {money(x.net)}</T>}
            </View>
            <T bold>{money(x.gross ?? x.total ?? x.amount)}</T>
          </Row>
          {x.status !== "cancelled" && <Btn kind="ghost" title="Cancel entry" onPress={() => { setCx(x); setWhy(""); setErr(""); }} />}
        </Card>)) : <Empty text="No entries yet. Speak or type the first one." />}
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
  const [hist, setHist] = useState<Record<string, string | null>>({}); // project id → "" (all) or a subcontractor name; missing = closed
  const staff = (d.profiles || []).filter((x: any) => ["supervisor", "engineer"].includes(x.role));
  // Everything that happened on one project, newest first: payments, invoices, expenses and work done (m²).
  const historyOf = (pid: string, sub: string) => [
    ...active(d.txns).filter((t: any) => t.project_id === pid || (t.split || []).some((q: any) => q.project_id === pid)).map((t: any) => ({ ...t, kind: t.type })),
    ...active(d.progress).filter((r: any) => r.project_id === pid).map((r: any) => ({ ...r, kind: "progress" })),
  ].filter((x: any) => !sub || String(x.sub_name || "").toLowerCase() === sub.toLowerCase())
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
      {projects.map((x: any, i: number) => { const a = clientAccount(d, x.id), on = cur?.id === x.id && wide; return (
        <Rise key={x.id} i={i}><Card onPress={() => { setSel(x.id); setHf(""); }} style={on ? { borderColor: c.accent, borderWidth: 2 } : undefined}>
          <Row>
            <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: on ? c.accent : c.accentSoft, alignItems: "center", justifyContent: "center" }}><Icon name="folder" color={on ? c.accentInk : c.accent} /></View>
            <View style={{ flex: 1 }}><T bold size={17}>{x.name}</T><T muted size={13}>{[x.client, x.company].filter(Boolean).join(" · ") || "—"}</T></View>
            <View style={{ alignItems: "flex-end" }}><T bold>{money(a.m2)} m²</T><T muted size={12}>owes {money(a.owes)}</T></View>
          </Row>
        </Card></Rise>); })}
      {!projects.length && <Empty text="No projects yet. Tap New." />}
    </View>
  );

  const detail = cur && (() => {
    const x = cur, a = clientAccount(d, x.id), subs = subsOf(x.id), pc = contacts.project?.[x.id] || {};
    const rows = historyOf(x.id, hf);
    return (
      <View style={{ gap: 14 }}>
        {!wide && <Btn kind="ghost" title="‹ All projects" onPress={() => setSel(null)} />}
        <Rise i={0}><View style={{ backgroundColor: DEEP.bg, borderRadius: 22, padding: 20, gap: 8, overflow: "hidden" }}>
          <View style={{ position: "absolute", right: -50, top: -50, width: 180, height: 180, borderRadius: 90, backgroundColor: DEEP.bg2 }} />
          <Row><View style={{ flex: 1 }}><T size={24} bold color={DEEP.ink}>{x.name}</T>
            <T size={13} color={DEEP.muted}>{[x.client, x.company, `fee ${x.fee_pct}%`, a.r ? `retention ${money(a.r)}%` : null, a.rate ? `client rate ${money(a.rate)}/m²` : null].filter(Boolean).join(" · ")}</T>
            {(pc.pm_name || pc.cm_name) ? <T size={13} color={DEEP.muted}>{[pc.pm_name && `PM ${pc.pm_name} ${pc.pm_phone || ""}`, pc.cm_name && `CM ${pc.cm_name} ${pc.cm_phone || ""}`].filter(Boolean).join(" · ")}</T> : null}</View>
            <Btn title="Edit" icon={<Icon name="doc" />} onPress={() => openProject(x)} />
          </Row>
          <Row wrap>
            <Btn kind="primary" icon={<Icon name="cash" color={c.accentInk} />} title="Payment received" onPress={() => flows("speak", { intent: "income", project_id: x.id })} />
            <Btn icon={<Icon name="people" />} title="Pay subcontractor" onPress={() => flows("speak", { intent: "subpay", project_id: x.id, sub_name: subs.length === 1 ? subs[0].name : "" })} />
            <Btn icon={<Icon name="ruler" />} title="Work done (m²)" onPress={() => flows("speak", { intent: "progress", project_id: x.id })} />
            <Btn icon={<Icon name="receipt" />} title="Expense / purchase" onPress={() => flows("speak", { intent: "expense", project_id: x.id })} />
            <Btn icon={<Icon name="doc" />} title="Statement" onPress={() => flows("statement", { kind: "project", target: x.name, project_id: x.id })} />
          </Row>
        </View></Rise>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {[["Total m² done", money(a.m2) + " m²", true], ["Client still owes", SAR(a.owes)], ["Received from client", SAR(a.received)], ["Retention kept by client", SAR(a.retHeld)]]
            .map(([l, v, h]: any, i) => <Rise key={l} i={i + 1} style={{ flexGrow: 1, flexBasis: 160 }}><Kpi hero={h} label={l} value={v} /></Rise>)}
        </View>
        {!a.rate && <T muted size={13}>Add the client rate per m² (Edit) to see the work value and what is still to come.</T>}

        <Rise i={5}><Card>
          <Row><View style={{ flex: 1 }}><H2>Subcontractors on this project</H2></View><Btn icon={<Icon name="plus" />} title="Add" onPress={() => setS({ name: "", rate: "", unit: "sqm", projects: [x.id] })} /></Row>
          {subs.length ? subs.map((q: any) => { const r = subRows(x.id).find((rr: any) => rr[0] === q.name) || []; const sc = contacts.sub?.[q.id] || {}; return (
            <Pressable key={q.id} onPress={() => setS({ ...q, ...sc })} style={({ hovered }: any) => ({ flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: 14, backgroundColor: hovered ? c.accentSoft : "transparent" })}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }}><T bold color={c.accent}>{String(q.name).slice(0, 1).toUpperCase()}</T></View>
              <View style={{ flex: 1 }}><T bold>{q.name}</T><T muted size={12}>{[`${money(q.rate)} / ${q.unit}`, sc.phone, sc.iqama && "Iqama " + sc.iqama].filter(Boolean).join(" · ")}</T></View>
              <View style={{ alignItems: "flex-end" }}><T bold>{r[1] || 0} m²</T><T muted size={12}>earned {r[2] || 0} · paid {r[3] || 0}</T><T size={12} color={c.accent}>balance {r[4] || 0}</T></View>
            </Pressable>); }) : <T muted>None yet. Tap Add.</T>}
        </Card></Rise>

        <Rise i={6}><Card>
          <H2>History</H2>
          <T muted size={12}>Everything on this project, newest first. Tap a line for all details (note, VAT, invoice, photo).</T>
          {subs.length > 0 && <Row wrap>{[{ name: "" }, ...subs].map((q: any) => <Btn key={q.name || "all"} kind={hf === q.name ? "primary" : "default"} title={q.name || "All"} onPress={() => setHf(q.name)} />)}</Row>}
          {hf ? <T muted size={13}>{hf}: {money(sum(rows.filter((r: any) => r.kind === "progress"), "qty"))} m² done · paid {money(sum(rows.filter((r: any) => r.kind === "subpay"), "amount"))} SAR</T> : null}
          {rows.length ? rows.map((r: any) => (
            <Pressable key={r.kind + r.id} onPress={() => setDet(r)} style={({ hovered }: any) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9, paddingHorizontal: 8, borderRadius: 12, borderBottomWidth: 1, borderColor: c.line, backgroundColor: hovered ? c.accentSoft : "transparent" })}>
              <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }}><Icon name={TYPE_ICON[r.kind] || "doc"} size={18} color={c.accent} /></View>
              <View style={{ flex: 1 }}><T bold size={14}>{r.kind === "progress" ? "Work done" : TYPE[r.kind]} · {r.sub_name || r.supplier || r.description || "—"}</T>
                <T muted size={12}>{[dkey(r), r.method, r.invoice_no && "Invoice " + r.invoice_no, Number(r.vat_amount) > 0 && `VAT ${money(r.vat_amount)} → ${r.vat_company || "?"}`].filter(Boolean).join(" · ")}</T></View>
              <T bold>{r.kind === "progress" ? `${money(r.qty)} m²` : `${money(r.gross ?? r.total ?? r.amount)}`}</T>
            </Pressable>)) : <T muted>Nothing yet.</T>}
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
const startPassword = () => { const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"; let p = ""; for (let i = 0; i < 10; i++) p += a[Math.floor(Math.random() * a.length)]; return /\d/.test(p) ? p : p.slice(0, 9) + "7"; };
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
          <Btn big kind="primary" title="Add" busy={busy} disabled={!f.name || !/.+@.+\..+/.test(f.email) || waTo(f.phone).length < 9 || f.password.length < 8} onPress={add} />
        </>}
      </Sheet>
      <Sheet open={!!reset} onClose={() => setReset(null)} title={`New password for ${reset?.name || ""}`}>
        {reset && <>
          <Field label="New starting password" value={reset.password} onChange={(v) => setReset({ ...reset, password: v.trim() })} />
          <T muted size={13}>Their old password stops working now. They sign in with this one, then choose their own.</T>
          {err ? <T color="#B42318">{err}</T> : null}
          <Btn big kind="primary" title="Set new password" busy={busy} disabled={reset.password.length < 8} onPress={doReset} />
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
