import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, Inbox, PiggyBank, Send, Sparkles, Wallet } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api, post, type Account, type Customer, type Transfer } from "../api";
import { merge, type Live } from "../live";
import { ago, Avatar, Empty, money, StatusPill } from "../ui";
import Timeline from "./Timeline";

const SCENARIOS = [
  { label: "Coffee", cents: 2_450, memo: "Coffee", note: "Clears in a second" },
  { label: "Rent share", cents: 145_000, memo: "October rent", note: "Normal, passes" },
  { label: "Car down payment", cents: 1_200_000, memo: "Car down payment", note: "Over $10,000: held for review" },
  { label: "3 × $3,500", cents: 350_000, memo: "Split payment", times: 3, note: "Adds up to $10,500: structuring check" },
] as const;

const lastDigits = (id: string) => String([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 10_000, 7)).padStart(4, "0");

function AccountIcon({ account }: { account: Account }) {
  const savings = /saving/i.test(account.name);
  return (
    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white ${savings ? "bg-gradient-to-br from-gold-400 to-gold-600" : "bg-gradient-to-br from-ink-600 to-ink-900"}`}>
      {savings ? <PiggyBank className="h-4 w-4" /> : <Wallet className="h-4 w-4" />}
    </span>
  );
}

/** A styled replacement for <select>: click or use arrow keys, Enter to choose, Esc to close. */
function AccountPicker({ accounts, value, onChange, labelledBy }: {
  accounts: Account[];
  value: string;
  onChange: (id: string) => void;
  labelledBy: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, accounts.findIndex((a) => a.id === value));
  const [active, setActive] = useState(selectedIndex);
  const root = useRef<HTMLDivElement>(null);
  const selected = accounts[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = () => {
    setActive(selectedIndex);
    setOpen((o) => !o);
  };
  const choose = (a: Account) => {
    onChange(a.id);
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") return setOpen(false);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return toggle();
      const step = e.key === "ArrowDown" ? 1 : accounts.length - 1;
      setActive((i) => (i + step) % accounts.length);
    } else if (open && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      choose(accounts[active]);
    }
  };

  if (!selected) return null;
  return (
    <div ref={root} className="relative mt-1.5" onKeyDown={onKey}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelledBy}
        className={`input flex items-center gap-3 py-2 text-left ${open ? "border-gold-500 ring-4 ring-gold-500/15" : ""}`}
      >
        <AccountIcon account={selected} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{selected.name}</span>
          <span className="block text-xs text-ink-400">
            •••• {lastDigits(selected.id)} · {money(selected.balanceCents - selected.heldCents)} available
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-labelledby={labelledBy}
          className="rise absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-ink-100 bg-white p-1 shadow-xl shadow-ink-900/10 dark:border-ink-700 dark:bg-ink-900 dark:shadow-black/40"
        >
          {accounts.map((a, i) => (
            <li
              key={a.id}
              role="option"
              aria-selected={a.id === value}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(a)}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2.5 transition ${i === active ? "bg-ink-50 dark:bg-ink-800" : ""}`}
            >
              <AccountIcon account={a} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{a.name}</span>
                <span className="block text-xs text-ink-400">
                  •••• {lastDigits(a.id)} · <span className="font-semibold tabular-nums text-ink-600 dark:text-ink-200">{money(a.balanceCents - a.heldCents)}</span> available
                </span>
              </span>
              <Check className={`h-4 w-4 shrink-0 text-gold-500 ${a.id === value ? "" : "invisible"}`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Banking({ customers, live }: { customers: Customer[]; live: Live }) {
  const [me, setMe] = useState("maya");
  const [fetched, setFetched] = useState<Transfer[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const customer = customers.find((c) => c.id === me);

  useEffect(() => {
    setFetched([]);
    api<Transfer[]>(`/api/payments/customers/${me}/transfers?limit=50`).then(setFetched).catch(() => {});
  }, [me]);

  const activity = useMemo(
    () => merge(fetched, live, (t) => t.from.customerId === me || t.to.customerId === me),
    [fetched, live, me],
  );

  if (!customer) {
    return <div className="card p-10 text-center text-ink-500">Connecting to payments…</div>;
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Signed in as (demo)</p>
          <div className="mt-2 flex gap-2">
            {customers.map((c) => (
              <button
                key={c.id}
                onClick={() => setMe(c.id)}
                title={c.name}
                className={`rounded-full p-0.5 transition ${c.id === me ? "ring-2 ring-gold-500" : "opacity-60 hover:opacity-100"}`}
              >
                <Avatar id={c.id} name={c.name} />
              </button>
            ))}
          </div>
        </div>
        <div className="sm:text-right">
          <h1 className="text-2xl font-semibold tracking-tight">Hi, {customer.name.split(" ")[0]}</h1>
          <p className="text-sm text-ink-500">{customer.city} · {customer.email}</p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {customer.accounts.map((a, i) => (
          <div
            key={a.id}
            className={`rise relative overflow-hidden rounded-2xl p-6 text-white shadow-lg ${
              i === 0 ? "bg-gradient-to-br from-ink-800 via-ink-900 to-ink-950" : "bg-gradient-to-br from-gold-500 via-gold-600 to-amber-800"
            }`}
          >
            <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
            <div className="absolute -bottom-16 right-10 h-40 w-40 rounded-full bg-white/5" />
            <div className="relative flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-white/80">{a.name}</p>
                <p className="mt-0.5 font-mono text-xs text-white/50">•••• {lastDigits(a.id)}</p>
              </div>
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs font-medium">{a.currency}</span>
            </div>
            <p className="relative mt-6 text-3xl font-semibold tabular-nums tracking-tight">{money(a.balanceCents)}</p>
            <p className="relative mt-1 text-sm text-white/70">
              Available {money(a.balanceCents - a.heldCents)}
              {a.heldCents > 0 && <span className="ml-2 rounded-md bg-amber-400/20 px-1.5 py-0.5 text-amber-100">{money(a.heldCents)} on hold</span>}
            </p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <SendMoney key={me} customer={customer} customers={customers} />

        <section className="card self-start overflow-hidden">
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4 dark:border-ink-800">
            <h2 className="font-semibold">Activity</h2>
            <span className="text-xs text-ink-400">Updates live · click a transfer for details</span>
          </div>
          {activity.length === 0 ? (
            <Empty icon={<Inbox className="h-5 w-5" />} title="No transfers yet">
              Send some money to see it move through fraud and compliance checks.
            </Empty>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {activity.map((t) => {
                const out = t.from.customerId === me;
                const other = out ? t.to : t.from;
                return (
                  <li key={t.id} className="rise">
                    <button onClick={() => setOpen(open === t.id ? null : t.id)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-ink-50/60 dark:hover:bg-ink-800/40">
                      <div className="relative">
                        <Avatar id={other.customerId} name={other.name} size="sm" />
                        <span className={`absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full ring-2 ring-white dark:ring-ink-900 ${out ? "bg-ink-700" : "bg-emerald-500"}`}>
                          {out ? <ArrowUpRight className="h-2.5 w-2.5 text-white" /> : <ArrowDownLeft className="h-2.5 w-2.5 text-white" />}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{out ? `To ${other.name}` : `From ${other.name}`}</p>
                        <p className="truncate text-xs text-ink-400">{t.memo || "No memo"} · {ago(t.createdAt)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`text-sm font-semibold tabular-nums ${t.status === "REJECTED" ? "text-ink-300 line-through" : out ? "" : "text-emerald-600 dark:text-emerald-400"}`}>
                          {out ? "−" : "+"}{money(t.amountCents)}
                        </span>
                        <StatusPill status={t.status} />
                      </div>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-ink-300 transition ${open === t.id ? "rotate-180" : ""}`} />
                    </button>
                    {open === t.id && (
                      <div className="border-t border-dashed border-ink-100 bg-ink-50/50 px-5 pb-1 pt-1 dark:border-ink-800 dark:bg-ink-950/40">
                        <Timeline t={t} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function SendMoney({ customer, customers }: { customer: Customer; customers: Customer[] }) {
  const recipients = customers.filter((c) => c.id !== customer.id);
  const [from, setFrom] = useState(customer.accounts[0]?.id ?? "");
  const [to, setTo] = useState(recipients[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const toAccount = customers.find((c) => c.id === to)?.accounts[0]?.id;
  const cents = Math.round(Number(amount.replace(/[$,\s]/g, "")) * 100);

  async function send(amountCents: number, note: string, times = 1) {
    if (!toAccount || !(amountCents > 0)) return;
    setBusy(true);
    setMsg(null);
    try {
      for (let i = 0; i < times; i++) {
        await post("/api/payments/transfers", { fromAccountId: from, toAccountId: toAccount, amountCents, memo: note });
      }
      setMsg({ ok: true, text: `Sent${times > 1 ? ` ${times} transfers of` : ""} ${money(amountCents)}. Watch it get checked in Activity.` });
      setAmount("");
      setMemo("");
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card h-fit p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Send className="h-4 w-4" /> Send money</h2>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send(cents, memo);
        }}
      >
        <div>
          <span className="label" id="from-label">From</span>
          <AccountPicker accounts={customer.accounts} value={from} onChange={setFrom} labelledBy="from-label" />
        </div>
        <div>
          <span className="label">To</span>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {recipients.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => setTo(c.id)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-xs transition ${
                  to === c.id ? "border-gold-500 bg-gold-500/5 ring-4 ring-gold-500/10" : "border-ink-100 hover:border-ink-200 dark:border-ink-800"
                }`}
              >
                <Avatar id={c.id} name={c.name} size="sm" />
                <span className="font-medium">{c.name.split(" ")[0]}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="label">Amount (CAD)</span>
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400">$</span>
            <input className="input pl-7 text-lg font-semibold tabular-nums" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </label>
        <label className="block">
          <span className="label">Memo</span>
          <input className="input mt-1.5" maxLength={140} placeholder="What's it for?" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>
        <button className="btn-primary w-full" disabled={busy || !(cents > 0)}>
          {busy ? "Sending…" : cents > 0 ? `Send ${money(cents)}` : "Send"}
        </button>
        {msg && (
          <p className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"}`}>
            {msg.text}
          </p>
        )}
      </form>

      <div className="mt-6 border-t border-ink-100 pt-5 dark:border-ink-800">
        <p className="label flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Try a scenario</p>
        <div className="mt-2.5 grid gap-2">
          {SCENARIOS.map((s) => (
            <button
              key={s.label}
              disabled={busy}
              onClick={() => void send(s.cents, s.memo, "times" in s ? s.times : 1)}
              className="flex items-center justify-between rounded-xl border border-ink-100 px-3 py-2 text-left text-sm transition hover:border-gold-500 hover:bg-gold-500/5 disabled:opacity-50 dark:border-ink-800"
            >
              <span>
                <span className="font-medium">{s.label}</span>
                <span className="block text-xs text-ink-400">{s.note}</span>
              </span>
              <span className="whitespace-nowrap font-mono text-xs tabular-nums text-ink-500">{"times" in s ? `${s.times} × ` : ""}{money(s.cents)}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
