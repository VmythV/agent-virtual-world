# Single-container build: build the frontend, then run the backend which
# serves the API, the WebSocket feed, and the built SPA on one port.

# --- Stage 1: build the frontend -------------------------------------------
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# --- Stage 2: runtime ------------------------------------------------------
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# git is needed by the collaborative-build world template's shared workspace.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# tsx runs the TypeScript server directly (no separate compile step); it's a
# devDependency, so install it explicitly alongside the production deps.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm install --no-save tsx@^4

COPY tsconfig.json ./
COPY src/ ./src/
COPY --from=web /app/web/dist ./web/dist

EXPOSE 4000
VOLUME ["/app/data"]
CMD ["npx", "tsx", "src/server/index.ts"]
