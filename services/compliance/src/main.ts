/** Compliance service: screens transfers and keeps a tamper-evident audit log. */
import express from "express";
import { Redis } from "ioredis";
import { hostname } from "node:os";
import { StreamConsumer } from "./consumer.js";
import * as store from "./store.js";

const redis = new Redis({ host: process.env.REDIS_HOST ?? "localhost", port: Number(process.env.REDIS_PORT ?? 6379) });
const name = process.env.CONSUMER_NAME || hostname();
const adminToken = process.env.ADMIN_TOKEN ?? "dev-admin-token";

const screening = new StreamConsumer(redis, "transfers", "compliance", name, async (e: store.TransferRequested) => {
  const d = await store.screenTransfer(e);
  await redis.xadd("compliance.decisions", "MAXLEN", "~", 10000, "*", "type", "ComplianceDecision", "data",
    JSON.stringify({ transferId: d.transferId, decision: d.decision, reason: d.reason, reportId: d.reportId }));
  console.log(`screened transfer ${d.transferId.slice(0, 8)}: ${d.decision}${d.reason ? " - " + d.reason : ""}`);
});
const audit = new StreamConsumer(redis, "transfer.updates", "compliance-audit", name, (t) => store.auditOutcome(t));

const app = express();
const limit = (v: unknown, d = 50) => Math.max(1, Math.min(Number(v) || d, 200));

app.get("/health", async (_req, res) => {
  try {
    await Promise.all([redis.ping(), store.pool.query("select 1")]);
    res.json({ status: "UP", consumer: name, paused: screening.paused });
  } catch (err) {
    res.status(503).json({ status: "DOWN", error: (err as Error).message });
  }
});
app.get("/api/compliance/stats", async (_req, res) => res.json({ ...(await store.stats()), paused: screening.paused }));
app.get("/api/compliance/reports", async (req, res) => res.json(await store.reports(limit(req.query.limit))));
app.get("/api/compliance/audit", async (req, res) => res.json(await store.auditLog(limit(req.query.limit))));
app.get("/api/compliance/audit/verify", async (_req, res) => res.json(await store.verifyChain()));
app.post("/api/admin/consumer/:action", (req, res) => {
  if (req.get("X-Admin-Token") !== adminToken) return void res.status(403).json({ error: "admin token required" });
  if (!["pause", "resume"].includes(req.params.action)) return void res.status(404).json({ error: "use pause or resume" });
  screening.paused = req.params.action === "pause";
  console.log(`screening consumer ${screening.paused ? "paused" : "resumed"}`);
  res.json({ paused: screening.paused });
});

await waitForDatabase();
await store.migrate();
void screening.run();
void audit.run();
const port = Number(process.env.PORT ?? 8081);
app.listen(port, () => console.log(`compliance listening on :${port} as ${name}`));

async function waitForDatabase(): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await store.pool.query("select 1");
      return;
    } catch (err) {
      if (i >= 30) throw err;
      console.log("waiting for Postgres...");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
