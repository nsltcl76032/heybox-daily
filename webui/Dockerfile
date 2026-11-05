FROM node:24-bookworm-slim AS app
WORKDIR /build
RUN npm install --global pnpm@12.15.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY patches ./patches
COPY apps/web/package.json ./apps/web/package.json
COPY apps/runner/package.json ./apps/runner/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/hosting/package.json ./packages/hosting/package.json
RUN pnpm install --filter @heybox/runner... --frozen-lockfile --ignore-scripts
COPY src ./src
COPY packages/contracts/src ./packages/contracts/src
COPY packages/hosting/src ./packages/hosting/src
COPY apps/runner/src ./apps/runner/src
RUN pnpm build && CI=true pnpm install --filter @heybox/runner... --prod --frozen-lockfile --ignore-scripts

FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends util-linux ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV TZ=Asia/Shanghai NODE_ENV=production

FROM base AS web
COPY package.json ./
COPY --from=app /build/dist ./dist
COPY --from=app /build/node_modules ./node_modules
COPY third-party/*-LICENSE ./third-party/
COPY LICENSE NOTICE.md ./
COPY webui/ ./webui/

ENV PORT=8620
EXPOSE 8620
ENTRYPOINT ["node", "webui/server.js"]
