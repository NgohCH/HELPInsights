# Verification evidence ledger## Required additional runtime fields

For each relevant PR: GitHub repo/commit/PR, OS and runner, Docker Engine/context/Compose version, vetted image tags/digests, migration checksum, real PostgreSQL test DB reference (non-secret), HTTP/browser assertions, **direct SQL durable-state assertions**, backup/restore result, security/fault tests, redacted logs and reviewer conclusion. Use `NOT_RUN`, `MOCK_ONLY`, `FAIL`, `PASS`, `BLOCKED_ENVIRONMENT` explicitly. No inferred passes.



| Date | Git commit/PR | Module | Environment | Command / procedure | Observed result | Limits | Reviewer / disposition |
|---|---|---|---|---|---|---|---|
| 2026-11-25 | specification archive | Design package | documentation only | source and file checks | source documents prepared; no application checks | does not prove functionality | unassigned |

For security-affecting changes, explicitly ask: **What can still fail with all tests green, and how will we detect and recover?** Record at least one plausible failure mode with its test/monitoring plan. Report mocks separately from real-provider evidence.

## Packaging/verification record — 25 November 2026

- Activity: documentation consolidation; included prior expanded requirements and new wizard, feature catalogue, template library, help and unattended workflow specifications.
- Evidence: ZIP CRC verified and OpenAPI YAML parsed with unique operation IDs. This is **documentation integrity evidence only**.
- Not run: application build, Docker Compose, real PostgreSQL, browser E2E, penetration test, JASP runtime imports, deployment.
- Required next step: Codex on authorised GitHub clone with accessible local Docker Engine executes preflight and first vertical slice; record actual revision/tests.
