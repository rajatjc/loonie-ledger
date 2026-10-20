import pg from "pg";
import { firstBroken, GENESIS, hashOf, type ChainEntry } from "./chain.js";
import { screen, WINDOW_MS, type Screening } from "./screening.js";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://loonie:loonie@localhost:5432/compliance",
  max: 5,
});

export async function migrate(): Promise<void> {
  await pool.query(`
    create table if not exists screened_transfers (
      transfer_id  text primary key,
      customer_id  text not null,
      amount_cents bigint not null,
      created_at   timestamptz not null,
      decision     text not null,
      reason       text,
      report_id    text
    );
    create index if not exists screened_by_customer on screened_transfers (customer_id, created_at);
    create table if not exists reports (
      id           text primary key,
      type         text not null,
      transfer_id  text not null,
      customer_id  text not null,
      customer     text not null,
      amount_cents bigint not null,
      reason       text not null,
      created_at   timestamptz not null default now()
    );
    create sequence if not exists report_seq;
    create table if not exists audit_log (
      seq         bigserial primary key,
      at          text not null,
      event       text not null,
      transfer_id text,
      details     text not null,
      prev_hash   text not null,
      hash        text not null
    );
    create table if not exists audited_status (
      transfer_id text not null,
      status      text not null,
      primary key (transfer_id, status)
    );`);
}

export interface TransferRequested {
  transferId: string;
  fromCustomerId: string;
  fromCustomerName: string;
  toCustomerName: string;
  amountCents: number;
  createdAt: string;
}

export interface Decision extends Screening {
  transferId: string;
  reportId: string | null;
}

/** Screens a transfer exactly once; a redelivered event gets the stored decision back. */
export async function screenTransfer(e: TransferRequested): Promise<Decision> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // One sender at a time, so two concurrent transfers can't both slip under the 24-hour total.
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [e.fromCustomerId]);
    const existing = await client.query("select decision, reason, report_id from screened_transfers where transfer_id = $1", [e.transferId]);
    if (existing.rowCount) {
      await client.query("commit");
      const r = existing.rows[0];
      return { transferId: e.transferId, decision: r.decision, reason: r.reason, reportType: null, reportId: r.report_id };
    }
    const earlier = await client.query(
      "select amount_cents from screened_transfers where customer_id = $1 and created_at > $2",
      [e.fromCustomerId, new Date(Date.parse(e.createdAt) - WINDOW_MS)]);
    const s = screen(Number(e.amountCents), earlier.rows.map((r) => Number(r.amount_cents)));
    let reportId: string | null = null;
    if (s.reportType) {
      const n = (await client.query("select nextval('report_seq') as n")).rows[0].n;
      reportId = `${s.reportType === "LARGE_TRANSACTION" ? "LTR" : "STR"}-${String(n).padStart(5, "0")}`;
      await client.query(
        "insert into reports (id, type, transfer_id, customer_id, customer, amount_cents, reason) values ($1, $2, $3, $4, $5, $6, $7)",
        [reportId, s.reportType, e.transferId, e.fromCustomerId, e.fromCustomerName, e.amountCents, s.reason]);
    }
    await client.query(
      "insert into screened_transfers values ($1, $2, $3, $4, $5, $6, $7)",
      [e.transferId, e.fromCustomerId, e.amountCents, e.createdAt, s.decision, s.reason, reportId]);
    await appendAudit(client, "TRANSFER_SCREENED", e.transferId, {
      from: e.fromCustomerName, to: e.toCustomerName, amountCents: e.amountCents, decision: s.decision, reason: s.reason, reportId,
    });
    await client.query("commit");
    return { transferId: e.transferId, ...s, reportId };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/** Records a transfer's final outcome in the audit log, once per status. */
export async function auditOutcome(t: { id: string; status: string; amountCents: number; review?: { note: string } | null }): Promise<void> {
  if (!["COMPLETED", "HELD", "REJECTED"].includes(t.status)) return;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const fresh = await client.query("insert into audited_status values ($1, $2) on conflict do nothing", [t.id, t.status]);
    if (fresh.rowCount) {
      await appendAudit(client, `TRANSFER_${t.status}`, t.id, { amountCents: t.amountCents, reviewNote: t.review?.note ?? null });
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

async function appendAudit(client: pg.PoolClient, event: string, transferId: string | null, details: object): Promise<void> {
  await client.query("select pg_advisory_xact_lock(42)"); // one writer extends the chain at a time
  const last = await client.query("select hash from audit_log order by seq desc limit 1");
  const prevHash = last.rowCount ? last.rows[0].hash : GENESIS;
  const at = new Date().toISOString();
  const body = JSON.stringify(details);
  await client.query("insert into audit_log (at, event, transfer_id, details, prev_hash, hash) values ($1, $2, $3, $4, $5, $6)",
    [at, event, transferId, body, prevHash, hashOf(prevHash, at, event, transferId, body)]);
}

function toEntry(r: Record<string, unknown>): ChainEntry {
  return {
    seq: Number(r.seq), at: String(r.at), event: String(r.event), transferId: (r.transfer_id as string) ?? null,
    details: String(r.details), prevHash: String(r.prev_hash), hash: String(r.hash),
  };
}

export async function auditLog(limit: number): Promise<ChainEntry[]> {
  const r = await pool.query("select * from audit_log order by seq desc limit $1", [limit]);
  return r.rows.map(toEntry);
}

export async function verifyChain(): Promise<{ valid: boolean; entries: number; brokenAt: number | null }> {
  const r = await pool.query("select * from audit_log order by seq");
  const brokenAt = firstBroken(r.rows.map(toEntry));
  return { valid: brokenAt === null, entries: r.rowCount ?? 0, brokenAt };
}

export async function reports(limit: number) {
  const r = await pool.query("select * from reports order by created_at desc limit $1", [limit]);
  return r.rows.map((x) => ({
    id: x.id, type: x.type, transferId: x.transfer_id, customerId: x.customer_id, customer: x.customer,
    amountCents: Number(x.amount_cents), reason: x.reason, createdAt: x.created_at,
  }));
}

export async function stats() {
  const r = await pool.query(`select
      (select count(*) from screened_transfers) as screened,
      (select count(*) from screened_transfers where decision = 'REVIEW') as reviews,
      (select count(*) from reports) as reports,
      (select count(*) from audit_log) as audit_entries`);
  const x = r.rows[0];
  return { screened: Number(x.screened), reviews: Number(x.reviews), reports: Number(x.reports), auditEntries: Number(x.audit_entries) };
}
