import { ArrowRight, Database, Play, Square, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type Overview } from "../api";
import Terminal, { type TerminalHandle } from "./Terminal";

interface Command {
  label: string;
  cmd: string;
  hint?: string;
  tone?: "danger" | "ok";
  clusterOnly?: boolean;
}

const GROUPS: { name: string; tag?: string; items: Command[] }[] = [
  {
    name: "Cluster",
    items: [
      { label: "List pods", cmd: "kubectl get pods" },
      { label: "List deployments", cmd: "kubectl get deploy" },
    ],
  },
  {
    name: "Payments",
    tag: "Java",
    items: [
      { label: "Health check", cmd: "curl -s payments:8080/actuator/health" },
      { label: "Recent logs", cmd: "kubectl logs deploy/payments --tail=15" },
      { label: "Transfers by status (SQL)", cmd: 'psql -h postgres -U loonie payments -c "select status, count(*) from transfers group by status"' },
      { label: "Open a shell", cmd: "kubectl exec -it deploy/payments -- sh", clusterOnly: true },
    ],
  },
  {
    name: "Fraud",
    tag: "Python",
    items: [
      { label: "Scoring stats", cmd: "curl -s fraud:8000/api/fraud/stats" },
      { label: "Recent logs", cmd: "kubectl logs deploy/fraud --tail=15" },
      { label: "Stop fraud", cmd: "kubectl scale deploy/fraud --replicas=0", tone: "danger", hint: "Transfers wait; nothing skips the check" },
      { label: "Start fraud", cmd: "kubectl scale deploy/fraud --replicas=1", tone: "ok", hint: "Works through the backlog" },
      { label: "Open a shell", cmd: "kubectl exec -it deploy/fraud -- sh", clusterOnly: true },
    ],
  },
  {
    name: "Compliance",
    tag: "Node.js",
    items: [
      { label: "Verify audit chain", cmd: "curl -s compliance:8081/api/compliance/audit/verify" },
      { label: "Recent logs", cmd: "kubectl logs deploy/compliance --tail=15" },
      { label: "Stop compliance", cmd: "kubectl scale deploy/compliance --replicas=0", tone: "danger" },
      { label: "Start compliance", cmd: "kubectl scale deploy/compliance --replicas=1", tone: "ok" },
    ],
  },
  {
    name: "Redis Streams",
    items: [
      { label: "Events in transfers", cmd: "redis-cli -h redis XLEN transfers" },
      { label: "Consumer groups and lag", cmd: "redis-cli -h redis XINFO GROUPS transfers" },
      { label: "Unacknowledged by fraud", cmd: "redis-cli -h redis XPENDING transfers fraud" },
    ],
  },
];

const LANG: Record<string, string> = { payments: "Java · Spring Boot", fraud: "Python · FastAPI", compliance: "Node.js · TypeScript" };

