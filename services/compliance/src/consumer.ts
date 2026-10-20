import { Redis } from "ioredis";

type Handler = (data: any) => Promise<void>;

/**
 * Reads one stream with a consumer group. Messages are acknowledged only after
 * the handler succeeds; ones abandoned by a replica that died are claimed after
 * CLAIM_IDLE_MS. Uses its own connection, because blocking reads tie it up.
 */
export class StreamConsumer {
  static readonly CLAIM_IDLE_MS = 15_000;
  paused = false;
  private redis: Redis;
  private lastClaim = 0;

  constructor(base: Redis, readonly stream: string, readonly group: string, readonly name: string, private handler: Handler) {
    this.redis = base.duplicate();
  }

  async run(): Promise<void> {
    for (;;) {
      try {
        if (this.paused) {
          await sleep(500);
          continue;
        }
        await this.ensureGroup();
        if (Date.now() - this.lastClaim > 5_000) {
          await this.redis.xautoclaim(this.stream, this.group, this.name, StreamConsumer.CLAIM_IDLE_MS, "0-0", "COUNT", 50);
          this.lastClaim = Date.now();
        }
        // Our own unacknowledged messages first (after a crash), then new ones.
        let batch = await this.read("0", 0);
        if (!batch.length) batch = await this.read(">", 2000);
        if (this.paused) continue; // paused mid-read: leave them unacknowledged, they're redelivered on resume
        for (const [id, fields] of batch) {
          const data = JSON.parse(fields[fields.indexOf("data") + 1]);
          await this.handler(data);
          await this.redis.xack(this.stream, this.group, id);
        }
      } catch (err) {
        console.warn(`[${this.group}] error, retrying: ${(err as Error).message}`);
        await sleep(1000);
      }
    }
  }

  private async read(id: string, blockMs: number): Promise<[string, string[]][]> {
    const args: (string | number)[] = ["GROUP", this.group, this.name, "COUNT", 50];
    if (blockMs) args.push("BLOCK", blockMs);
    const res = (await (this.redis as any).xreadgroup(...args, "STREAMS", this.stream, id)) as [string, [string, string[]][]][] | null;
    return res?.[0]?.[1] ?? [];
  }

  private async ensureGroup(): Promise<void> {
    try {
      await this.redis.xgroup("CREATE", this.stream, this.group, "0", "MKSTREAM");
    } catch (err) {
      if (!String(err).includes("BUSYGROUP")) throw err;
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
