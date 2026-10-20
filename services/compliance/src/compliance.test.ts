import assert from "node:assert/strict";
import { test } from "node:test";
import { firstBroken, GENESIS, hashOf, type ChainEntry } from "./chain.js";
import { screen } from "./screening.js";

test("transfers under $10,000 are clear", () => {
  assert.deepEqual(screen(999_999, []), { decision: "CLEAR", reason: null, reportType: null });
});

test("$10,000 or more needs a large-transaction review", () => {
  const s = screen(1_200_000, []);
  assert.equal(s.decision, "REVIEW");
  assert.equal(s.reportType, "LARGE_TRANSACTION");
  assert.match(s.reason!, /\$12,000\.00/);
});

test("smaller transfers adding up to $10,000 in 24 hours look like structuring", () => {
  const s = screen(400_000, [350_000, 300_000]);
  assert.equal(s.reportType, "STRUCTURING");
  assert.match(s.reason!, /3 transfers totalling \$10,500\.00/);
  assert.equal(screen(400_000, [350_000]).decision, "CLEAR");
});

function chain(n: number): ChainEntry[] {
  const out: ChainEntry[] = [];
  let prev = GENESIS;
  for (let i = 1; i <= n; i++) {
    const at = `2026-10-18T10:00:0${i}Z`;
    const details = JSON.stringify({ amountCents: i * 100 });
    const hash = hashOf(prev, at, "TRANSFER_COMPLETED", `t${i}`, details);
    out.push({ seq: i, at, event: "TRANSFER_COMPLETED", transferId: `t${i}`, details, prevHash: prev, hash });
    prev = hash;
  }
  return out;
}

test("an untouched chain verifies", () => {
  assert.equal(firstBroken(chain(5)), null);
});

test("editing a past entry is detected at that entry", () => {
  const c = chain(5);
  c[2] = { ...c[2], details: JSON.stringify({ amountCents: 1 }) };
  assert.equal(firstBroken(c), 3);
});

test("deleting an entry is detected", () => {
  const c = chain(5);
  c.splice(1, 1);
  assert.equal(firstBroken(c), 3);
});
