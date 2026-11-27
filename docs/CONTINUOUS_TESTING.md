# Continuous Testing — mandatory no-deferral policy

**Rule:** tests are designed with the feature and executed continuously. A PR cannot be marked complete, merged or advertised as ready while its relevant tests are deferred, skipped, xfailed, quarantined, or only promised for later. A temporary test omission requires an explicit documented exception and keeps the feature **blocked**, not completed. Unknown results remain unknown.

## Test-first loop (each small ticket)
1. Record requirement ID, affected data/permissions/interfaces, risk, test cases and expected failure signals before writing implementation.
2. Add failing regression/contract tests where appropriate (red); implement minimum changes (green); refactor and rerun. Where a red test cannot yet run because framework is missing, create it as part of bootstrap and record blockage.
3. Run format, lint, typecheck, unit and focused tests after changes. On schema/API changes also run migration, RLS, contract and real-DB integration tests. On UI changes run affected browser journeys and accessibility checks. On security/deletion/identity changes run adversarial and recovery scenarios.
4. Prior to PR: run full regression suite + isolated Docker Compose PostgreSQL E2E, plus applicable fault-injection; capture SHA, command, env, logs and DB assertions. On each PR push, CI independently repeats required suites, including a fresh real database.
5. Independent reviewer challenges green evidence: plausible escaped defect, detection signal, containment, remediation and regression addition. After 3 failed cycles halt that task, reassess design and continue only unrelated safe tasks.
6. Merge only after required checks and authorised review. Re-run smoke and migration compatibility on integration branch and release candidate.

## Cadence
- On every local relevant edit: focused test before next ticket.
- Every commit / push: format, lint, typecheck, unit, API schema and docs checks.
- Every pull request: actual PostgreSQL migrations, isolation/permissions tests, API + browser E2E, export fixtures, dependency and secret scanning, review evidence.
- Nightly on trusted isolated runner: full DB E2E, simulated provider integrations, restore drills, concurrency 50-user quiz smoke and faults; surface failures as action notices. Nightly does **not** replace per-PR critical checks.
- Release candidate: clean install wizard, first admin, upgrades, anonymous privacy, retention/holds/tombstones, QA accessibility/manual checks, hardened container scans, independent security challenge and recovery.

## Failure handling
- Do not defer, bypass or lower required tests to gain speed. Stop promotion of the affected ticket/PR. Diagnose locally, correct, rerun affected suite then complete suite.
- If an environment is unavailable, record `BLOCKED_ENVIRONMENT`, diagnostic evidence and the smallest corrective action. May continue non-dependent safe tickets; do not mark integration ready.
- No destructive tests on live systems. Use disposable named Docker projects and isolated volume labels.
- Quarantine only truly flaky noncritical tests with a linked defect, owner, deadline and risk acceptance; never quarantine tenant, privacy, response integrity, retention, SSO or authentication tests.
- Tests must fail closed: workflows without app/test commands must show `NOT_IMPLEMENTED`, never silently pass.

## Mandatory suites and minimal observed assertions
| Area | Actual proof |
|---|---|
| Survey journey | Browser create > publish > submit > API report > direct SQL row assertions > export matching coded answers. |
| Tenant/identity | Cross-tenant row/API denies; role permissions; SSO issuer/audience/expiry/signature/nonce; no response-person link in anonymous mode. |
| Integrity | Double submit concurrent requests yield single committed response; duplicate outbox/webhook yields single case; restart preserves committed responses. |
| Live quiz | 50 synthetic joins, server deadline/score correctness under concurrency, reconnect, presenter restart and no duplicated scores. |
| Data lifecycle | Clock-controlled expiry, holds, archive, deletion, export TTL, restore tombstone processing. |
| Reliability | Worker fault and DB disconnect, bounded retry, circuit breakers, incident report and manual escalation. |
| Deployment | Clean Docker install wizard, readiness, migrations, first admin and isolated backup-restoration drill. |
| Research | Golden JASP CSV/codebook fixture, scale types, missing codes, privacy and pseudonym rules. |

## Evidence ledger format
For each check record ticket, revision SHA, platform versions, container digests, commands, actual exit codes, expected/observed DB state, test artifacts, known limitations, reviewer and gate. No fabricated coverage percentages or green badges. Tests written but not executed are **NOT VERIFIED**.
