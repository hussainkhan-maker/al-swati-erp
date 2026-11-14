// Invoices the project's company raises for our work, with what was paid against each (payments carry the invoice number).
// The company never says up front when or how much it will pay, so an open invoice is judged by how long we have waited;
// a date is only added later, when they promise one ("the rest next week").
import { active } from "./data";
import { day } from "./fmt";

export type InvoiceState = "paid" | "part" | "waiting" | "slow" | "late" | "missed";
const key = (s: any) => String(s ?? "").trim().toLowerCase();
const r2 = (n: number) => Math.round(n * 100) / 100;

export function invoicesOf(d: any, pid?: string) {
  const today = new Date().toISOString().slice(0, 10);
  const income = active(d.txns || []).filter((t: any) => t.type === "income" && t.invoice_no);
  return ((d.company_invoices || []) as any[]).filter((i) => i.status !== "cancelled" && (!pid || i.project_id === pid)).map((i) => {
    const paid = income.filter((t: any) => t.project_id === i.project_id && key(t.invoice_no) === key(i.invoice_no)).reduce((s: number, t: any) => s + (Number(t.gross) || 0), 0);
    const left = Math.max(0, r2(Number(i.amount) - paid));
    const age = Math.max(0, Math.floor((Date.parse(today) - Date.parse(String(i.issued_on))) / 864e5)) || 0;
    const state: InvoiceState = left <= 0.5 ? "paid" : i.due_on && i.due_on < today ? "missed" : age > 60 ? "late" : age > 30 ? "slow" : paid > 0 ? "part" : "waiting";
    return { ...i, paid, left, age, state };
  }).sort((a, b) => String(b.issued_on).localeCompare(String(a.issued_on)));
}

/** Open invoices of a project, oldest first: a payment that names no invoice goes to the first one. */
export const openOldestFirst = (d: any, pid: string) => invoicesOf(d, pid).filter((v) => v.left > 0.5).sort((a, b) => String(a.issued_on).localeCompare(String(b.issued_on)));

/** One payment over several invoices: the chosen invoice first, then the oldest open ones; anything left over is not linked. */
export function spread(open: any[], first: string, amount: number) {
  const order = [...open.filter((v) => v.invoice_no === first), ...open.filter((v) => v.invoice_no !== first)];
  const out: { invoice_no: string | null; amount: number }[] = [];
  let rest = r2(amount);
  for (const v of order) {
    if (rest <= 0.005) break;
    const take = r2(Math.min(rest, v.left));
    if (take > 0.005) { out.push({ invoice_no: v.invoice_no, amount: take }); rest = r2(rest - take); }
  }
  if (rest > 0.005) out.push({ invoice_no: null, amount: rest });
  return out;
}

export const STATE_LABEL: Record<InvoiceState, [string, "good" | "acc" | "bad" | "warn" | "plain"]> = {
  paid: ["Paid", "good"], part: ["Part paid", "acc"], waiting: ["Waiting", "plain"], slow: ["Over 30 days", "warn"], late: ["Over 60 days", "bad"], missed: ["Promise missed", "bad"],
};
/** How long we have waited, in words, plus the promise if they gave one. */
export const waitText = (v: any) => v.left <= 0.5 ? "Fully paid" : `Waiting ${v.age} day${v.age === 1 ? "" : "s"}${v.due_on ? v.state === "missed" ? `, promised ${day(v.due_on)} (missed)` : `, promised ${day(v.due_on)}` : ""}`;
