/**
 * The demo terminal: a small, safe shell that understands the sidebar commands.
 * Commands read and change the real services (stream lengths, logs, health, and
 * stopping a service's consumer); only the pod list is simulated.
 */
import { redis, SERVICES, startedAt } from "./config.js";
import { getJson, overview, setPaused, streamInfo } from "./ops.js";

const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

const POD_SUFFIX: Record<string, string> = {
  payments: "7c9d8b5f4-q2w8e", fraud: "5b6f7d9c8-k4n2p", compliance: "6d8c7b9f5-x7m3t",
};

const nl = (s: string) => s.replace(/\r?\n/g, "\r\n");

function age(): string {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  if (s < 120) return `${s}s`;
  if (s < 7200) return `${Math.floor(s / 60)}m`;
  if (s < 172800) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function table(rows: string[][]): string {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => c.padEnd(widths[i] + 3)).join("").trimEnd()).join("\n");
}

function arg(tokens: string[], name: string): string | undefined {
  for (const t of tokens) if (t.startsWith(name + "=")) return t.slice(name.length + 1);
  const i = tokens.indexOf(name);
  return i >= 0 ? tokens[i + 1] : undefined;
}

function targetService(ref: string | undefined): string | undefined {
  const name = ref?.replace(/^(deploy(ment)?(\.apps)?\/|pod\/)/, "").replace(/-[a-z0-9]+-[a-z0-9]+$/, "");
  return SERVICES.find((s) => s.name === name)?.name;
}

export const HELP = `Demo terminal. These commands run against the live services:

  kubectl get pods | deploy              what's running
  kubectl logs deploy/<service> [--tail=15]
  kubectl scale deploy/<service> --replicas=0|1
                                         stop or start a service (its event consumer)
  redis-cli -h redis XLEN <stream>       messages in a stream
  redis-cli -h redis XINFO GROUPS <stream>
  redis-cli -h redis XPENDING <stream> <group>
  curl -s <service>:<port>/<path>        e.g. curl -s fraud:8000/api/fraud/stats
  psql ... -c "select status, count(*) from transfers group by status"
  clear

Services: payments (8080), fraud (8000), compliance (8081).
Streams: transfers, fraud.decisions, compliance.decisions, transfer.updates.
For a real shell with exec into pods, run the stack on Kubernetes (see the README).`;

export async function run(line: string): Promise<string> {
  const tokens = line.trim().split(/\s+/).filter((t, i, all) => !(t === "-n" || all[i - 1] === "-n" || t.startsWith("--namespace")));
  const [cmd, sub, ...rest] = tokens;
  switch (cmd) {
    case undefined:
      return "";
    case "help":
      return HELP;
    case "clear":
      return "\x1b[2J\x1b[H";
    case "kubectl":
      return kubectl(sub, rest);
    case "redis-cli":
      return redisCli(tokens.slice(1));
    case "curl":
      return curl(tokens.slice(1));
    case "psql":
      return psql(line);
    default:
      return `${YELLOW}${cmd}: not available in the demo terminal.${RESET} Type ${GREEN}help${RESET} for what is.`;
  }
}

async function kubectl(sub: string | undefined, rest: string[]): Promise<string> {
  if (sub === "get" && /^(pods?|po)$/.test(rest[0] ?? "")) {
    const o = await overview();
    const rows = [["NAME", "READY", "STATUS", "RESTARTS", "AGE"]];
    for (const s of o.services) {
      if (s.paused) continue; // scaled to zero
      rows.push([`${s.name}-${POD_SUFFIX[s.name]}`, s.healthy ? "1/1" : "0/1", s.healthy ? "Running" : "CrashLoopBackOff", "0", age()]);
    }
    rows.push(["postgres-0", "1/1", "Running", "0", age()]);
    rows.push(["redis-0", o.redis.healthy ? "1/1" : "0/1", o.redis.healthy ? "Running" : "Error", "0", age()]);
    return table(rows);
  }
  if (sub === "get" && /^(deploy(ments?)?)$/.test(rest[0] ?? "")) {
    const o = await overview();
    const rows = [["NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"]];
    for (const s of o.services) {
      const n = s.paused ? "0" : "1";
      rows.push([s.name, `${s.paused || !s.healthy ? 0 : 1}/${n}`, n, s.healthy && !s.paused ? "1" : "0", age()]);
    }
    return table(rows);
  }
  if (sub === "scale") {
    const name = targetService(rest.find((t) => !t.startsWith("-")));
    const replicas = Number(arg(rest, "--replicas"));
    if (!name || Number.isNaN(replicas)) return "usage: kubectl scale deploy/<payments|fraud|compliance> --replicas=0|1";
    await setPaused(name, replicas === 0);
    const note = replicas === 0
      ? `\n${DIM}(demo: ${name} stopped consuming events; it restarts by itself in 2 minutes)${RESET}`
      : replicas > 1 ? `\n${DIM}(demo: runs one replica)${RESET}` : "";
    return `deployment.apps/${name} scaled${note}`;
  }
  if (sub === "logs") {
    const name = targetService(rest.find((t) => !t.startsWith("-")));
    const tail = Math.min(Number(arg(rest, "--tail")) || 15, 50);
    if (!name) return "usage: kubectl logs deploy/<payments|fraud|compliance> [--tail=15]";
    return logs(name, tail);
  }
  if (sub === "exec") {
    return `${YELLOW}exec needs a real cluster.${RESET} Run the stack on Kubernetes to open a shell inside pods (see the README).`;
  }
  return `${YELLOW}kubectl ${sub ?? ""}: not available in the demo terminal.${RESET} Type ${GREEN}help${RESET}.`;
}

