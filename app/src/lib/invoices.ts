// Invoices the project's company raises for our work, with what was paid against each (payments carry the invoice number).
import { active } from "./data";

export type InvoiceState = "paid" | "part" | "late" | "waiting";
const key = (s: any) => String(s ?? "").trim().toLowerCase();

export function invoicesOf(d: any, pid?: string) {
  const today = new Date().toISOString().slice(0, 10);
  const income = active(d.txns || []).filter((t: any) => t.type === "income" && t.invoice_no);
  return ((d.company_invoices || []) as any[]).filter((i) => i.status !== "cancelled" && (!pid || i.project_id === pid)).map((i) => {
    const paid = income.filter((t: any) => t.project_id === i.project_id && key(t.invoice_no) === key(i.invoice_no)).reduce((s: number, t: any) => s + (Number(t.gross) || 0), 0);
    const left = Math.max(0, Math.round((Number(i.amount) - paid) * 100) / 100);
    const state: InvoiceState = left <= 0.5 ? "paid" : i.due_on && i.due_on < today ? "late" : paid > 0 ? "part" : "waiting";
    return { ...i, paid, left, state };
  }).sort((a, b) => String(b.issued_on).localeCompare(String(a.issued_on)));
}

export const STATE_LABEL: Record<InvoiceState, [string, "good" | "acc" | "bad" | "warn"]> = {
  paid: ["Paid", "good"], part: ["Part paid", "acc"], late: ["Late", "bad"], waiting: ["Waiting", "warn"],
};
