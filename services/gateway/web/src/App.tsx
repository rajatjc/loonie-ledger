import { Building2, Landmark, ShieldCheck, TerminalSquare } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api, type Customer, type Overview, type Transfer } from "./api";
import type { Live } from "./live";
import Banking from "./views/Banking";
import Compliance from "./views/Compliance";
import Review from "./views/Review";

const Ops = lazy(() => import("./views/Ops")); // the terminal library is large; load it only when needed

const TABS = [
  { id: "banking", label: "Banking", icon: Landmark },
  { id: "review", label: "Review", icon: ShieldCheck },
  { id: "compliance", label: "Compliance", icon: Building2 },
  { id: "ops", label: "Behind the scenes", icon: TerminalSquare },
] as const;
type Tab = (typeof TABS)[number]["id"];

const fromHash = (): Tab => (TABS.find((t) => t.id === location.hash.slice(1))?.id ?? "banking");

export default function App() {
  const [tab, setTab] = useState<Tab>(fromHash);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [live, setLive] = useState<Live>({});
  const [held, setHeld] = useState(0);
  const [health, setHealth] = useState<Overview | null>(null);
  const [connected, setConnected] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const refresh = useCallback(() => {
    api<Customer[]>("/api/payments/customers").then(setCustomers).catch(() => {});
    api<Transfer[]>("/api/payments/transfers?status=HELD&limit=200").then((t) => setHeld(t.length)).catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  // One live stream for the whole app; balances refresh shortly after each update.
  useEffect(() => {
    const es = new EventSource("/api/live");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      const t: Transfer = JSON.parse(e.data);
      setLive((prev) => ({ ...prev, [t.id]: t }));
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(refresh, 250);
    };
    return () => es.close();
  }, [refresh]);

  useEffect(() => {
    const load = () => api<Overview>("/api/ops/overview").then(setHealth).catch(() => setHealth(null));
    load();
    const i = setInterval(load, 10_000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const onHash = () => setTab(fromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (t: Tab) => {
    history.replaceState(null, "", `#${t}`);
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  const down = health ? health.services.filter((s) => !s.healthy || s.paused).map((s) => s.name) : [];
  const allGood = health && connected && down.length === 0 && health.redis.healthy;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-ink-100 bg-white/85 backdrop-blur dark:border-ink-800 dark:bg-ink-950/85">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <a href="#banking" onClick={() => go("banking")} className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-gold-300 to-gold-600 text-sm font-bold text-white shadow-inner ring-2 ring-gold-400/30">
              L
            </div>
            <div className="leading-tight">
              <p className="font-semibold tracking-tight">Loonie Ledger</p>
              <p className="text-[11px] text-ink-400">Demo neobank · not a real bank</p>
            </div>
          </a>
          <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => go(id)}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition ${
                  tab === id ? "bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900" : "text-ink-500 hover:bg-ink-100 hover:text-ink-900 dark:hover:bg-ink-800 dark:hover:text-ink-50"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
                {id === "review" && held > 0 && (
                  <span className="rounded-full bg-maple-500 px-1.5 text-[11px] font-semibold text-white">{held}</span>
                )}
              </button>
            ))}
          </nav>
          <button onClick={() => go("ops")} className="ml-auto flex items-center gap-2 rounded-full border border-ink-100 px-3 py-1.5 text-xs text-ink-500 dark:border-ink-800">
            <span className={`h-2 w-2 rounded-full ${allGood ? "bg-emerald-500" : health ? "bg-amber-500" : "bg-ink-300"}`} />
            {allGood ? "All systems operational" : health ? `Degraded: ${down.join(", ") || (connected ? "redis" : "live updates")}` : "Checking systems…"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {tab === "banking" && <Banking customers={customers} live={live} />}
        {tab === "review" && <Review live={live} onChange={refresh} />}
        {tab === "compliance" && <Compliance live={live} />}
        {tab === "ops" && (
          <Suspense fallback={<div className="card p-10 text-center text-ink-500">Loading the console…</div>}>
            <Ops />
          </Suspense>
        )}
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-10 text-xs text-ink-400 sm:px-6">
        Three services (Java payments, Python fraud, Node.js compliance) connected by Redis Streams.{" "}
        <a className="underline hover:text-ink-600" href="https://github.com/rajatjc/loonie-ledger">Source on GitHub</a>
      </footer>
    </div>
  );
}
