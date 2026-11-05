#!/usr/bin/env bash
# Starts payments, fraud, compliance and the gateway inside one container.
#
# Required env vars (Render sets PORT itself):
#   DATABASE_URL  Render Postgres internal URL, e.g. postgresql://user:pass@dpg-xxx-a/db
#   REDIS_URL     Render Key Value internal URL, e.g. redis://red-xxx:6379
#   ADMIN_TOKEN   shared secret between the services
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL}" "${REDIS_URL:?set REDIS_URL}"
export ADMIN_TOKEN="${ADMIN_TOKEN:-dev-admin-token}"

# Split the Postgres URL for the JDBC driver. Payments and compliance share one
# database; their table names do not collide, so no CREATE DATABASE is needed.
eval "$(python3 - <<'PY'
import os, shlex
from urllib.parse import urlparse, unquote
u = urlparse(os.environ["DATABASE_URL"])
host = u.hostname
port = u.port or 5432
db = u.path.lstrip("/")
print("export DB_JDBC=" + shlex.quote(f"jdbc:postgresql://{host}:{port}/{db}"))
print("export DB_USER=" + shlex.quote(unquote(u.username or "")))
print("export DB_PASS=" + shlex.quote(unquote(u.password or "")))
r = urlparse(os.environ["REDIS_URL"])
print("export REDIS_HOST=" + shlex.quote(r.hostname or "localhost"))
print("export REDIS_PORT=" + str(r.port or 6379))
PY
)"

pids=()
start() { "$@" & pids+=($!); }

# Free web services have 512 MB, so every runtime gets a small heap.
(cd /opt/loonie/payments && PORT=8080 CONSUMER_NAME=payments-1 \
  DATABASE_URL="$DB_JDBC" DATABASE_USER="$DB_USER" DATABASE_PASSWORD="$DB_PASS" \
  SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE=3 \
  exec java -Xmx150m -Xss512k -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -XX:MaxMetaspaceSize=110m \
    -jar payments.jar) &
pids+=($!)

(cd /opt/loonie/fraud && PORT=8000 CONSUMER_NAME=fraud-1 \
  exec python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log) &
pids+=($!)

(cd /opt/loonie/compliance && PORT=8081 CONSUMER_NAME=compliance-1 \
  DATABASE_URL="$DATABASE_URL" \
  exec node --max-old-space-size=48 dist/main.js) &
pids+=($!)

(cd /opt/loonie/gateway && \
  TERMINAL_MODE=demo \
  PAYMENTS_URL=http://127.0.0.1:8080 FRAUD_URL=http://127.0.0.1:8000 COMPLIANCE_URL=http://127.0.0.1:8081 \
  exec node --max-old-space-size=64 dist/main.js) &
pids+=($!)

trap 'kill "${pids[@]}" 2>/dev/null || true' TERM INT
# If any service dies, stop the container so Render restarts it.
wait -n
echo "a service exited; shutting down" >&2
kill "${pids[@]}" 2>/dev/null || true
exit 1
