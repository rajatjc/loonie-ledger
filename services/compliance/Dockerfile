FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src src
RUN npx tsc && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY package.json .
USER node
EXPOSE 8081
CMD ["node", "dist/main.js"]
