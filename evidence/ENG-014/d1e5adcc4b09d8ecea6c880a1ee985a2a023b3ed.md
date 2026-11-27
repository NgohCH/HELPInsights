# ENG-014 Live Poll lobby verification

- Base commit `838fa64abe0f4bebb515abe666434145304ad662`.
- Source commit `d1e5adcc4b09d8ecea6c880a1ee985a2a023b3ed` on `feat/eng-014-live-session`. The source and test files matched the full-suite worktree at commit. The supplemental archive and upgrade run started from this clean SHA.
- Runner Windows NT 10.0.26300.0, Git 2.56.0.windows.4, GitHub CLI 2.103.3, Docker Engine 29.9.2 and Compose 5.6.1 with the local `desktop-linux` context. Node 24.22.1, Corepack 0.36.0, pnpm 10.34.9.
- PostgreSQL 16.16, Compose image `postgres:16-alpine@sha256:f2f98726820d0342055351c6e9d36e705f5bfffb3dd53ff556325114b08afb6d`; application image manifest `sha256:4381f925881403cd096e6f26099c9f743cd03ac246add7c72959959eb385430c` in the full run.
- Runtime ledger checksum for `006-live-quiz-lobby.sql` was `9b1ec785a53f6d60ae29453d47a2935b6e182176c81b2ee09f4dab7f8ac9694b`. The migration runner normalises line endings before hashing.

## Observed commands and results

| Command | Result |
| --- | --- |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/preflight.ps1` | Scoped execution passed Git, GitHub authentication and repository ADMIN permission, Docker Engine, Compose and Node prerequisites. Unscoped execution had GitHub networking and Docker access failures. |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-postgres.ps1` | `POSTGRES_PREFLIGHT=PASS` for disposable project `survey-preflight-b9c7674a1957`. Docker pulled official PostgreSQL, created a table, inserted one row, restarted PostgreSQL, verified the row, then removed the test volume. |
| `corepack pnpm test:stack` on the clean base | Exit 0. 11 integration, 2 security and 2 Chromium tests passed. Browser created, published and responded to a survey, verified SQL after restart, displayed chart and checked the downloaded JASP ZIP. |
| `node --test tests/integration/live-quiz.test.ts` and `playwright test tests/e2e/live-quiz.spec.ts` on the base with the new tests | Expected failures. The unauthenticated live API returned 404 instead of 401. The presenter page returned 404 instead of 200. |
| `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test` | Exit 0. Formatting/type checks passed. 3 unit tests passed. |
| `corepack pnpm audit --audit-level high` | Exit 0 with no known vulnerabilities reported. |
| `corepack pnpm test:stack` for the source candidate | Exit 0 in `helpinsights-test-fe8853602f58`. 13 integration, 2 security and 3 Chromium tests passed. No skipped tests. The disposable volume was removed. |
| `docker run --rm` with Python 3.12, PyYAML and a read-only checkout, then `python scripts/validate_docs.py` | Exit 0 and `DOCUMENTATION_ONLY_PASS`. Host Python lacked PyYAML. |
| Supplemental isolated Compose run on the source commit | Exit 0 in `helpinsights-test-85734f20f73e`. The source DB was archived with `pg_dump -Fc` and restored with `pg_restore --exit-on-error` to a fresh DB. The original quiz-version reference and one 32-byte participant digest matched in the restored row. The separate upgrade DB applied migrations 001–005, retained its seeded organisation after 006 and passed `hasCurrentSchema`. The disabled mode returned 404 for the presenter page and creation route. The disposable volume was removed. |

## Browser and database evidence

Playwright captured real `framereceived` events from Chromium for the presenter and a mobile guest. The presenter frame included the original published version ID. The guest frame contained room ID, Live Poll mode, lobby state and revision. After restarting PostgreSQL, both pages used Refresh lobby and received the same frame payloads. The direct SQL assertion returned the original quiz version and exactly one guest.

The API test verified a foreign workspace creator could neither create the room from that published version nor read it, and a participant token could not read a second room. An unknown PIN and an expired PIN returned the same 403 denial, and a saturated budget returned 429. SQL confirmed the stored digests were 32 bytes and the runtime role lacked direct participant table reads and lobby updates.

The WebSocket integration test observed close code 1000 with the expected snapshots for both roles. A foreign presenter credential received code 1008 with no snapshot, and a foreign origin received HTTP 403. The test repeated host and guest snapshots after restarting the app. Docker Desktop reassigned the random host port during debugging (old port refused connections, new port returned 200), so this test resolves the current loopback address after an app restart.

## Review and release gate

The independent integration owner challenged authorization, HMAC PIN storage, participant scope and the shared join budget. A burst of guesses could exhaust the deployment-wide 120-attempt-per-minute allowance and deny valid guests. The durable limit contains guessing volume. Production gating still needs source- and room-aware controls, incident visibility and sized load tests.

Each WebSocket connection delivers one authorized snapshot and closes. Remaining WP-053 work includes presenter state transitions, continuous broadcasts, capacity and abuse handling. WP-054–056 still require scoring, further modes, automatic reconnect and replay, retention, analytics, operations and independent release acceptance. Guest capabilities are page-local and refresh within that page. This local slice allows a creator to use a published single-choice survey version as the quiz source.

Local rollback uses the default-off feature flag and preserves committed lobbies. Migration 006 is additive and forward-only. Any data-destructive rollback requires a separate review. No push, protected merge, production activation or real recipient contact occurred.
