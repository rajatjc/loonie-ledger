import { ADMIN_TOKEN, redis, SERVICES, STREAMS, TERMINAL_MODE, type Service } from "./config.js";

export interface ServiceStatus {
  name: string;
  healthy: boolean;
  latencyMs: number | null;
  paused: boolean;
  stats: Record<string, unknown> | null;
}

export interface GroupInfo {
  name: string;
  consumers: number;
  pending: number;
  lag: number;
}

export interface StreamInfo {
  name: string;
  length: number;
  groups: GroupInfo[];
}

export async function getJson(url: string, timeoutMs = 2500): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

async function serviceStatus(s: Service): Promise<ServiceStatus> {
  const t0 = performance.now();
  try {
    await getJson(s.url + s.health);
    const latencyMs = Math.round(performance.now() - t0);
    const stats = await getJson(s.url + s.stats).catch(() => null);
    const paused = Boolean(stats?.paused ?? stats?.consumerPaused);
    return { name: s.name, healthy: true, latencyMs, paused, stats };
  } catch {
    return { name: s.name, healthy: false, latencyMs: null, paused: false, stats: null };
  }
}

/** XINFO GROUPS returns flat [key, value, ...] arrays; Redis 7 adds lag. */
export async function streamInfo(stream: string): Promise<StreamInfo> {
  const length = Number(await redis.xlen(stream));
  let groups: GroupInfo[] = [];
  try {
    const raw = (await redis.xinfo("GROUPS", stream)) as unknown[][];
    groups = raw.map((g) => {
      const f: Record<string, unknown> = {};
      for (let i = 0; i < g.length; i += 2) f[String(g[i])] = g[i + 1];
      return { name: String(f.name), consumers: Number(f.consumers), pending: Number(f.pending), lag: Number(f.lag ?? 0) };
    });
  } catch {
    // the stream doesn't exist yet
  }
  return { name: stream, length, groups };
}

export async function overview() {
  const services = await Promise.all(SERVICES.map(serviceStatus));
  let redisUp = true;
  let streams: StreamInfo[] = [];
  try {
    streams = await Promise.all(STREAMS.map(streamInfo));
  } catch {
    redisUp = false;
  }
  return { mode: TERMINAL_MODE, services, redis: { healthy: redisUp }, streams };
}

const autoResume = new Map<string, NodeJS.Timeout>();
export const DEMO_AUTO_RESUME_MS = 120_000;

/**
 * Pauses or resumes a service's event consumer. In demo mode this stands in for
 * scaling it to zero, and it resumes on its own after two minutes so a public
 * visitor can't leave the site broken.
 */
export async function setPaused(name: string, paused: boolean): Promise<boolean> {
  const s = SERVICES.find((x) => x.name === name);
  if (!s) throw new Error(`unknown service ${name}`);
  const res = await fetch(`${s.url}/api/admin/consumer/${paused ? "pause" : "resume"}`, {
    method: "POST",
    headers: { "X-Admin-Token": ADMIN_TOKEN },
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`${name} answered ${res.status}`);
  clearTimeout(autoResume.get(name));
  if (paused && TERMINAL_MODE === "demo") {
    autoResume.set(name, setTimeout(() => void setPaused(name, false).catch(() => {}), DEMO_AUTO_RESUME_MS));
  }
  return paused;
}
