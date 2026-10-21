import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, post, type Transfer } from "../api";
import { merge, type Live } from "../live";
import { ago, Avatar, Empty, money, ScoreBar, StatusPill } from "../ui";

export default function Review({ live, onChange }: { live: Live; onChange: () => void }) {
  const [held, setHeld] = useState<Transfer[]>([]);
  const [recent, setRecent] = useState<Transfer[]>([]);

  useEffect(() => {
    api<Transfer[]>("/api/payments/transfers?status=HELD&limit=100").then(setHeld).catch(() => {});
    api<Transfer[]>("/api/payments/transfers?limit=100").then(setRecent).catch(() => {});
  }, []);

  const queue = useMemo(() => merge(held, live, (t) => t.status === "HELD"), [held, live]);
  const reviewed = useMemo(() => merge(recent, live, (t) => t.review !== null).slice(0, 6), [recent, live]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-500">
          Transfers the fraud or compliance service flagged. The money stays on hold until someone on the operations team
          approves or rejects it.
        </p>
      </div>

      {queue.length === 0 ? (
        <div className="card">
          <Empty icon={<ShieldCheck className="h-5 w-5" />} title="Nothing to review">
            Try the “Car down payment” scenario in Banking: $12,000 trips both the fraud and the compliance checks.
          </Empty>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {queue.map((t) => <HeldCard key={t.id} t={t} onDone={onChange} />)}
        </div>
      )}

      {reviewed.length > 0 && (
        <section className="card overflow-hidden">
          <h2 className="border-b border-ink-100 px-5 py-4 font-semibold dark:border-ink-800">Recently reviewed</h2>
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {reviewed.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className="w-28 font-semibold tabular-nums">{money(t.amountCents)}</span>
                <span className="flex-1 truncate text-ink-500">{t.from.name} → {t.to.name} · “{t.review?.note}”</span>
                <StatusPill status={t.status} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function HeldCard({ t, onDone }: { t: Transfer; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/payments/transfers/${t.id}/${action}`, { note });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <article className="card rise flex flex-col p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar id={t.from.customerId} name={t.from.name} />
          <div>
            <p className="font-semibold">{t.from.name} → {t.to.name}</p>
            <p className="text-xs text-ink-400">“{t.memo || "No memo"}” · {ago(t.createdAt)}</p>
          </div>
        </div>
        <p className="text-xl font-semibold tabular-nums">{money(t.amountCents)}</p>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-ink-50 p-3.5 dark:bg-ink-950/60">
          <p className="label">Fraud · {t.fraud?.decision === "HOLD" ? "flagged" : "passed"}</p>
          {t.fraud && <div className="mt-2"><ScoreBar score={t.fraud.score} /></div>}
          <ul className="mt-2 space-y-1 text-xs text-ink-600 dark:text-ink-300">
            {t.fraud?.reasons.map((r) => <li key={r}>• {r}</li>)}
          </ul>
        </div>
        <div className="rounded-xl bg-ink-50 p-3.5 dark:bg-ink-950/60">
          <p className="label">Compliance · {t.compliance?.decision === "REVIEW" ? "review" : "clear"}</p>
          <p className="mt-2 text-xs text-ink-600 dark:text-ink-300">{t.compliance?.reason ?? "No concerns."}</p>
          {t.compliance?.reportId && <p className="mt-1.5 font-mono text-xs text-ink-400">Report {t.compliance.reportId}</p>}
        </div>
      </div>

      <input className="input mt-4" placeholder="Note for the audit log (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="btn-ghost" disabled={busy} onClick={() => void decide("reject")}>
          <XCircle className="h-4 w-4 text-maple-500" /> Reject
        </button>
        <button className="btn-primary" disabled={busy} onClick={() => void decide("approve")}>
          <CheckCircle2 className="h-4 w-4" /> Approve
        </button>
      </div>
    </article>
  );
}
