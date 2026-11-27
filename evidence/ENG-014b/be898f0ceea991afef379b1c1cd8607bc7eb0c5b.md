# ENG-014b Live Poll host controls verification

- Base `708c1d6cb4bba893e040bd0926a7dbd48b648110`. Source candidate `be898f0ceea991afef379b1c1cd8607bc7eb0c5b` on `feat/eng-014b-live-host-controls`. Full runtime, upgrade and restore checks tested the source files before committing. The expired connected guest check started on the clean source commit.
- Runner Windows NT 10.0.26300.0, Git 2.56.0.windows.4, GitHub CLI 2.103.3, Docker Engine 29.9.2 and Compose 5.6.1 with the local `desktop-linux` context. Node 24.22.1, Corepack 0.36.0, pnpm 10.34.9.
- PostgreSQL 16.16 at `postgres:16-alpine@sha256:f2f98726820d0342055351c6e9d36e705f5bfffb3dd53ff556325114b08afb6d`. Application manifest `sha256:d8febfe52c2c02d93e7379c3b85917c57e176e258480c34d7c93ba87a08c7c96`.
- Ledger recorded `007-live-host-controls.sql a55bf347bda4066c7b1dd226fbf0a33ca3a629cb45526a9271797bd7f885c19a`.

| Command or check | Observed result |
| --- | --- |
| `scripts/preflight.ps1`, `scripts/test-postgres.ps1` with scoped Docker access | Both exit 0. GitHub repository permission ADMIN. Official PostgreSQL pulled, table and row created, and test row read after PostgreSQL restart in `survey-preflight-4095c77b2c50`. Disposable project was removed. |
| `corepack pnpm install --frozen-lockfile` and `corepack pnpm test:stack` on the base | Exit 0 with 13 integration, 2 security and 3 Chromium tests. Real quiz lobby browser and survey-to-JASP regression passed. |
| `node --test tests/integration/live-host-controls.test.ts` and `playwright test tests/e2e/live-host-controls.spec.ts` before implementation | Expected failures. The command route returned 404 instead of 401, and Chromium found no Start live poll control. |
| Same tests after implementation | Exit 0 in `helpinsights-test-eee168c113ae`. One integration and one Chromium test passed. |
| `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test` | Exit 0. Formatting and types passed. Three unit tests passed. |
| `corepack pnpm test:stack` on the candidate | Exit 0 in `helpinsights-test-2bb4b452bd32`. 14 PostgreSQL integration, 2 security and 4 Chromium tests passed. No skips. Disposable volume cleanup confirmed. |
| `python scripts/validate_docs.py` with Python 3.12 and PyYAML in a disposable container | Exit 0 and `DOCUMENTATION_ONLY_PASS`. |
| Seeded migration upgrade and `pg_dump -Fc` plus `pg_restore --exit-on-error` | Exit 0 in `helpinsights-test-6d04dc1b9c17`. Applying 007 to an existing 006 database preserved the room, immutable quiz version reference and participant digest. The archive restored a paused room at revision 3 with its original version and one guest. |
| Expired connected guest after a committed transition | Exit 0 in `helpinsights-test-cb99b5fdbfe5`. On the exact clean candidate, a connected guest received lobby revision 1. After SQL expired the synthetic capability, the host committed running revision 2. The guest received no further frame and closed with code 1008. Disposable volume cleanup confirmed. |

## Verified behaviour

A signed-in room host drove all five lifecycle commands. PostgreSQL accepted one of two concurrent starts at expected revision 1. The second call returned 409, and SQL recorded running revision 2. Missing authentication returned 401. A foreign workspace creator and a room guest returned 403. An invalid transition and a stale revision returned 409. Starting the room closed admission to new PIN holders. An already-admitted guest read the archived room at revision 6. SQL verified the original published version and one participant.

Playwright observed separate host and mobile guest WebSocket frames. Both browsers received running revision 2 on the sockets opened when entering the lobby. The guest context went offline while the presenter paused. On restoration, the guest opened a new WebSocket and received paused revision 3, matching the direct SQL assertion. PostgreSQL restart retained the lobby, and the app-restart integration test reattached both existing capabilities to running revision 2.

## Independent review and residual scope

The integration owner challenged the command and admission lock order, optimistic revision handling and snapshot authorisation. Host membership is checked while locking the room, and fresh PIN admission holds a share lock on the same row. Each update checks the current capability before sending. An expired credential can retain an idle socket until the next state read. Heartbeats check connectivity.

Live update delivery currently reaches sockets connected to the app process that committed a command. Reconnect reads the current PostgreSQL state and can coalesce intermediate revisions. Multi-instance fan-out, historical replay, question progression, scoring, accessibility acceptance and the 50-user contention gate remain open. Browser credentials stay in each open tab. The default-off flag provides a reversible containment step. The migration supports forward upgrade, while downgrading to the previous lobby-only schema would conflict with persisted active states. Production activation requires its separate release acceptance. No push, merge, production changes or live contacts were performed.
