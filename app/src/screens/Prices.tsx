// Materials and prices: filled from purchase invoices, Abu's spoken supplier rates, quotations and AI estimates.
import React, { useState } from "react";
import { View } from "react-native";
import { PRICE_STALE_DAYS } from "../config";
import { useData } from "../lib/data";
import { ageDays, matchItems, money, num } from "../lib/fmt";
import { sameMaterial } from "../lib/match";
import { ai } from "../lib/supabase";
import { Btn, Card, Empty, Field, H1, Icon, Photo, Pill, Row, Screen, Select, Sheet, T, useColors } from "../ui";

export default function Prices() {
  const { d, insert } = useData(); const c = useColors();
  const [q, setQ] = useState(""), [ids, setIds] = useState<string[] | null>(null), [why, setWhy] = useState(""), [busy, setBusy] = useState("");
  const [item, setItem] = useState<any>(null), [price, setPrice] = useState<any>(null), [err, setErr] = useState("");
  const items = d.items || [];
  // Search finds the item by any spelling: Arabic or English names, aliases, sizes in any order (60x120 = 120×60).
  const shown = ids ? items.filter((i: any) => ids.includes(i.id)) : q ? [...new Set([...matchItems(q, items).map((m) => m.item), ...items.filter((i: any) => [i.name, ...(i.aliases || [])].some((n: string) => sameMaterial(q, [n, i.size].filter(Boolean).join(" ")) >= 0.5))])] : items;
  const pricesOf = (id: string) => (d.prices || []).filter((p: any) => p.item_id === id);

  const smart = async () => { setBusy("search"); try { const r = await ai("match", { query: q, items: items.slice(0, 300).map((i: any) => ({ id: i.id, name: i.name, aliases: i.aliases, category: i.category, size: i.size })) }); setIds(r.ids || []); setWhy(r.why || ""); } catch (e: any) { setWhy(e.message); } finally { setBusy(""); } };
  const estimate = async (it: any) => { setBusy(it.id); try { const r = await ai("estimate", { name: `${it.name} ${it.size || ""} (${it.category || ""})`, unit: it.unit }); await insert("prices", { item_id: it.id, price: r.typical, low: r.low, high: r.high, note: r.note, kind: "estimate", source: "ai-estimate" }); } catch (e: any) { setWhy(e.message); } finally { setBusy(""); } };

  return (
    <Screen>
      <Row><View style={{ flex: 1 }}><H1>Materials & prices</H1></View><Btn kind="primary" icon={<Icon name="plus" color="#fff" />} title="Material" onPress={() => setItem({ name: "", aliases: "", category: "Marble", size: "", unit: "sqm" })} /></Row>
      <T muted size={13}>Prices older than {PRICE_STALE_DAYS} days turn amber: confirm them with the supplier before quoting.</T>
      <Row><Field value={q} onChange={(v) => { setQ(v); setIds(null); }} placeholder="crema 60x60, كريما, beige marble…" /><Btn title="Smart search" busy={busy === "search"} disabled={!q} onPress={smart} /></Row>
      {why ? <T muted size={13}>{why}</T> : null}
      {shown.length ? shown.map((it: any) => {
        const ps = pricesOf(it.id), cost = ps.find((p: any) => p.kind === "cost"), sell = ps.find((p: any) => p.kind === "sell"), est = ps.find((p: any) => p.kind === "estimate");
        return (
          <Card key={it.id}>
            <Row>{it.photo_path ? <Photo path={it.photo_path} /> : null}<View style={{ flex: 1 }}><T bold>{it.name}</T><T muted size={13}>{[it.category, it.size, it.unit, ...(it.aliases || [])].filter(Boolean).join(" · ")}</T></View></Row>
            <Row wrap>
              {cost ? <Pill kind={ageDays(cost.created_at) > PRICE_STALE_DAYS ? "warn" : "good"} text={`Cost ${money(cost.price)} · ${cost.supplier || cost.source} · ${ageDays(cost.created_at)}d`} /> : <Pill text="No cost yet" />}
              {sell && <Pill kind="acc" text={`Quoted ${money(sell.price)}`} />}
              {est && <Pill kind="warn" text={`AI ${money(est.low)}–${money(est.high)} · verify`} />}
            </Row>
            <Row wrap><Btn icon={<Icon name="spark" />} title="AI estimate" busy={busy === it.id} onPress={() => estimate(it)} /><Btn title="+ Price" onPress={() => setPrice({ item: it, price: "", kind: "cost", supplier: "" })} /></Row>
            {ps.length > 1 && <T size={12} muted>{ps.slice(0, 6).map((p: any) => `${money(p.price)} ${p.kind} (${p.source}${p.supplier ? ", " + p.supplier : ""})`).join(" · ")}</T>}
          </Card>);
      }) : <Empty text={q ? "No match. Try Smart search, or add the material." : "No materials yet. They are added from purchase invoices automatically."} />}

      <Sheet open={!!item} onClose={() => setItem(null)} title="New material">
        {item && <>
          <Field label="Name (English)" value={item.name} onChange={(v) => setItem({ ...item, name: v })} />
          <Field label="Other names and spellings (Arabic, Urdu, trade names), comma separated" value={item.aliases} onChange={(v) => setItem({ ...item, aliases: v })} />
          <Row><Select label="Category" value={item.category} onChange={(v) => setItem({ ...item, category: v })} options={["Marble", "Granite", "Porcelain", "Ceramic", "Civil", "Fixing", "Other"].map((x) => ({ value: x, label: x }))} /><Field label="Unit" value={item.unit} onChange={(v) => setItem({ ...item, unit: v })} /></Row>
          <Field label="Size / thickness" value={item.size} onChange={(v) => setItem({ ...item, size: v })} placeholder="60x60 · 20mm" />
          {err ? <T color={c.bad}>{err}</T> : null}
          <Btn big kind="primary" title="Save" disabled={!item.name.trim()} onPress={async () => { try { await insert("items", { ...item, aliases: item.aliases.split(/[,،]/).map((s: string) => s.trim()).filter(Boolean) }); setItem(null); } catch (e: any) { setErr(e.message); } }} />
        </>}
      </Sheet>
      <Sheet open={!!price} onClose={() => setPrice(null)} title={price ? `Price · ${price.item.name}` : ""}>
        {price && <>
          <Field label={`Price (SAR / ${price.item.unit || "unit"})`} value={price.price} numeric onChange={(v) => setPrice({ ...price, price: v })} />
          <Select label="Kind" value={price.kind} onChange={(v) => setPrice({ ...price, kind: v })} options={[{ value: "cost", label: "Cost — what we pay" }, { value: "sell", label: "Selling — what we quote" }]} />
          <Field label="Supplier / source" value={price.supplier} onChange={(v) => setPrice({ ...price, supplier: v })} />
          <Btn big kind="primary" title="Save" disabled={!(num(price.price) > 0)} onPress={async () => { await insert("prices", { item_id: price.item.id, price: num(price.price), kind: price.kind, source: "manual", supplier: price.supplier }); setPrice(null); }} />
        </>}
      </Sheet>
    </Screen>
  );
}
