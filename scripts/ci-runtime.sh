#!/usr/bin/env bash
set -euo pipefail

corepack pnpm install --frozen-lockfile
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm audit --audit-level=low
corepack pnpm exec playwright install --with-deps chromium
corepack pnpm test:stack
