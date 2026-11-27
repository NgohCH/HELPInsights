FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS base
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS web
RUN corepack pnpm install --frozen-lockfile
COPY apps ./apps
RUN corepack pnpm build:web

FROM base
RUN corepack pnpm install --prod --frozen-lockfile
COPY --chown=node:node apps ./apps
COPY --chown=node:node packages ./packages
COPY --from=web --chown=node:node /app/dist/web ./dist/web
USER node
EXPOSE 3000
CMD ["node", "apps/api/main.ts"]
