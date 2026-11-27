// Approvals & Claude: what the growth agents and Claude propose waits here for the owner's yes,
// and the owner writes here what he wants Claude to do. Only results are shown, never how an agent worked.
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { useData } from "../lib/data";
import { stamp } from "../lib/fmt";
import { supabase } from "../lib/supabase";
import { Btn, Card, DEEP, Empty, Field, Fold, H1, Pill, Rise, Row, Screen, T, Tabs, useColors, useWide } from "../ui";

export const WHO: Record<string, string> = { main: "Main agent", ranking: "Ranking agent", ideas: "Ideas agent", competitor: "Competitor agent", claude: "Claude", owner: "You" };
const brain = async (body: any) => { const { data, error } = await supabase.functions.invoke("brain", { body }); if (error) throw new Error(error.message); if ((data as any)?.error) throw new Error((data as any).error); return data as any; };

export default function Inbox() {
  const { d, reload, update, insert } = useData(); const c = useColors(); const wide = useWide();
  const rows = (d.agent_inbox || []) as any[];
  const state = ((d.preferences || []).find((p: any) => p.key === "brain_state")?.value || {}) as any;
  const waiting = rows.filter((x) => x.kind !== "request" && x.status === "waiting");
  const withClaude = rows.filter((x) => (x.kind === "request" && ["waiting", "working"].includes(x.status)) || (x.kind !== "request" && ["approved", "working"].includes(x.status)));
  const done = rows.filter((x) => ["done", "rejected"].includes(x.status)).slice(0, 30);
  const [tab, setTab] = useState("waiting"), [busy, setBusy] = useState(""), [msg, setMsg] = useState(""), [ask, setAsk] = useState(""), [open, setOpen] = useState<string | null>(null);

  const decide = async (x: any, yes: boolean) => {
    setBusy(x.id); setMsg("");
    try {
      await update("agent_inbox", x.id, { status: yes ? "approved" : "rejected", decided_at: new Date().toISOString() });
      if (yes) await brain({ action: "apply", id: x.id }).catch(() => {});
      await reload(["agent_inbox"]);
    } catch (e: any) { setMsg(e.message); }
    setBusy("");
  };
  const send = async () => {
    const text = ask.trim(); if (!text) return;
    setBusy("ask"); setMsg("");
    try { await insert("agent_inbox", { source: "owner", kind: "request", area: "company", title: text.split("\n")[0].slice(0, 120), body: text, status: "waiting" }); setAsk(""); setTab("claude"); }
    catch (e: any) { setMsg(e.message); }
    setBusy("");
  };
  const runNow = async (agent: string) => {
    setBusy(agent); setMsg("");
    try { const r = await brain({ action: "run", agent, force: true }); setMsg(r.error || r.did || "Done"); await reload(["agent_inbox", "preferences"]); }
    catch (e: any) { setMsg(e.message); }
    setBusy("");
  };

  const card = (x: any, i: number, actions: boolean) => {
    const long = String(x.body || "").length > 260, isOpen = open === x.id;
    return (
      <Rise key={x.id} i={i}>
        <Card style={{ gap: 10 }}>
          <Row style={{ alignItems: "flex-start" }}>
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: DEEP.bg, alignItems: "center", justifyContent: "center" }}><T size={15} bold color={DEEP.glow}>{(WHO[x.source] || "A").slice(0, 1)}</T></View>
            <View style={{ flex: 1, gap: 2 }}>
              <T size={12} muted>{WHO[x.source] || x.source} · {stamp(x.created_at)}</T>
              <T size={16} bold>{x.title}</T>
            </View>
            {!actions ? <Pill kind={x.status === "done" ? "good" : x.status === "rejected" ? "plain" : "warn"} text={x.status === "done" ? "Done" : x.status === "rejected" ? "Not now" : x.status === "working" ? "Claude is on it" : x.kind === "request" ? "Waiting for Claude" : "Approved, with Claude"} /> : null}
          </Row>
          {x.body && x.body !== x.title ? <Pressable disabled={!long} onPress={() => setOpen(isOpen ? null : x.id)} style={{ cursor: long ? "pointer" : "default" } as any}>
            <T size={14} numberOfLines={isOpen || !long ? undefined : 4}>{x.body}</T>
            {long ? <T size={13} bold color={c.accent}>{isOpen ? "Show less" : "Read all"}</T> : null}
          </Pressable> : null}
          {x.result ? <View style={{ backgroundColor: c.sunk, borderRadius: 12, padding: 12 }}><T size={12} muted>Result</T><T size={14}>{x.result}</T></View> : null}
          {actions ? <Row wrap>
            <Btn kind="primary" title="Approve" busy={busy === x.id} onPress={() => decide(x, true)} />
            <Btn title="Not now" disabled={busy === x.id} onPress={() => decide(x, false)} />
          </Row> : null}
        </Card>
      </Rise>
    );
  };

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <H1>Approvals & Claude</H1>
        <T muted>What the agents and Claude prepared waits for your yes. Write below what you want done.</T>
      </View>
      <Card style={{ gap: 10 }}>
        <T size={15} bold>Tell Claude what to do</T>
        <Field multiline value={ask} onChange={setAsk} placeholder="Example: Add a page for Al Narjis district. Or: check why the calculator page lost visitors this week." />
        <Row wrap><Btn kind="primary" title="Send to Claude" busy={busy === "ask"} disabled={!ask.trim()} onPress={send} /><T size={12} muted style={{ flex: 1, minWidth: 200 }}>Claude reads this list every few hours and writes the result back here. Payments, sending messages and deleting stay with you.</T></Row>
      </Card>
      {msg ? <T size={13} color={c.warn}>{msg}</T> : null}
      <Tabs value={tab} onChange={setTab} items={[{ key: "waiting", label: "Waiting for your yes", n: waiting.length }, { key: "claude", label: "With Claude", n: withClaude.length }, { key: "done", label: "Done" }, { key: "agents", label: "Growth agents" }]} />
      {tab === "waiting" ? (waiting.length ? waiting.map((x, i) => card(x, i, true)) : <Empty icon="check" title="Nothing waits for you" text="When an agent or Claude prepares something, it shows here with an Approve button." />) : null}
      {tab === "claude" ? (withClaude.length ? withClaude.map((x, i) => card(x, i, false)) : <Empty icon="inbox" title="Nothing is with Claude" text="Your requests and the proposals you approved show here until Claude finishes them." />) : null}
      {tab === "done" ? (done.length ? done.map((x, i) => card(x, i, false)) : <Empty icon="log" text="Finished items will be listed here with their result." />) : null}
      {tab === "agents" ? <>
        <View style={{ flexDirection: wide ? "row" : "column", gap: 14 }}>
          {([["ideas", "Ideas agent", "3 new ideas every day", state.last_ideas, "New ideas now"], ["ranking", "Ranking agent", "Searches close to page 1, every week", state.last_rank, "Check rankings now"], ["competitor", "Competitor agent", "Who shows for our searches, every week", state.last_comp, "Check competitors now"]] as string[][]).map(([k, name, job, at, btn]) => (
            <Card key={k} style={{ flex: 1, gap: 8 }}>
              <T size={16} bold>{name}</T><T size={13} muted>{job}</T>
              <T size={13}>{at ? `Last run ${stamp(at)}` : "Has not run yet"}</T>
              <Btn title={btn} busy={busy === k} disabled={!!busy && busy !== k} onPress={() => runNow(k)} />
            </Card>))}
        </View>
        {state.error ? <T size={13} color={c.bad}>{state.error}</T> : null}
        {(state.competitors || []).length ? <Fold title="Competitors seen on the web" sub={state.competitors_at ? stamp(state.competitors_at) : undefined} open>
          {(state.competitors as any[]).map((x, i) => (
            <View key={i} style={{ paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderColor: c.line, gap: 2 }}><T size={14} bold>{x.name}{x.site ? <T size={13} muted>  {x.site}</T> : null}</T><T size={13}>{x.strong}</T></View>))}
        </Fold> : null}
      </> : null}
    </Screen>
  );
}
