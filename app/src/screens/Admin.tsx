// Super-Admin screens: dashboard, money, projects & subcontractors, people, team on site, audit log.
import React, { useMemo, useState } from "react";
import { Linking, View } from "react-native";
import { useFlows } from "../components/Flows";
import { active, pname, useData } from "../lib/data";
import { day, money, num, SAR, stamp } from "../lib/fmt";
import { supabase } from "../lib/supabase";
import { Btn, Card, Checks, Empty, Field, H1, H2, Icon, Kpi, Photo, Pill, Row, Screen, Select, Sheet, T, Table, Tile, useColors } from "../ui";

const sum = (a: any[], k: string) => a.reduce((s, x) => s + (Number(x[k]) || 0), 0);
const TYPE: Record<string, string> = { income: "Income", loan: "Loan", purchase: "Purchase", expense: "Expense", subpay: "Sub payment" };

export function Dashboard() {
  const { d, profile } = useData(); const flows = useFlows(); const c = useColors();
  const L = d.project_ledger || [], rep = (d.agent_reports || [])[0];
  const vat = sum(d.vat_by_company || [], "vat");
  const newQ = (d.inquiries || []).filter((q: any) => q.status === "New").length;
  return (
    <Screen>
      <H1>Hello {profile.name}</H1>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Tile accent icon="mic" title="Speak an entry" sub="Payments, loans, rates, progress" onPress={() => flows("speak")} />
        <Tile icon="receipt" title="Purchase invoice" sub="Photo, project, VAT company" onPress={() => flows("purchase")} />
        <Tile icon="doc" title="Statement PDF" sub="Project, subcontractor, supplier, VAT" onPress={() => flows("statement")} />
        <Tile icon="spark" title="Ask your AI" sub="About any project or person" onPress={() => flows("ask")} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Kpi hero label="Cash in hand from clients" value={SAR(sum(L, "net"))} />
        <Kpi label="Costs (ex VAT)" value={SAR(sum(L, "cost"))} />
        <Kpi label="Subcontract work" value={SAR(sum(L, "sub_work"))} />
        <Kpi label="Profit (estimate)" value={SAR(sum(L, "profit"))} />
        <Kpi label="Company loans open" value={SAR(sum(L, "loan_balance"))} />
        <Kpi label="Purchase VAT to recover" value={SAR(vat)} />
      </View>
      <Card>
        <Row><Icon name="spark" color={c.accent} /><H2>Main agent · this morning</H2></Row>
        {rep ? <>
          <T size={16}>{rep.summary}</T>
          <Checks list={(rep.items || []).slice(0, 8).map((i: any) => ({ s: i.level === "bad" ? "bad" : "warn", text: i.text }))} />
          <T size={12} muted>{stamp(rep.created_at)}</T>
        </> : <T muted>The first report arrives tomorrow at 07:00 once the schedule is switched on.</T>}
        {newQ > 0 && <Pill kind="warn" text={`${newQ} new client queries`} />}
      </Card>
      <H2>Projects</H2>
      <Table cols={["Project", "Company", "Fee %", "In hand", "Costs", "Sub work", "Loan open", "Profit est."]} numeric={[2, 3, 4, 5, 6, 7]}
        rows={L.map((l: any) => [l.name, l.company || "—", String(l.fee_pct), money(l.net), money(l.cost), money(l.sub_work), money(l.loan_balance), money(l.profit)])} />
      <T size={12} muted>Profit estimate = cash in hand + loans already deducted − costs (ex VAT) − subcontract work done (meters × rate). Calculated by the database.</T>
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
  const { d, insert, update } = useData(); const flows = useFlows();
  const [p, setP] = useState<any>(null), [s, setS] = useState<any>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const staff = (d.profiles || []).filter((x: any) => ["supervisor", "engineer"].includes(x.role));
  const membersOf = (pid: string) => (d.project_members || []).filter((m: any) => m.project_id === pid).map((m: any) => m.user_id);
  const L = (pid: string) => (d.project_ledger || []).find((l: any) => l.project_id === pid) || {};

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
      setP(null);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const saveSub = async () => {
    setBusy(true); setErr("");
    try { const row = { name: s.name.trim(), rate: num(s.rate), unit: s.unit || "sqm" }; if (!row.name || !(row.rate >= 0)) throw new Error("Name and rate are required.");
      if (s.id) await update("subcontractors", s.id, row); else await insert("subcontractors", row); setS(null); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <Row><View style={{ flex: 1 }}><H1>Projects</H1></View><Btn kind="primary" icon={<Icon name="plus" color="#fff" />} title="New" onPress={() => setP({ name: "", client: "", company: "", fee_pct: "", members: [] })} /></Row>
      {(d.projects || []).map((x: any) => (
        <Card key={x.id} onPress={() => setP({ ...x, members: membersOf(x.id) })}>
          <Row><View style={{ flex: 1 }}><T bold size={17}>{x.name}</T><T muted size={13}>{x.company || "—"} · fee {x.fee_pct}% · {membersOf(x.id).length} on site</T></View><T bold>{money(L(x.id).installed)} m²</T></Row>
          <Row wrap><Btn title="Statement" onPress={() => flows("statement", { kind: "project", target: x.name })} />{x.quote_id ? <Pill kind="acc" text="from quotation" /> : null}</Row>
        </Card>))}
      <Row><View style={{ flex: 1 }}><H2>Subcontractors</H2></View><Btn icon={<Icon name="plus" />} title="Add" onPress={() => setS({ name: "", rate: "", unit: "sqm" })} /></Row>
      <Table cols={["Name", "Rate", "Unit", "Done", "Earned", "Paid", "Balance"]} numeric={[1, 3, 4, 5, 6]}
        rows={(d.sub_ledger || []).map((x: any) => [x.name, Number(x.rate) > 0 ? money(x.rate) : "not set", x.unit, money(x.qty), money(x.earned), money(x.paid), money(Number(x.earned) - Number(x.paid))])} />
      <Row wrap>{(d.subcontractors || []).map((x: any) => <Btn key={x.id} title={`Edit ${x.name}`} onPress={() => setS(x)} />)}</Row>

      <Sheet open={!!p} onClose={() => setP(null)} title={p?.id ? "Edit project" : "New project"}>
        {p && <>
          <Field label="Project name" value={p.name} onChange={(v) => setP({ ...p, name: v })} />
          <Field label="Client" value={p.client} onChange={(v) => setP({ ...p, client: v })} />
          <Field label="Company the project is under" value={p.company} onChange={(v) => setP({ ...p, company: v })} />
          <Field label="Service fee % (charged on the amount after VAT)" value={p.fee_pct} numeric onChange={(v) => setP({ ...p, fee_pct: v })} />
          <T bold>People on this site</T>
          <Row wrap>{staff.map((u: any) => { const on = (p.members || []).includes(u.id); return <Btn key={u.id} kind={on ? "primary" : "default"} title={`${u.name} · ${u.role}`} onPress={() => setP({ ...p, members: on ? p.members.filter((m: string) => m !== u.id) : [...(p.members || []), u.id] })} />; })}</Row>
          <T size={13} muted>The fee is locked: only Super-Admin can change it, and every change is in the audit log.</T>
          {err ? <T color="#B42318">{err}</T> : null}
          <Btn big kind="primary" title="Save" busy={busy} onPress={saveProject} />
        </>}
      </Sheet>
      <Sheet open={!!s} onClose={() => setS(null)} title={s?.id ? "Edit subcontractor" : "New subcontractor"}>
        {s && <>
          <Field label="Name" value={s.name} onChange={(v) => setS({ ...s, name: v })} />
          <Row><Field label="Rate (SAR)" value={s.rate} numeric onChange={(v) => setS({ ...s, rate: v })} /><Select label="Unit" value={s.unit} onChange={(v) => setS({ ...s, unit: v })} options={["sqm", "rft", "pcs"].map((u) => ({ value: u, label: u }))} /></Row>
          <T size={13} muted>Work already reported keeps its rate. Work reported before any rate was set takes this one.</T>
          {err ? <T color="#B42318">{err}</T> : null}
          <Btn big kind="primary" title="Save" busy={busy} onPress={saveSub} />
        </>}
      </Sheet>
    </Screen>
  );
}

export function People() {
  const { d, update } = useData();
  const [f, setF] = useState<any>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const ROLE: Record<string, string> = { admin: "Super-Admin", abu: "Abu", engineer: "Engineer", supervisor: "Supervisor" };
  const add = async () => {
    setBusy(true); setErr("");
    const { data, error } = await supabase.functions.invoke("invite-user", { body: f });
    setBusy(false);
    if (error || (data as any)?.error) setErr((data as any)?.error || error!.message); else setF(null);
  };
  return (
    <Screen>
      <Row><View style={{ flex: 1 }}><H1>People</H1></View><Btn kind="primary" icon={<Icon name="plus" color="#fff" />} title="Add person" onPress={() => setF({ name: "", email: "", role: "supervisor", phone: "", projects: [] })} /></Row>
      {(d.profiles || []).map((u: any) => (
        <Card key={u.id}>
          <Row><View style={{ flex: 1 }}><T bold>{u.name}</T><T muted size={13}>{ROLE[u.role]} · {u.phone || ""}</T></View><Pill kind={u.active ? "good" : "bad"} text={u.active ? "Active" : "Off"} /></Row>
          <Btn kind="ghost" title={u.active ? "Switch off" : "Switch on"} onPress={() => update("profiles", u.id, { active: !u.active })} />
        </Card>))}
      <Sheet open={!!f} onClose={() => setF(null)} title="Add person">
        {f && <>
          <Field label="Name" value={f.name} onChange={(v) => setF({ ...f, name: v })} />
          <Field label="Email (the sign-in code goes here)" value={f.email} onChange={(v) => setF({ ...f, email: v.trim() })} />
          <Field label="Phone" value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
          <Select label="Role" value={f.role} onChange={(v) => setF({ ...f, role: v })} options={Object.entries(ROLE).map(([k, v]) => ({ value: k, label: v }))} />
          {["supervisor", "engineer"].includes(f.role) && <><T bold>Sites</T><Row wrap>{(d.projects || []).map((p: any) => { const on = f.projects.includes(p.id); return <Btn key={p.id} kind={on ? "primary" : "default"} title={p.name} onPress={() => setF({ ...f, projects: on ? f.projects.filter((x: string) => x !== p.id) : [...f.projects, p.id] })} />; })}</Row></>}
          {err ? <T color="#B42318">{err}</T> : null}
          <Btn big kind="primary" title="Add" busy={busy} disabled={!f.name || !/.+@.+\..+/.test(f.email)} onPress={add} />
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
