// Supervisor (Urdu): speak the meters, record expenses with a receipt, see the week, share reports. No company money.
import React from "react";
import { View } from "react-native";
import { useFlows } from "../components/Flows";
import { active, pname, useData } from "../lib/data";
import { day, money, r2, SAR } from "../lib/fmt";
import { Lang } from "../lib/i18n";
import { Btn, Card, Empty, H1, H2, Kpi, Photo, Row, Screen, Select, T, Tile } from "../ui";

export function Home() {
  const { d, profile, t, lang, setLang } = useData(); const flows = useFlows();
  return (
    <Screen>
      <H1>{lang === "ur" ? "السلام علیکم" : lang === "ar" ? "السلام عليكم" : "Hello"} {profile.name}</H1>
      <T muted>{(d.projects || []).map((p: any) => p.name).join("، ") || t("nothing")}</T>
      <Tile accent icon="mic" title={lang === "ur" ? "کام بولیں" : t("speak")} sub="«ملقا: عباس 40، سہیل 30، عزیر 50 میٹر فلورنگ»" onPress={() => flows("speak")} />
      <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 12 }}>
        <Tile icon="receipt" title={t("purchase")} sub={t("ck_photo")} onPress={() => flows("purchase")} />
        <Tile icon="doc" title={t("report")} sub="PDF" onPress={() => flows("statement")} />
        <Tile icon="spark" title={lang === "ur" ? "مددگار سے پوچھیں" : "Ask"} sub={lang === "ur" ? "«عزیر نے کتنا کام کیا؟»" : ""} onPress={() => flows("ask")} />
      </View>
      <Card>
        <T bold>{lang === "ur" ? "طریقہ" : "How to"}</T>
        <T>1. سبز بٹن دبائیں اور بولیں کس نے کتنے میٹر کام کیا۔</T>
        <T>2. «سمجھو» دبائیں۔ فون آپ کو سنائے گا کہ اس نے کیا سمجھا۔</T>
        <T>3. صحیح ہو تو «ہاں، محفوظ کریں»۔ غلط ہو تو دوبارہ بولیں۔</T>
        <T>4. ہر خرچے کے ساتھ رسید کی تصویر ضروری ہے۔</T>
      </Card>
      <Select label="زبان / Language" value={lang} onChange={(v: Lang) => setLang(v)} options={[{ value: "ur", label: "اردو" }, { value: "ar", label: "العربية" }, { value: "en", label: "English" }]} />
    </Screen>
  );
}

export function Week() {
  const { d, t, profile } = useData();
  const since = Date.now() - 7 * 864e5;
  const ex = active(d.txns).filter((x: any) => Date.parse(x.created_at) >= since);
  const pr = active(d.progress).filter((x: any) => x.created_by === profile.id && Date.parse(x.created_at) >= since);
  const tot = r2(ex.reduce((s: number, x: any) => s + Number(x.total ?? x.amount ?? 0), 0));
  const work: Record<string, number> = {}; pr.forEach((x: any) => { const k = `${x.work || ""} (${x.unit})`; work[k] = r2((work[k] || 0) + Number(x.qty)); });
  return (
    <Screen>
      <H1>{t("week")}</H1>
      <Kpi hero label={`${ex.length} خرچے`} value={SAR(tot)} />
      <H2>{t("work")}</H2>
      {Object.keys(work).length ? Object.entries(work).map(([k, v]) => <Card key={k}><Row><T style={{ flex: 1 }}>{k}</T><T bold>{money(v)}</T></Row></Card>) : <Empty text={t("nothing")} />}
      <H2>خرچے</H2>
      {ex.map((x: any) => <Card key={x.id}><Row><Photo path={x.receipt_path} /><View style={{ flex: 1 }}><T bold>{x.supplier || x.description || ""}</T><T muted size={13}>{pname(d, x.project_id)} · {day(x.created_at)}</T></View><T bold>{money(x.total ?? x.amount)}</T></Row></Card>)}
    </Screen>
  );
}

export function Report() {
  const { d, t } = useData(); const flows = useFlows();
  return (
    <Screen>
      <H1>{t("report")}</H1>
      {(d.projects || []).map((p: any) => {
        const pr = active(d.progress).filter((x: any) => x.project_id === p.id);
        const by: Record<string, number> = {}; pr.forEach((x: any) => { by[x.sub_name] = r2((by[x.sub_name] || 0) + Number(x.qty)); });
        return (
          <Card key={p.id}>
            <Row><T bold size={17} style={{ flex: 1 }}>{p.name}</T><T bold>{money(r2(pr.reduce((s: number, x: any) => s + Number(x.qty), 0)))} m²</T></Row>
            {Object.entries(by).map(([k, v]) => <Btn key={k} title={`${k} · ${money(v)}`} onPress={() => flows("statement", { kind: "sub", target: k })} />)}
            <Btn kind="primary" title={t("pdf")} onPress={() => flows("statement", { kind: "project", target: p.name })} />
          </Card>);
      })}
    </Screen>
  );
}
