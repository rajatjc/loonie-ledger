import { Check, Loader2, ShieldAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import type { Transfer } from "../api";
import { ScoreBar, time } from "../ui";

type State = "done" | "warn" | "fail" | "wait";

function Step({ state, title, children, last }: { state: State; title: string; children?: ReactNode; last?: boolean }) {
  const icon = {
    done: <Check className="h-3.5 w-3.5" />,
    warn: <ShieldAlert className="h-3.5 w-3.5" />,
    fail: <X className="h-3.5 w-3.5" />,
    wait: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
  }[state];
  const color = {
    done: "bg-emerald-500 text-white",
    warn: "bg-amber-500 text-white",
    fail: "bg-maple-500 text-white",
    wait: "bg-ink-100 text-ink-500 dark:bg-ink-800",
  }[state];
  return (
    <li className="relative flex gap-3 pb-4">
      {!last && <span className="absolute left-[11px] top-6 h-full w-px bg-ink-100 dark:bg-ink-800" />}
      <span className={`z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full ${color}`}>{icon}</span>
      <div className="min-w-0 pt-0.5">
        <p className="text-sm font-medium">{title}</p>
        {children && <div className="mt-1 space-y-1.5 text-sm text-ink-500">{children}</div>}
      </div>
    </li>
  );
}

/** How a transfer moved through the three services. */
export default function Timeline({ t }: { t: Transfer }) {
  const waitingLong = t.status === "PENDING" && Date.now() - Date.parse(t.createdAt) > 10_000;
  return (
    <ol className="mt-4">
      <Step state="done" title={`Requested by payments · ${time(t.createdAt)}`}>
        <p>Funds put on hold while the transfer is checked.</p>
      </Step>
      <Step
        state={!t.fraud ? "wait" : t.fraud.decision === "PASS" ? "done" : "warn"}
        title={!t.fraud ? "Fraud check running…" : t.fraud.decision === "PASS" ? "Fraud check passed" : "Fraud check flagged it"}
      >
        {t.fraud ? (
          <>
            <ScoreBar score={t.fraud.score} />
            {t.fraud.reasons.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {t.fraud.reasons.map((r) => (
                  <span key={r} className="rounded-md bg-ink-50 px-2 py-0.5 text-xs text-ink-600 dark:bg-ink-800 dark:text-ink-300">{r}</span>
                ))}
              </div>
            )}
          </>
        ) : waitingLong ? (
          <p>Still waiting. If the fraud service is stopped, the transfer stays on hold, it never skips the check.</p>
        ) : null}
      </Step>
      <Step
        state={!t.compliance ? "wait" : t.compliance.decision === "CLEAR" ? "done" : "warn"}
        title={!t.compliance ? "Compliance screening running…" : t.compliance.decision === "CLEAR" ? "Compliance screening clear" : "Compliance review required"}
      >
        {t.compliance?.reason && <p>{t.compliance.reason}</p>}
        {t.compliance?.reportId && <p className="font-mono text-xs">Report {t.compliance.reportId}</p>}
      </Step>
      <Step
        last
        state={t.status === "COMPLETED" ? "done" : t.status === "REJECTED" ? "fail" : t.status === "HELD" ? "warn" : "wait"}
        title={
          t.status === "COMPLETED" ? `Money moved · ${time(t.updatedAt)}`
            : t.status === "REJECTED" ? "Rejected, hold released"
            : t.status === "HELD" ? "Waiting for a reviewer"
            : "Settles when both checks finish"
        }
      >
        {t.review && <p>Reviewer note: “{t.review.note}”</p>}
      </Step>
    </ol>
  );
}
