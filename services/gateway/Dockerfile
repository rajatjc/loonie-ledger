# The full Node image has the compilers node-pty needs.
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY web/package.json web/package-lock.json web/
RUN npm --prefix web ci
COPY src src
COPY web web
RUN npx tsc && npm --prefix web run build && npm prune --omit=dev

# The ops shell needs kubectl, redis-cli, psql and curl when running on Kubernetes.
FROM node:22-bookworm-slim
ARG TARGETARCH
ARG KUBECTL_VERSION=v1.33.4
RUN apt-get update \
 && apt-get install -y --no-install-recommends bash ca-certificates curl jq postgresql-client redis-tools \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSLo /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH:-amd64}/kubectl" \
 && chmod +x /usr/local/bin/kubectl
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/web/dist web/dist
COPY package.json .
USER node
ENV HOME=/home/node PORT=8080
EXPOSE 8080
CMD ["node", "dist/main.js"]