export default function Ops() {
  const terminal = useRef<TerminalHandle>(null);
  const [o, setO] = useState<Overview | null>(null);

  useEffect(() => {
    const load = () => api<Overview>("/api/ops/overview").then(setO).catch(() => setO(null));
    load();
    const i = setInterval(load, 2000);
    return () => clearInterval(i);
  }, []);

  const run = (cmd: string) => terminal.current?.run(cmd);
  const inCluster = o?.mode === "kubernetes";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Behind the scenes</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-500">
            The bank runs as three services that only talk through Redis Streams. Stop one and watch its queue grow while
            transfers wait safely, then start it again and watch the backlog drain.
            {!inCluster && " This is the demo terminal: commands hit the live services, and stopping a service pauses its consumer. Run it on Kubernetes for a real shell."}
          </p>
        </div>
        <ol className="flex flex-wrap gap-2 text-xs">
          {["Stop fraud", "Send money in Banking", "Watch the lag grow", "Start fraud"].map((s, i) => (
            <li key={s} className="flex items-center gap-1.5 rounded-full border border-ink-100 bg-white px-3 py-1.5 dark:border-ink-800 dark:bg-ink-900">
              <span className="grid h-4 w-4 place-items-center rounded-full bg-ink-900 text-[10px] font-semibold text-white dark:bg-gold-500 dark:text-ink-950">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </div>

      <div className="grid gap-4 xl:grid-cols-[260px_1fr_300px]">
        <aside className="card max-h-[620px] overflow-y-auto p-3">
          {GROUPS.map((g) => (
            <div key={g.name} className="mb-3">
              <p className="label px-2 pb-1.5 pt-2">
                {g.name} {g.tag && <span className="normal-case tracking-normal text-ink-300">· {g.tag}</span>}
              </p>
              {g.items.filter((c) => !c.clusterOnly || inCluster).map((c) => (
                <button
                  key={c.cmd}
                  onClick={() => run(c.cmd)}
                  title={c.cmd}
                  className="group w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-ink-50 dark:hover:bg-ink-800"
                >
                  <span className={`flex items-center gap-1.5 text-sm font-medium ${c.tone === "danger" ? "text-maple-600 dark:text-maple-500" : c.tone === "ok" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
                    {c.tone === "danger" ? <Square className="h-3 w-3" /> : c.tone === "ok" ? <Play className="h-3 w-3" /> : <ArrowRight className="h-3 w-3 text-ink-300 transition group-hover:translate-x-0.5" />}
                    {c.label}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-ink-400">{c.cmd}</span>
                  {c.hint && <span className="block text-[11px] text-ink-400">{c.hint}</span>}
                </button>
              ))}
            </div>
          ))}
        </aside>

        <div className="h-[620px] min-w-0">
          <Terminal ref={terminal} mode={o?.mode} />
        </div>

        <aside className="space-y-4">
          <section className="card p-4">
            <p className="label">Services</p>
            <ul className="mt-3 space-y-2.5">
              {(o?.services ?? []).map((s) => {
                const state = !s.healthy ? "down" : s.paused ? "stopped" : "up";
                return (
                  <li key={s.name} className="flex items-center gap-3 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                    <span className={`h-2.5 w-2.5 rounded-full ${state === "up" ? "bg-emerald-500 shadow-[0_0_0_4px] shadow-emerald-500/15" : state === "stopped" ? "bg-amber-500" : "bg-maple-500"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold capitalize">{s.name}</p>
                      <p className="text-[11px] text-ink-400">
                        {LANG[s.name]} · {state === "up" ? `${s.latencyMs} ms` : state === "stopped" ? "consumer stopped" : "not responding"}
                      </p>
                    </div>
                    <button
                      onClick={() => run(`kubectl scale deploy/${s.name} --replicas=${state === "up" ? 0 : 1}`)}
                      className="rounded-lg border border-ink-100 px-2 py-1 text-[11px] font-medium hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800"
                    >
                      {state === "up" ? "Stop" : "Start"}
                    </button>
                  </li>
                );
              })}
              <li className="flex items-center gap-3 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                <span className={`h-2.5 w-2.5 rounded-full ${o?.redis.healthy ? "bg-emerald-500" : "bg-maple-500"}`} />
                <div>
                  <p className="text-sm font-semibold">Redis</p>
                  <p className="text-[11px] text-ink-400">Streams between services</p>
                </div>
              </li>
            </ul>
          </section>

          <section className="card p-4">
            <p className="label">Queues</p>
            <p className="mt-1 text-[11px] text-ink-400">Lag is events waiting for a consumer group to read them.</p>
            <ul className="mt-3 space-y-3">
              {(o?.streams ?? []).map((st) => (
                <li key={st.name}>
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-xs font-medium">{st.name}</span>
                    <span className="font-mono text-[11px] text-ink-400">{st.length} events</span>
                  </div>
                  {st.groups.map((g) => {
                    const backlog = g.lag + g.pending;
                    return (
                      <div key={g.name} className="mt-1.5">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-ink-500">→ {g.name}</span>
                          <span className={`font-mono font-medium tabular-nums ${backlog > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                            {backlog > 0 ? `${g.lag} waiting · ${g.pending} in flight` : "caught up"}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                          <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${Math.min(100, backlog * 10)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <section className="card p-5">
        <p className="label flex items-center gap-1.5"><Workflow className="h-3.5 w-3.5" /> How a transfer flows</p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          {[
            ["Website", "React"],
            ["Gateway", "Node.js"],
            ["Payments", "Java · holds funds"],
            ["transfers stream", "Redis"],
          ].map(([a, b], i) => (
            <div key={a} className="flex items-center gap-2">
              {i > 0 && <ArrowRight className="h-4 w-4 text-ink-300" />}
              <div className="rounded-xl border border-ink-100 px-3 py-2 dark:border-ink-800">
                <p className="font-medium">{a}</p>
                <p className="text-[11px] text-ink-400">{b}</p>
              </div>
            </div>
          ))}
          <ArrowRight className="h-4 w-4 text-ink-300" />
          <div className="flex flex-col gap-2">
            <div className="rounded-xl border border-ink-100 px-3 py-2 dark:border-ink-800"><p className="font-medium">Fraud</p><p className="text-[11px] text-ink-400">Python · scores risk</p></div>
            <div className="rounded-xl border border-ink-100 px-3 py-2 dark:border-ink-800"><p className="font-medium">Compliance</p><p className="text-[11px] text-ink-400">Node.js · $10K + audit</p></div>
          </div>
          <ArrowRight className="h-4 w-4 text-ink-300" />
          <div className="rounded-xl border border-gold-500/40 bg-gold-500/5 px-3 py-2">
            <p className="font-medium">Payments settles</p>
            <p className="text-[11px] text-ink-400">only if both pass</p>
          </div>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-ink-400"><Database className="h-3.5 w-3.5" /> Postgres behind payments and compliance</span>
        </div>
      </section>
    </div>
  );
}
