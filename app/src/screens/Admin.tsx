// Super-Admin screens: dashboard, money, projects & subcontractors, people, team on site, audit log.
import React, { useMemo, useState } from "react";
import { Linking, View } from "react-native";
import { useFlows } from "../components/Flows";
import { active, pname, useData } from "../lib/data";
import { day, money, num, SAR, stamp } from "../lib/fmt";
import { supabase } from "../lib/supabase";
import { Bars, Btn, Card, Checks, DEEP, Empty, Field, H1, H2, Icon, Kpi, MonthCal, Photo, Pill, Rise, Row, Screen, Select, Sheet, T, Table, Tile, useColors, useWide } from "../ui";

const sum = (a: any[], k: string) => a.reduce((s, x) => s + (Number(x[k]) || 0), 0);
const TYPE: Record<string, string> = { income: "Income", loan: "Loan", purchase: "Purchase", expense: "Expense", subpay: "Sub payment" };

const dkey = (x: any) => String(x.paid_on || x.work_date || x.created_at || "").slice(0, 10);
const TYPE_ICON: Record<string, string> = { income: "cash", loan: "pct", purchase: "receipt", expense: "tag", subpay: "people", progress: "ruler" };

export function Dashboard() {
  const { d, profile } = useData(); const flows = useFlows(); const c = useColors(); const wide = useWide();
  const L = d.project_ledger || [], rep = (d.agent_reports || [])[0];
  const vat = sum(d.vat_by_company || [], "vat");
  const newQ = (d.inquiries || []).filter((q: any) => q.status === "New").length;
  const [chart, setChart] = useState<"m2" | "in" | "out">("m2");
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
        <T size={15} color={DEEP.muted}>Stone · Marble · Granite · Porcelain · Flooring — {L.length} projects, {money(totalM2)} m² done in total.</T>
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
      {[["Cash in hand from clients", SAR(sum(L, "net")), true], ["Costs (ex VAT)", SAR(sum(L, "cost"))], ["Subcontract work", SAR(sum(L, "sub_work"))],
        ["Profit (estimate)", SAR(sum(L, "profit"))], ["Company loans open", SAR(sum(L, "loan_balance"))], ["Purchase VAT to recover", SAR(vat)]]
        .map(([l, v, h]: any, i) => <Rise key={l} i={i + 1} style={{ flexGrow: 1, flexBasis: wide ? 200 : 150 }}><Kpi hero={h} label={l} value={v} /></Rise>)}
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
    </Card></Rise>
  </>;
  const table = <>
    <H2>Projects</H2>
    <Table cols={["Project", "Company", "Fee %", "m² done", "In hand", "Costs", "Sub work", "Loan open", "Profit est."]} numeric={[2, 3, 4, 5, 6, 7, 8]}
      rows={L.map((l: any) => [l.name, l.company || "—", String(l.fee_pct), money(l.installed), money(l.net), money(l.cost), money(l.sub_work), money(l.loan_balance), money(l.profit)])} />
    <T size={12} muted>Profit estimate = cash in hand + loans already deducted − costs (ex VAT) − subcontract work done (meters × rate). Calculated by the database.</T>
  </>;
  return (
    <Screen>
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
  const { d, insert, update, reload } = useData(); const flows = useFlows();
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
      await reload(["subcontractors"]); setP(null);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const saveSub = async () => {
    setBusy(true); setErr("");
    try { const row = { name: s.name.trim(), rate: num(s.rate), unit: s.unit || "sqm", projects: s.projects || [] }; if (!row.name || !(row.rate >= 0)) throw new Error("Name and rate are required.");
      if (s.id) await update("subcontractors", s.id, row); else await insert("subcontractors", row); setS(null); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <Row><View style={{ flex: 1 }}><H1>Projects</H1></View><Btn kind="primary" icon={<Icon name="plus" color="#fff" />} title="New" onPress={() => setP({ name: "", client: "", company: "", fee_pct: "", members: [], subs: [] })} /></Row>
      {(d.projects || []).map((x: any) => (
        <Card key={x.id} onPress={() => setP({ ...x, members: membersOf(x.id), subs: subsOf(x.id).map((q: any) => q.id) })}>
          <Row><View style={{ flex: 1 }}><T bold size={17}>{x.name}</T><T muted size={13}>{x.company || "—"} · fee {x.fee_pct}% · {membersOf(x.id).length} on site</T></View><View style={{ alignItems: "flex-end" }}><T bold size={20}>{money(L(x.id).installed)} m²</T><T muted size={12}>total done</T></View></Row>
          {subsOf(x.id).length ? <Table cols={["Subcontractor", "Done", "Earned", "Paid", "Balance"]} numeric={[1, 2, 3, 4]} rows={subRows(x.id)} /> : <T muted size={13}>No subcontractors on this project yet. Tap the project to add them.</T>}
          <Row wrap>
            <Btn kind="primary" icon={<Icon name="plus" color="#fff" />} title="Payment received" onPress={() => flows("speak", { intent: "income", project_id: x.id })} />
            <Btn icon={<Icon name="plus" />} title="Pay subcontractor" onPress={() => flows("speak", { intent: "subpay", project_id: x.id, sub_name: subsOf(x.id).length === 1 ? subsOf(x.id)[0].name : "" })} />
            <Btn icon={<Icon name="ruler" />} title="Work done (m²)" onPress={() => flows("speak", { intent: "progress", project_id: x.id, sub_name: subsOf(x.id).length === 1 ? subsOf(x.id)[0].name : "" })} />
            <Btn icon={<Icon name="plus" />} title="Expense" onPress={() => flows("speak", { intent: "expense", project_id: x.id })} />
            <Btn icon={<Icon name="receipt" />} title="Purchase invoice" onPress={() => flows("purchase", { voice: { project_id: x.id } })} />
          </Row>
          {(() => { const inc = active(d.txns).filter((t: any) => t.type === "income" && t.project_id === x.id); const last = inc.map(dkey).sort().pop();
            return <T muted size={13}>Received from client: {money(sum(inc, "gross"))} SAR in {inc.length} payment{inc.length === 1 ? "" : "s"}{last ? ` · last on ${last}` : ""}</T>; })()}
          <Row wrap><Btn icon={<Icon name="log" />} title={hist[x.id] != null ? "Hide history" : "History (every entry, tap for details)"} onPress={() => setHist((h) => { const n = { ...h }; if (n[x.id] != null) delete n[x.id]; else n[x.id] = ""; return n; })} /></Row>
          {hist[x.id] != null && (() => { const rows = historyOf(x.id, hist[x.id] || ""); return <View style={{ gap: 8 }}>
            {subsOf(x.id).length > 0 && <Row wrap>{[{ name: "" }, ...subsOf(x.id)].map((q: any) => <Btn key={q.name || "all"} kind={(hist[x.id] || "") === q.name ? "primary" : "default"} title={q.name || "All"} onPress={() => setHist((h) => ({ ...h, [x.id]: q.name }))} />)}</Row>}
            {hist[x.id] ? <T muted size={13}>{hist[x.id]}: {money(sum(rows.filter((r: any) => r.kind === "progress"), "qty"))} m² done · paid {money(sum(rows.filter((r: any) => r.kind === "subpay"), "amount"))} SAR</T> : null}
            <T muted size={12}>Everything on this project in date order. Tap a line to see all its details (note, VAT, invoice, photo).</T>
            {rows.length ? rows.map((r: any) => (
              <Card key={r.kind + r.id} onPress={() => setDet(r)} style={{ paddingVertical: 10 }}>
                <Row>
                  <View style={{ width: 92 }}><T size={13} muted>{dkey(r)}</T></View>
                  <View style={{ flex: 1 }}><T bold size={14}>{r.kind === "progress" ? "Work done" : TYPE[r.kind]} · {r.sub_name || r.supplier || r.description || "—"}</T>
                    <T muted size={12}>{[r.method, r.invoice_no && "Invoice " + r.invoice_no, Number(r.vat_amount) > 0 && `VAT ${money(r.vat_amount)} → ${r.vat_company || "?"}`].filter(Boolean).join(" · ") || " "}</T></View>
                  <T bold>{r.kind === "progress" ? `${money(r.qty)} m²` : `${money(r.gross ?? r.total ?? r.amount)} SAR`}</T>
                </Row>
              </Card>)) : <T muted>Nothing yet.</T>}
          </View>; })()}
          <Row wrap><Btn icon={<Icon name="doc" />} title="Statements (project, subcontractor, expenses, purchases, received)" onPress={() => flows("statement", { kind: "project", target: x.name, project_id: x.id })} />{x.quote_id ? <Pill kind="acc" text="from quotation" /> : null}</Row>
        </Card>))}
      <Row><View style={{ flex: 1 }}><H2>All subcontractors (all projects)</H2></View><Btn icon={<Icon name="plus" />} title="Add" onPress={() => setS({ name: "", rate: "", unit: "sqm", projects: [] })} /></Row>
      <Table cols={["Name", "Rate", "Unit", "Done", "Earned", "Paid", "Balance"]} numeric={[1, 3, 4, 5, 6]}
        rows={(d.sub_ledger || []).map((x: any) => [x.name + " · " + ((d.subcontractors || []).find((q: any) => q.id === x.id)?.projects || []).map((q: string) => pname(d, q)).join(", "), Number(x.rate) > 0 ? money(x.rate) : "not set", x.unit, money(x.qty), money(x.earned), money(x.paid), money(Number(x.earned) - Number(x.paid))])} />
      <Row wrap>{(d.subcontractors || []).map((x: any) => <Btn key={x.id} title={`Edit ${x.name}`} onPress={() => setS(x)} />)}</Row>

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
          <Field label="Project name" value={p.name} onChange={(v) => setP({ ...p, name: v })} />
          <Field label="Client" value={p.client} onChange={(v) => setP({ ...p, client: v })} />
          <Field label="Company the project is under" value={p.company} onChange={(v) => setP({ ...p, company: v })} />
          <Field label="Service fee % (charged on the amount after VAT)" value={p.fee_pct} numeric onChange={(v) => setP({ ...p, fee_pct: v })} />
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
          <Field label="Name" value={s.name} onChange={(v) => setS({ ...s, name: v })} />
          <Row><Field label="Rate (SAR)" value={s.rate} numeric onChange={(v) => setS({ ...s, rate: v })} /><Select label="Unit" value={s.unit} onChange={(v) => setS({ ...s, unit: v })} options={["sqm", "rft", "pcs"].map((u) => ({ value: u, label: u }))} /></Row>
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
