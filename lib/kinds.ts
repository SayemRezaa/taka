import type { EntryKind } from "@/db/schema";

/**
 * One place that knows what the five kinds mean.
 *
 * Before loans there were three, and each component kept its own little
 * Record of labels and colours. Adding two more broke six of them at once,
 * which is the type checker pointing out that this belonged in one file.
 */

/** Display order. Spending first, because that is what gets looked at. */
export const KIND_ORDER: EntryKind[] = [
  "expense",
  "income",
  "savings",
  "loan_in",
  "loan_out",
];

export const KIND_LABEL: Record<EntryKind, string> = {
  expense: "Money out",
  income: "Money in",
  savings: "Set aside",
  loan_in: "Loan taken",
  loan_out: "Loan repaid",
};

/** For tiles and chips, where "Money out" is too wide. */
export const KIND_SHORT: Record<EntryKind, string> = {
  expense: "Out",
  income: "In",
  savings: "Saved",
  loan_in: "Borrowed",
  loan_out: "Repaid",
};

export const KIND_HINT: Record<EntryKind, string> = {
  expense: "Money consumed — this is what counts as spending.",
  income: "Money earned or received that is yours to keep.",
  savings: "Set aside. Leaves your spendable balance but is not consumed.",
  loan_in: "Borrowed. Cash arrives, but you owe it — not income.",
  loan_out: "Repaid. Cash leaves, but settles a debt — not spending.",
};

/**
 * Does this kind add to or subtract from spendable cash?
 *
 * Borrowing and income both put money in your hand; repaying, spending and
 * setting aside all take it out. This is the whole of the "what's left"
 * calculation, which used to be an expression repeated in three files.
 */
export const KIND_SIGN: Record<EntryKind, 1 | -1> = {
  income: 1,
  loan_in: 1,
  expense: -1,
  savings: -1,
  loan_out: -1,
};

export const KIND_COLOUR: Record<EntryKind, string> = {
  expense: "var(--out)",
  income: "var(--in)",
  savings: "var(--saved)",
  loan_in: "var(--loan-in)",
  loan_out: "var(--loan-out)",
};

/** Tailwind classes, for places that style text rather than SVG. */
export const KIND_TEXT: Record<EntryKind, string> = {
  expense: "text-out",
  income: "text-in",
  savings: "text-saved",
  loan_in: "text-loan-in",
  loan_out: "text-loan-out",
};

export const KIND_BG: Record<EntryKind, string> = {
  expense: "bg-out",
  income: "bg-in",
  savings: "bg-saved",
  loan_in: "bg-loan-in",
  loan_out: "bg-loan-out",
};

export type KindTotals = Record<EntryKind, number>;

export function emptyTotals(): KindTotals {
  return { expense: 0, income: 0, savings: 0, loan_in: 0, loan_out: 0 };
}

/** What is actually left to spend, across every kind. */
export function spendableNet(totals: KindTotals): number {
  return KIND_ORDER.reduce((sum, k) => sum + KIND_SIGN[k] * totals[k], 0);
}

/**
 * Still owed: everything borrowed, less everything repaid. Can go negative
 * if you repaid loans taken before you started recording them, which is
 * worth showing rather than clamping — a negative number is the clue.
 */
export function outstandingDebt(totals: KindTotals): number {
  return totals.loan_in - totals.loan_out;
}

/**
 * Only `expense` is consumption. Savings and loan movements are excluded
 * from "where it went" percentages for the same reason: the money is not
 * gone, it has moved.
 */
export const SPENDING_KINDS: EntryKind[] = ["expense"];
