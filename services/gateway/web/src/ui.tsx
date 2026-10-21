import { CheckCircle2, Clock, ShieldAlert, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { Status } from "./api";

const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
export const money = (cents: number) => cad.format(cents / 100);

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

export const time = (iso: string) => new Date(iso).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", second: "2-digit" });

const AVATAR_COLORS: Record<string, string> = {
  maya: "from-rose-400 to-maple-500",
  liam: "from-sky-400 to-indigo-500",
  aisha: "from-emerald-400 to-teal-600",
  noah: "from-gold-400 to-orange-500",
};

export function Avatar({ id, name, size = "md" }: { id: string; name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name.split(" ").map((p) => p[0]).join("").slice(0, 2);
  const dims = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-12 w-12 text-base" }[size];
  return (
    <div className={`${dims} grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-semibold text-white ${AVATAR_COLORS[id] ?? "from-ink-400 to-ink-600"}`}>
      {initials}
    </div>
  );
}

const STATUS: Record<Status, { label: string; cls: string; icon: ReactNode }> = {
  PENDING: { label: "Checking", cls: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30", icon: <Clock className="h-3.5 w-3.5 animate-pulse" /> },
  COMPLETED: { label: "Completed", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  HELD: { label: "Held for review", cls: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30", icon: <ShieldAlert className="h-3.5 w-3.5" /> },
  REJECTED: { label: "Rejected", cls: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30", icon: <XCircle className="h-3.5 w-3.5" /> },
};

export function StatusPill({ status }: { status: Status }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}>
      {s.icon}
      {s.label}
    </span>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const color = score >= 60 ? "bg-maple-500" : score >= 30 ? "bg-gold-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span className="font-mono text-xs tabular-nums text-ink-500">{score}/100</span>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-ink-100 text-ink-400 dark:bg-ink-800">{icon}</div>
      <p className="font-semibold">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-ink-500">{children}</p>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card p-5">
      <p className="label">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}
