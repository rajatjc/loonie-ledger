"""Fraud service: scores every transfer before money moves."""

import asyncio
import json
import logging
import os
import socket
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException
from redis.asyncio import Redis

from . import rules
from .consumer import FraudConsumer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

redis = Redis(host=os.getenv("REDIS_HOST", "localhost"), port=int(os.getenv("REDIS_PORT", "6379")),
              decode_responses=True)
consumer = FraudConsumer(redis, os.getenv("CONSUMER_NAME") or socket.gethostname())
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "dev-admin-token")


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(consumer.run())
    yield
    task.cancel()


app = FastAPI(title="Loonie Ledger fraud service", lifespan=lifespan)


@app.get("/health")
async def health():
    try:
        await redis.ping()
    except Exception as e:
        raise HTTPException(503, f"redis unreachable: {e}")
    return {"status": "UP", "consumer": consumer.name, "paused": consumer.paused}


@app.get("/api/fraud/stats")
async def stats():
    s = await redis.hgetall("fraud:stats")
    scored, held = int(s.get("scored", 0)), int(s.get("held", 0))
    return {"scored": scored, "held": held, "holdRate": round(held / scored, 3) if scored else 0,
            "threshold": rules.HOLD_THRESHOLD, "paused": consumer.paused}


@app.get("/api/fraud/decisions")
async def decisions(limit: int = 20):
    return [json.loads(d) for d in await redis.lrange("fraud:recent-decisions", 0, max(0, min(limit, 50) - 1))]


@app.get("/api/fraud/rules")
async def list_rules():
    return {"threshold": rules.HOLD_THRESHOLD, "rules": rules.RULES}


@app.post("/api/admin/consumer/{action}")
async def admin(action: str, x_admin_token: str | None = Header(default=None)):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(403, "admin token required")
    if action not in ("pause", "resume"):
        raise HTTPException(404, "use pause or resume")
    consumer.paused = action == "pause"
    logging.getLogger("fraud").info("consumer %s", "paused" if consumer.paused else "resumed")
    return {"paused": consumer.paused}
