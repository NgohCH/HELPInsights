#!/usr/bin/env bash
set -euo pipefail

for required in package.json pnpm-lock.yaml compose.yaml compose.test.yaml; do
  test -f "$required" || { echo "NOT_IMPLEMENTED: $required missing"; exit 1; }
done

node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";
const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
const required = ["lint", "typecheck", "test", "test:stack", "test:integration", "test:security", "test:e2e"];
for (const name of required) {
  if (typeof scripts?.[name] !== "string" || !scripts[name].trim()) {
    console.error("NOT_IMPLEMENTED: missing package script " + name);
    process.exit(1);
  }
}
NODE

git rev-parse HEAD
docker run --rm --network none -v "$PWD:/repo:ro" \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/repo \
  ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f \
  git --redact --no-banner /repo
corepack pnpm install --frozen-lockfile
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm audit --audit-level=low
corepack pnpm exec playwright install --with-deps chromium
corepack pnpm test:stack
