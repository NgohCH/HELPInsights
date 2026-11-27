FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack pnpm install --prod --frozen-lockfile
COPY --chown=node:node apps ./apps
COPY --chown=node:node packages ./packages
USER node
EXPOSE 3000
CMD ["node", "apps/api/main.ts"]
