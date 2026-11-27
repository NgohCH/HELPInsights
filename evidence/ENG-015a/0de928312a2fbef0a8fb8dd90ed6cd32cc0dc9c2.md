# ENG-015a private timed Game Show verification

- Base `8c9b702575c7b4f7832ee1716157c91daa26141c` on `feat/eng-015a-game-show-scoring`. Source `0de928312a2fbef0a8fb8dd90ed6cd32cc0dc9c2`.
- Windows NT 10.0.26300, Intel Core i7-1185G7 with 8 logical CPUs and 32 GiB RAM. Docker Engine 29.9.2, Compose 5.6.1, local context desktop-linux, PostgreSQL 16.16, Node 24.22.1, Corepack 0.36.0 and pnpm 10.34.9. PostgreSQL image was pinned to `sha256:f2f98726820d0342055351c6e9d36e705f5bfffb3dd53ff556325114b08afb6d`.
- Migration `009-live-game-show-scoring.sql` checksum `97453d9e0c0eed94be76ead24b4db17ea531dca59baa66a93fc7d1dc97eb2443`.

| Command or check | Observed result |
| --- | --- |
| Scoped `scripts/preflight.ps1`, `scripts/test-postgres.ps1` | Exit 0. GitHub repository permission ADMIN. The official PostgreSQL image pulled. SQL create, insert, restart and direct read passed and disposable project `survey-preflight-99bf967d1b78` cleaned. |
| Locked dependency setup and runtime tree match | `corepack pnpm install --frozen-lockfile` exit 0. `git diff --exit-code 164fb832037a2b440918c363e9e2b00a8d37ab25 8c9b702575c7b4f7832ee1716157c91daa26141c -- apps packages tests api compose.yaml compose.test.yaml Dockerfile scripts` exit 0. The base differs from the previously exercised voting commit only outside the runtime and test trees listed. |
| Focused initial PostgreSQL and Chromium red | `helpinsights-test-be844737d5cc` produced the expected 400 for missing Game Show mode, 201 for the missing Registry restriction, and 404 for the missing presenter route. |
| Focused initial PostgreSQL and Chromium green | `helpinsights-test-7c99973006bb` passed two integration tests and the mobile/presenter Chromium journey with real sockets. Cleanup completed. |
| Consent regression red | `helpinsights-test-a574215ebab2` returned 201 instead of 403 against a synthetic published version with a consent record. The disposable stack was removed. |
| `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test` and locked YAML parse | Exit 0. Formatting, typing, all three unit tests and Game Show OpenAPI schema parse passed. |
| Full runtime gate with final consent guard | Exit 0 in `helpinsights-test-56ece1855662`. Ran the full Node integration and security globs and full `playwright test`, using the project Docker harness and separate loopback address resolution after app restarts. All 21 integration, 2 security and 6 Chromium tests passed. Volume cleanup confirmed. |
| Seeded upgrade, score archive restore and replay after app restart | Same disposable project. `pg_dump -Fc` and `pg_restore --exit-on-error` restored the same source version, score, rule revision and deadline relationship. The app restarted and returned the original deadline and exact score-free replay receipt. Migrating a seeded 008 database left its open Live Poll room intact. Starting a separate app with `LIVE_GAME_SHOW_ENABLED=false` hid its presenter page and denied reads of an existing timed room. |

## Verified scoring behavior

The private answer key and accuracy_v1 rule are stored separately from ordinary survey data and Live Poll votes. The application runtime lacks direct table reads for both the rule and attempt. Two competing exact retries yielded the same original receipt and one attempt. A different choice or fresh key for the same question conflicted. SQL found 1000 and zero points for the intended positive and negative choices and the immutable source version on both rows. Accepted timestamps were inside the actual 30-second PostgreSQL interval. The game deadline persisted while paused, and resuming moved only the opening revision. Requests carrying a client timestamp or points were refused.

Real Chromium sockets carried the same deadline to presenter and mobile guest. The guest received an answer receipt, went offline and recovered the same deadline and private accepted flag. The receipt and both role-filtered snapshots carried no score or key. No ordinary survey responses or Live Poll votes were created by the Game Show answers.

## Review and remaining scope

The integration owner independently reviewed the mode gate, role grants, source eligibility, timer and room-to-guest locking. No blocker was found for the isolated scope. Conditional-definition screening currently runs in the public application route. The trusted database role retains conditional payload responsibilities in other authorised workflows. Per-person duplicate control and disposal of expired room data require further work.

Both Live flags default off outside the disposable test configuration. Game Show accepts one published unconditional single-choice question and keeps scores sealed. Score release, rankings, configurable speed scoring, multi-question private key authoring, formal assessment, and production acceptance remain open. Anonymous participant capabilities establish a scope per admission, without real rosters or identity guarantees.

The open-version check uses the exact distribution eligibility value and the optional `public.research_consent_versions` table keyed by immutable version. It protects creation in PostgreSQL RLS as well as the app API, and is checked again before join, command, answer or read. Registry restrictions and Research consent require cumulative integration against both real policy migrations. The branch does not incorporate permission to host such a quiz through an anonymous PIN. Additional source policies must be checked on that boundary.

Timer and correctness checks occur in PostgreSQL after the room and guest locks. Pausing does not stop an open timer. A fresh answer at or after the deadline is rejected. An exact committed receipt can be replayed later while the participant capability is still valid. The browser shows the server deadline and estimates its local display. The server alone decides acceptance. Turning off the Game Show flag blocks operating these rooms and retains scores. Migration 009 is additive to existing lobbies. No remote write or production action occurred.
