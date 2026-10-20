import { createHash } from "node:crypto";

/**
 * A tamper-evident chain: each entry's hash covers its own content and the
 * previous entry's hash. Changing any past entry breaks every hash after it.
 */
export const GENESIS = "0".repeat(64);

export interface ChainEntry {
  seq: number;
  at: string;
  event: string;
  transferId: string | null;
  details: string;
  prevHash: string;
  hash: string;
}

export function hashOf(prevHash: string, at: string, event: string, transferId: string | null, details: string): string {
  return createHash("sha256")
    .update(JSON.stringify([prevHash, at, event, transferId, details]))
    .digest("hex");
}

/** Returns the seq of the first entry that doesn't check out, or null if the chain is intact. */
export function firstBroken(entries: ChainEntry[]): number | null {
  let prev = GENESIS;
  for (const e of entries) {
    if (e.prevHash !== prev || e.hash !== hashOf(e.prevHash, e.at, e.event, e.transferId, e.details)) {
      return e.seq;
    }
    prev = e.hash;
  }
  return null;
}
