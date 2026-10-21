export type Status = "PENDING" | "COMPLETED" | "HELD" | "REJECTED";

export interface Account {
  id: string;
  customerId: string;
  name: string;
  currency: string;
  balanceCents: number;
  heldCents: number;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  city: string;
  accounts: Account[];
}

export interface Party {
  customerId: string;
  name: string;
  accountId: string;
  accountName: string;
}

export interface Transfer {
  id: string;
  from: Party;
  to: Party;
  amountCents: number;
  currency: string;
  memo: string;
  status: Status;
  fraud: { decision: "PASS" | "HOLD"; score: number; reasons: string[] } | null;
  compliance: { decision: "CLEAR" | "REVIEW"; reason: string | null; reportId: string | null } | null;
  review: { note: string; at: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface Report {
  id: string;
  type: "LARGE_TRANSACTION" | "STRUCTURING";
  transferId: string;
  customer: string;
  amountCents: number;
  reason: string;
  createdAt: string;
}

export interface AuditEntry {
  seq: number;
  at: string;
  event: string;
  transferId: string | null;
  details: string;
  prevHash: string;
  hash: string;
}

export interface Overview {
  mode: "kubernetes" | "demo";
  services: { name: string; healthy: boolean; latencyMs: number | null; paused: boolean; stats: Record<string, any> | null }[];
  redis: { healthy: boolean };
  streams: { name: string; length: number; groups: { name: string; consumers: number; pending: number; lag: number }[] }[];
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error ?? res.statusText);
  return data as T;
}

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
