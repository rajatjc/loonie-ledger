"""Consumes TransferRequested events, scores them, and publishes verdicts.

Uses a Redis consumer group, so several replicas share the work. A message is
acknowledged only after its verdict is published. Messages left unacknowledged
by a replica that died are claimed by another one after CLAIM_IDLE_MS.
"""

import asyncio
import json
import logging
import time
from datetime import datetime

from redis.asyncio import Redis
from redis.exceptions import ResponseError

from . import rules

log = logging.getLogger("fraud")

IN_STREAM = "transfers"
OUT_STREAM = "fraud.decisions"
GROUP = "fraud"
CLAIM_IDLE_MS = 15_000
VELOCITY_WINDOW_MS = 120_000


class FraudConsumer:
    def __init__(self, redis: Redis, name: str):
        self.redis = redis
        self.name = name
        self.paused = False

    async def run(self) -> None:
        last_claim = 0.0
        while True:
            try:
                if self.paused:
                    await asyncio.sleep(0.5)
                    continue
                await self._ensure_group()
                if time.monotonic() - last_claim > 5:
                    await self._claim_abandoned()
                    last_claim = time.monotonic()
                # Our own unacknowledged messages first (after a crash), then new ones.
                batch = await self.redis.xreadgroup(GROUP, self.name, {IN_STREAM: "0"}, count=50)
                if not batch or not batch[0][1]:
                    batch = await self.redis.xreadgroup(GROUP, self.name, {IN_STREAM: ">"}, count=50, block=2000)
                if self.paused:
                    continue  # paused mid-read: leave them unacknowledged, they're redelivered on resume
                for _, messages in batch or []:
                    for msg_id, fields in messages:
                        await self._handle(msg_id, fields)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # keep consuming through Redis restarts
                log.warning("consumer error, retrying: %s", e)
                await asyncio.sleep(1)

    async def _ensure_group(self) -> None:
        try:
            await self.redis.xgroup_create(IN_STREAM, GROUP, id="0", mkstream=True)
        except ResponseError as e:
            if "BUSYGROUP" not in str(e):
                raise

    async def _claim_abandoned(self) -> None:
        _, claimed, _ = await self.redis.xautoclaim(IN_STREAM, GROUP, self.name, CLAIM_IDLE_MS, "0-0", count=50)
        if claimed:
            log.info("claimed %d messages from a replica that stopped", len(claimed))

    async def _handle(self, msg_id: str, fields: dict) -> None:
        event = json.loads(fields["data"])
        transfer_id = event["transferId"]
        seen_key = f"fraud:verdict:{transfer_id}"
        # Redelivered event: publish the verdict we already computed instead of scoring twice.
        verdict = await self.redis.get(seen_key)
        if verdict is None:
            verdict = json.dumps(await self._score(event))
            await self.redis.set(seen_key, verdict, ex=7 * 24 * 3600)
        await self.redis.xadd(OUT_STREAM, {"type": "FraudDecision", "data": verdict}, maxlen=10_000, approximate=True)
        await self.redis.xack(IN_STREAM, GROUP, msg_id)

    async def _score(self, e: dict) -> dict:
        customer = e["fromCustomerId"]
        now_ms = int(time.time() * 1000)
        hist_key, payees_key, recent_key = (f"fraud:history:{customer}", f"fraud:payees:{customer}",
                                            f"fraud:recent:{customer}")
        await self.redis.zremrangebyscore(recent_key, 0, now_ms - VELOCITY_WINDOW_MS)
        hist = await self.redis.hgetall(hist_key)
        history = rules.History(
            transfer_count=int(hist.get("count", 0)),
            total_cents=int(hist.get("total", 0)),
            known_recipients=frozenset(await self.redis.smembers(payees_key)),
            recent_transfers=await self.redis.zcard(recent_key),
        )
        transfer = rules.Transfer(
            transfer_id=e["transferId"], from_customer=customer, to_account=e["toAccountId"],
            to_name=e["toCustomerName"].split(" ")[0], amount_cents=int(e["amountCents"]),
            sent_at=datetime.fromisoformat(e["createdAt"].replace("Z", "+00:00")),
        )
        v = rules.score(transfer, history)

        pipe = self.redis.pipeline()
        pipe.hincrby(hist_key, "count", 1)
        pipe.hincrby(hist_key, "total", transfer.amount_cents)
        pipe.sadd(payees_key, transfer.to_account)
        pipe.zadd(recent_key, {transfer.transfer_id: now_ms})
        pipe.expire(recent_key, VELOCITY_WINDOW_MS // 1000)
        pipe.hincrby("fraud:stats", "scored", 1)
        if v.decision == "HOLD":
            pipe.hincrby("fraud:stats", "held", 1)
        result = {"transferId": transfer.transfer_id, "decision": v.decision, "score": v.score, "reasons": v.reasons}
        pipe.lpush("fraud:recent-decisions", json.dumps({
            **result, "from": e["fromCustomerName"], "to": e["toCustomerName"],
            "amountCents": transfer.amount_cents, "at": datetime.now().astimezone().isoformat(),
        }))
        pipe.ltrim("fraud:recent-decisions", 0, 49)
        await pipe.execute()
        log.info("scored transfer %s: %s (%d) %s", transfer.transfer_id[:8], v.decision, v.score, "; ".join(v.reasons))
        return result
