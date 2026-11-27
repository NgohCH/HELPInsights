# Bootstrap and PostgreSQL development stack

Requires Node 24, Corepack, Docker Engine with Compose and the pinned pnpm workspace. Use the fixture stack only with synthetic records. Its bundled database credential is for the isolated Docker network.

From this checkout on Windows PowerShell or a POSIX shell:

```sh
docker compose -p helpinsights-dev up -d --build --wait
docker compose -p helpinsights-dev port app 3000
```

Open the reported loopback address in a browser. The API provides `/api/v1/health/live` and `/api/v1/health/ready`. The readiness check queries PostgreSQL. Restarting the app verifies previously applied migration checksums. Use `docker compose -p helpinsights-dev down` to stop the stack while retaining the named volume.

Run the same checks as the runtime CI job:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm audit --audit-level=low
corepack pnpm test:stack
```

On Windows PowerShell where script execution is restricted, use `corepack.cmd`. On the Linux GitHub runner the browser install uses `--with-deps` to install Chromium's OS dependencies. The test runner creates a unique Compose project, confirms the app binds to loopback, runs SQL, HTTP and Chromium checks, and removes its own containers, network and volume. For a failure, inspect console logs and retained Playwright traces under `test-results/`.

The stack uses a migration-capable PostgreSQL role during bootstrap. Tenant/session work must introduce a separate runtime role before accepting survey records.