async function logs(name: string, tail: number): Promise<string> {
  const svc = SERVICES.find((s) => s.name === name)!;
  try {
    if (name === "fraud") {
      const ds: any[] = await getJson(`${svc.url}/api/fraud/decisions?limit=${tail}`);
      return ds.reverse().map((d) =>
        `${d.at.slice(0, 19)} INFO fraud: scored transfer ${d.transferId.slice(0, 8)}: ${d.decision === "HOLD" ? RED : GREEN}${d.decision}${RESET} (${d.score}) ${d.reasons.join("; ")}`,
      ).join("\n") || `${DIM}no transfers scored yet${RESET}`;
    }
    if (name === "compliance") {
      const es: any[] = await getJson(`${svc.url}/api/compliance/audit?limit=${tail}`);
      return es.reverse().map((e) => `${e.at.slice(0, 19)} audit #${e.seq} ${e.event} ${e.transferId?.slice(0, 8) ?? ""} hash=${e.hash.slice(0, 12)}`)
        .join("\n") || `${DIM}audit log is empty${RESET}`;
    }
    const ts: any[] = await getJson(`${svc.url}/api/transfers?limit=${tail}`);
    return ts.reverse().map((t) =>
      `${t.updatedAt.slice(0, 19)} INFO payments: transfer ${t.id.slice(0, 8)} ${t.from.name} -> ${t.to.name} $${(t.amountCents / 100).toFixed(2)} ${t.status}`,
    ).join("\n") || `${DIM}no transfers yet${RESET}`;
  } catch {
    return `${RED}error: ${name} is not responding${RESET}`;
  }
}

async function redisCli(args: string[]): Promise<string> {
  const a = args.filter((t, i) => !(t === "-h" || args[i - 1] === "-h" || t === "-p" || args[i - 1] === "-p"));
  const [command, stream, group] = a;
  switch (command?.toUpperCase()) {
    case "PING":
      return String(await redis.ping());
    case "XLEN":
      return `(integer) ${await redis.xlen(stream ?? "")}`;
    case "XINFO": {
      const s = await streamInfo(group ?? "");
      if (!s.groups.length) return "(empty array)";
      return s.groups.map((g, i) =>
        `${i + 1}) 1) "name"\n   2) "${g.name}"\n   3) "consumers"\n   4) (integer) ${g.consumers}\n   5) "pending"\n   6) (integer) ${g.pending}\n   7) "lag"\n   8) (integer) ${g.lag}`,
      ).join("\n");
    }
    case "XPENDING": {
      const [count, lo, hi] = (await redis.xpending(stream, group)) as [number, string | null, string | null, unknown];
      return `1) (integer) ${count}\n2) ${lo ? `"${lo}"` : "(nil)"}\n3) ${hi ? `"${hi}"` : "(nil)"}`;
    }
    default:
      return `${YELLOW}redis-cli: only PING, XLEN, XINFO GROUPS and XPENDING are available in the demo terminal${RESET}`;
  }
}

async function curl(args: string[]): Promise<string> {
  const target = args.find((t) => !t.startsWith("-"));
  const m = target?.match(/^(?:https?:\/\/)?([a-z]+):(\d+)(\/[^\s]*)?$/);
  const svc = m && SERVICES.find((s) => s.name === m[1] && s.port === Number(m[2]));
  if (!m || !svc) return `${YELLOW}curl: only payments:8080, fraud:8000 and compliance:8081 are reachable from here${RESET}`;
  try {
    const res = await fetch(svc.url + (m[3] ?? "/"), { signal: AbortSignal.timeout(3000) });
    return (await res.text()).trim();
  } catch {
    return `curl: (7) Failed to connect to ${m[1]} port ${m[2]}: Connection refused`;
  }
}

async function psql(line: string): Promise<string> {
  if (!/transfers/i.test(line) || !/group by status/i.test(line)) {
    return `${YELLOW}psql: the demo terminal only runs: select status, count(*) from transfers group by status${RESET}`;
  }
  const s = await getJson(`${SERVICES[0].url}/api/stats`).catch(() => null);
  if (!s) return "psql: error: connection to server failed";
  const rows = ["PENDING", "COMPLETED", "HELD", "REJECTED"].filter((k) => s[k.toLowerCase()] > 0);
  return [" status    | count", "-----------+-------", ...rows.map((r) => ` ${r.padEnd(9)} | ${String(s[r.toLowerCase()]).padStart(5)}`),
    `(${rows.length} row${rows.length === 1 ? "" : "s"})`].join("\n");
}

export const toTerminal = nl;
