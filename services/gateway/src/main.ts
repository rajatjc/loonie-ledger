/**
 * Gateway: serves the website, proxies the three services' APIs, streams live
 * transfer updates, and hosts the ops console.
 */
import express, { type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { PORT, redis, SERVICES, TERMINAL_MODE } from "./config.js";
import { overview, setPaused } from "./ops.js";
import { wss } from "./terminal.js";

const app = express();
app.disable("x-powered-by");

function proxy(base: string, apiPrefix: string, servicePrefix: string, name: string) {
  return async (req: Request, res: Response) => {
    const url = base + servicePrefix + req.originalUrl.slice(apiPrefix.length);
    try {
      const hasBody = !["GET", "HEAD"].includes(req.method) && Buffer.isBuffer(req.body) && req.body.length > 0;
      const upstream = await fetch(url, {
        method: req.method,
        headers: { "content-type": req.get("content-type") ?? "application/json" },
        body: hasBody ? req.body : undefined,
        signal: AbortSignal.timeout(10_000),
      });
      res.status(upstream.status);
      const type = upstream.headers.get("content-type");
      if (type) res.set("content-type", type);
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      res.status(502).json({ error: `${name} is unavailable right now` });
    }
  };
}

const raw = express.raw({ type: "*/*", limit: "64kb" });
const [payments, fraud, compliance] = SERVICES;
app.use("/api/payments", raw, proxy(payments.url, "/api/payments", "/api", "payments"));
app.use("/api/fraud", raw, proxy(fraud.url, "/api/fraud", "/api/fraud", "fraud"));
app.use("/api/compliance", raw, proxy(compliance.url, "/api/compliance", "/api/compliance", "compliance"));

app.get("/health", (_req, res) => res.json({ status: "UP", terminal: TERMINAL_MODE }));
app.get("/api/ops/overview", async (_req, res) => res.json(await overview()));

let lastToggle = 0;
app.post("/api/ops/services/:name/:action", async (req, res) => {
  const { name, action } = req.params;
  if (!["pause", "resume"].includes(action)) return void res.status(404).json({ error: "use pause or resume" });
  if (Date.now() - lastToggle < 1000) return void res.status(429).json({ error: "slow down" });
  lastToggle = Date.now();
  try {
    res.json({ name, paused: await setPaused(name, action === "pause") });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Live transfer updates: one Redis reader fans out to every open browser tab.
const listeners = new Set<Response>();
app.get("/api/live", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write(": connected\n\n");
  listeners.add(res);
  req.on("close", () => listeners.delete(res));
});
setInterval(() => listeners.forEach((r) => r.write(": keep-alive\n\n")), 20_000);

async function tailUpdates(): Promise<void> {
  const reader = redis.duplicate();
  reader.on("error", () => {});
  let last = "$";
  for (;;) {
    try {
      const res = (await reader.xread("BLOCK", 5000, "STREAMS", "transfer.updates", last)) as [string, [string, string[]][]][] | null;
      for (const [, messages] of res ?? []) {
        for (const [id, fields] of messages) {
          last = id;
          const data = fields[fields.indexOf("data") + 1];
          listeners.forEach((r) => r.write(`data: ${data}\n\n`));
        }
      }
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

const staticDir = resolve(process.env.STATIC_DIR ?? "web/dist");
if (existsSync(staticDir)) {
  app.use(express.static(staticDir, { maxAge: "1h", index: false }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(resolve(staticDir, "index.html")));
}

const server = createServer(app);
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/api/ops/terminal") wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  else socket.destroy();
});
server.listen(PORT, () => console.log(`gateway on :${PORT}, terminal mode: ${TERMINAL_MODE}`));
void tailUpdates();
