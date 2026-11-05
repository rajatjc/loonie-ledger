# All four services in ONE container, for Render's free web service tier.
# Build from the repo root:  docker build -f deploy/render/Dockerfile .
# Postgres and Redis are separate Render resources (see start.sh for the env vars).

FROM eclipse-temurin:21-jdk AS payments-build
WORKDIR /src
COPY services/payments/gradlew services/payments/settings.gradle.kts services/payments/build.gradle.kts ./
COPY services/payments/gradle gradle
RUN ./gradlew --no-daemon --version
COPY services/payments/src src
RUN ./gradlew --no-daemon bootJar -x test

FROM node:22-bookworm AS compliance-build
WORKDIR /app
COPY services/compliance/package.json services/compliance/package-lock.json services/compliance/tsconfig.json ./
RUN npm ci
COPY services/compliance/src src
RUN npx tsc && npm prune --omit=dev

FROM node:22-bookworm AS gateway-build
WORKDIR /app
COPY services/gateway/package.json services/gateway/package-lock.json services/gateway/tsconfig.json ./
RUN npm ci
COPY services/gateway/web/package.json services/gateway/web/package-lock.json web/
RUN npm --prefix web ci
COPY services/gateway/src src
COPY services/gateway/web web
RUN npx tsc && npm --prefix web run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS node-runtime

FROM eclipse-temurin:21-jre AS java-runtime

FROM python:3.13-slim-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends bash ca-certificates curl jq postgresql-client redis-tools \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --create-home app
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=java-runtime /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk PATH=/opt/java/openjdk/bin:$PATH

WORKDIR /opt/loonie
COPY services/fraud/requirements.txt fraud/requirements.txt
RUN pip install --no-cache-dir -r fraud/requirements.txt
COPY services/fraud/app fraud/app
COPY --from=payments-build /src/build/libs/payments.jar payments/payments.jar
COPY --from=compliance-build /app/node_modules compliance/node_modules
COPY --from=compliance-build /app/dist compliance/dist
COPY services/compliance/package.json compliance/package.json
COPY --from=gateway-build /app/node_modules gateway/node_modules
COPY --from=gateway-build /app/dist gateway/dist
COPY --from=gateway-build /app/web/dist gateway/web/dist
COPY services/gateway/package.json gateway/package.json
COPY deploy/render/start.sh start.sh
RUN chmod +x start.sh

USER app
ENV HOME=/home/app
CMD ["/opt/loonie/start.sh"]
