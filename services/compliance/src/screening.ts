/**
 * Screening rules, modeled on FINTRAC's $10,000 reporting threshold, including
 * its 24-hour rule: several smaller transactions by the same person within 24
 * hours that add up to $10,000 or more count as one large one.
 */

export const THRESHOLD_CENTS = 1_000_000;
export const WINDOW_MS = 24 * 60 * 60 * 1000;

export type ReportType = "LARGE_TRANSACTION" | "STRUCTURING";

export interface Screening {
  decision: "CLEAR" | "REVIEW";
  reason: string | null;
  reportType: ReportType | null;
}

export function money(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * @param amountCents this transfer
 * @param earlierCents the sender's other transfers in the last 24 hours
 */
export function screen(amountCents: number, earlierCents: number[]): Screening {
  if (amountCents >= THRESHOLD_CENTS) {
    return {
      decision: "REVIEW",
      reason: `Large transaction: ${money(amountCents)} is at or above the ${money(THRESHOLD_CENTS)} threshold`,
      reportType: "LARGE_TRANSACTION",
    };
  }
  const total = earlierCents.reduce((a, b) => a + b, amountCents);
  if (total >= THRESHOLD_CENTS && earlierCents.length > 0) {
    return {
      decision: "REVIEW",
      reason: `Possible structuring: ${earlierCents.length + 1} transfers totalling ${money(total)} in 24 hours`,
      reportType: "STRUCTURING",
    };
  }
  return { decision: "CLEAR", reason: null, reportType: null };
}
