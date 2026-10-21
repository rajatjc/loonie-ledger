import { Redis } from "ioredis";

export const PORT = Number(process.env.PORT ?? 8080);
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "dev-admin-token";

/** "kubernetes" gives the terminal a real shell; "demo" runs the safe emulated one. */
export const TERMINAL_MODE: "kubernetes" | "demo" =
  (process.env.TERMINAL_MODE as "kubernetes" | "demo" | undefined) ??
  (process.env.KUBERNETES_SERVICE_HOST ? "kubernetes" : "demo");

export interface Service {
  name: "payments" | "fraud" | "compliance";
  url: string;
  health: string;
  stats: string;
  port: number;
}

export const SERVICES: Service[] = [
  { name: "payments", url: process.env.PAYMENTS_URL ?? "http://localhost:8080", health: "/actuator/health", stats: "/api/stats", port: 8080 },
  { name: "fraud", url: process.env.FRAUD_URL ?? "http://localhost:8000", health: "/health", stats: "/api/fraud/stats", port: 8000 },
  { name: "compliance", url: process.env.COMPLIANCE_URL ?? "http://localhost:8081", health: "/health", stats: "/api/compliance/stats", port: 8081 },
];

export const STREAMS = ["transfers", "fraud.decisions", "compliance.decisions", "transfer.updates"];

export const redis = new Redis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: 2,
  lazyConnect: true, // connects on first command
});
redis.on("error", () => {}); // reported through /api/ops/overview instead of crashing

export const startedAt = Date.now();
