import { FileWarning, Link2, ScrollText, ShieldCheck, ShieldX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type AuditEntry, type Report } from "../api";
import type { Live } from "../live";
import { Empty, money, Stat, time } from "../ui";

interface Stats { screened: number; reviews: number; reports: number; auditEntries: number }
interface Verify { valid: boolean; entries: number; brokenAt: number | null }

const EVENT_LABEL: Record<string, string> = {
  TRANSFER_SCREENED: "Screened",
  TRANSFER_COMPLETED: "Completed",
  TRANSFER_HELD: "Held",
  TRANSFER_REJECTED: "Rejected",
};

export default function Compliance({ live }: { live: Live }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(() => {
    api<Stats>("/api/compliance/stats").then(setStats).catch(() => {});
    api<Report[]>("/api/compliance/reports?limit=20").then(setReports).catch(() => {});
    api<AuditEntry[]>("/api/compliance/audit?limit=25").then(setAudit).catch(() => {});
  }, []);

  // Reload shortly after live activity, once compliance has had a moment to write.
  const liveCount = Object.keys(live).length;
  useEffect(() => {
    const t = setTimeout(load, 400);
    return () => clearTimeout(t);
  }, [load, liveCount, live]);

  async function runVerify() {
    setChecking(true);
    try {
      setVerify(await api<Verify>("/api/compliance/audit/verify"));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Compliance</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-500">
          Every transfer is screened against a $10,000 review threshold, modeled on FINTRAC's reporting rules, including
          transfers split up to stay under it within 24 hours. Every event is written to an audit log where each entry
          carries a hash of the one before it, so editing history is detectable.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Transfers screened" value={stats?.screened ?? "–"} />
        <Stat label="Sent for review" value={stats?.reviews ?? "–"} />
        <Stat label="Reports filed" value={stats?.reports ?? "–"} hint="Large transaction or structuring" />
        <Stat label="Audit entries" value={stats?.auditEntries ?? "–"} hint="SHA-256 hash chain" />
      </div>

      <section className={`card flex flex-wrap items-center gap-4 p-5 ${verify && !verify.valid ? "ring-2 ring-maple-500" : ""}`}>
        <div className={`grid h-11 w-11 place-items-center rounded-xl ${!verify ? "bg-ink-100 text-ink-500 dark:bg-ink-800" : verify.valid ? "bg-emerald-500 text-white" : "bg-maple-500 text-white"}`}>
          {verify && !verify.valid ? <ShieldX className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
        </div>
        <div className="flex-1">
          <p className="font-semibold">
            {!verify ? "Audit chain integrity" : verify.valid ? `Chain intact: all ${verify.entries} entries verified` : `Tampering detected at entry #${verify.brokenAt}`}
          </p>
          <p className="text-sm text-ink-500">Recomputes every hash from the first entry and checks each link.</p>
        </div>
        <button className="btn-primary" onClick={() => void runVerify()} disabled={checking}>
          <Link2 className="h-4 w-4" /> {checking ? "Verifying…" : "Verify chain"}
        </button>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card overflow-hidden">
          <h2 className="flex items-center gap-2 border-b border-ink-100 px-5 py-4 font-semibold dark:border-ink-800">
            <FileWarning className="h-4 w-4" /> Reports
          </h2>
          {reports.length === 0 ? (
            <Empty icon={<FileWarning className="h-5 w-5" />} title="No reports yet">Transfers of $10,000 or more create one.</Empty>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {reports.map((r) => (
                <li key={r.id} className="px-5 py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-sm font-medium">{r.id}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.type === "STRUCTURING" ? "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"}`}>
                      {r.type === "STRUCTURING" ? "Structuring" : "Large transaction"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm">{r.customer} · <span className="font-semibold tabular-nums">{money(r.amountCents)}</span></p>
                  <p className="mt-0.5 text-xs text-ink-500">{r.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card overflow-hidden">
          <h2 className="flex items-center gap-2 border-b border-ink-100 px-5 py-4 font-semibold dark:border-ink-800">
            <ScrollText className="h-4 w-4" /> Audit log <span className="text-xs font-normal text-ink-400">newest first</span>
          </h2>
          {audit.length === 0 ? (
            <Empty icon={<ScrollText className="h-5 w-5" />} title="Nothing logged yet" />
          ) : (
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-white text-xs text-ink-400 dark:bg-ink-900">
                  <tr><th className="px-5 py-2 font-medium">#</th><th className="py-2 font-medium">Event</th><th className="py-2 font-medium">Transfer</th><th className="py-2 pr-5 font-medium">Hash ← previous</th></tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {audit.map((e) => (
                    <tr key={e.seq} className={verify?.brokenAt === e.seq ? "bg-rose-50 dark:bg-rose-500/10" : ""}>
                      <td className="px-5 py-2.5 font-mono text-xs text-ink-400">{e.seq}</td>
                      <td className="py-2.5"><span className="font-medium">{EVENT_LABEL[e.event] ?? e.event}</span><span className="block text-xs text-ink-400">{time(e.at)}</span></td>
                      <td className="py-2.5 font-mono text-xs">{e.transferId?.slice(0, 8)}</td>
                      <td className="py-2.5 pr-5 font-mono text-xs"><span className="text-ink-700 dark:text-ink-200">{e.hash.slice(0, 10)}</span><span className="text-ink-300"> ← {e.prevHash.slice(0, 6)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
