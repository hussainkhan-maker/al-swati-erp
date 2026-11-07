// What every AI agent and code check is doing, in one place. Each agent's numbers are counted from the real data.
import React from "react";
import { View } from "react-native";
import { active, useData } from "../lib/data";
import { ageDays, stamp } from "../lib/fmt";
import { Card, Checks, H1, H2, Icon, Pill, Row, Screen, T, useColors } from "../ui";

export default function Agents() {
  const { d } = useData(); const c = useColors();
  const inq = d.inquiries || [], tx = active(d.txns), pr = active(d.progress), reqs = d.supplier_requests || [], rep = (d.agent_reports || [])[0];
  const flagged = [...tx, ...pr].filter((x: any) => (x.flags || []).length);
  const noRate = (d.subcontractors || []).filter((s: any) => !(Number(s.rate) > 0));
  const stale = (d.prices || []).filter((p: any) => p.kind === "cost" && ageDays(p.created_at) > 30);
  const waiting = reqs.filter((r: any) => r.status === "Sent" && ageDays(r.sent_at) >= 2);
  const blankQuotes = (d.quotes || []).filter((q: any) => ["Draft", "Abu Review"].includes(q.status) && (q.lines || []).some((l: any) => !(Number(l.rate) > 0)));

  const A = ({ icon, name, job, status, s }: { icon: string; name: string; job: string; status: string; s: "good" | "warn" | "bad" }) => (
    <Card>
      <Row><Icon name={icon} color={c.accent} /><View style={{ flex: 1 }}><T bold>{name}</T><T muted size={13}>{job}</T></View><Pill kind={s} text={s === "good" ? "OK" : s === "warn" ? "Check" : "Action"} /></Row>
      <T>{status}</T>
    </Card>
  );
  return (
    <Screen>
      <H1>AI agents</H1>
      <T muted>AI reads and suggests. Code does every sum and blocks anything red. You approve.</T>
      <A icon="inbox" name="Intake agent" job="Takes queries from Gmail and the website, saves files, drops repeats" s={inq.some((q: any) => q.status === "New") ? "warn" : "good"} status={`${inq.length} queries · ${inq.filter((q: any) => q.status === "New").length} not reviewed yet`} />
      <A icon="spark" name="Reading agents (two)" job="Two different AI models read each BOQ separately; code compares them line by line" s="good" status={`${inq.filter((q: any) => q.reading).length} queries read twice`} />
      <A icon="check" name="Checking agents (code)" job="Digits, sums, VAT 15%, splits = 100%, receipt photo, project, units, PDF re-read" s={flagged.length ? "warn" : "good"} status={`${flagged.length} saved entries carry a warning someone accepted`} />
      <A icon="tag" name="Price agent" job="Suggests rates from invoices, Abu's rates and past quotations; flags old prices" s={blankQuotes.length || stale.length ? "warn" : "good"} status={`${blankQuotes.length} quotations with blank rates · ${stale.length} prices older than 30 days`} />
      <A icon="truck" name="Supplier agent" job="Writes price requests in each supplier's language and follows up" s={waiting.length ? "warn" : "good"} status={`${reqs.filter((r: any) => r.status === "Sent").length} waiting · ${waiting.length} silent for 2+ days`} />
      <A icon="ruler" name="Site agent" job="Turns spoken meters into project, subcontractor and engineer records" s={noRate.length ? "bad" : "good"} status={`${pr.length} progress entries · ${noRate.length} subcontractors without a rate`} />
      <Card>
        <Row><Icon name="spark" color={c.accent} /><H2>Main agent · morning report</H2></Row>
        {rep ? <><T size={16}>{rep.summary}</T><Checks list={(rep.items || []).slice(0, 20).map((i: any) => ({ s: i.level, text: i.text }))} /><T size={12} muted>{stamp(rep.created_at)}</T></> : <T muted>No report yet. It runs every day at 07:00 once the schedule is switched on (see the setup guide).</T>}
      </Card>
    </Screen>
  );
}
