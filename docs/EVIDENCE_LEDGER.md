# Verification evidence ledger

For each PR record the exact revision, environment, image digest, commands and exit codes, migration checksum, browser and direct SQL assertions, fault or restore checks and independent reviewer findings.

## 2026-11-27 environment entry gate

Runner Microsoft Windows NT 10.0.26300.0. Repository `NgohCH/HELPInsights`, `main`, SHA `5d5e443d13328a07a71810cd90eb3a9785a3c902`.

| Command | Result | Observed evidence |
| --- | --- | --- |
| `git status --porcelain`, `git rev-parse HEAD`, `git ls-remote --exit-code origin refs/heads/main` | PASS | Clean checkout. Local and GitHub main returned the recorded SHA. |
| `gh auth status`, `gh repo view NgohCH/HELPInsights --json viewerPermission --jq .viewerPermission` | PASS | Exit 0. NgohCH authenticated and repository permission was ADMIN. |
| `docker context show`, `./scripts/preflight.ps1` | PASS | Exit 0. Context desktop-linux, Git 2.56.0.windows.4, Docker Engine 29.9.2, Compose v5.6.1, Node v24.22.1 and Corepack 0.36.0. |
| `./scripts/test-postgres.ps1` | PASS | Exit 0. Official postgres:16-alpine pulled. Healthy project survey-preflight-83421fd356fb. CREATE TABLE and INSERT 0 1. PostgreSQL restarted and returned the expected before_restart row. Container, network and volume were removed. |
| `docker image inspect postgres:16-alpine --format '{{index .RepoDigests 0}}'` | PASS | postgres@sha256:f2f98726820d0342055351c6e9d36e705f5bfffb3dd53ff556325114b08afb6d |
| `python scripts/validate_docs.py` | BLOCKED_ENVIRONMENT on host Python | Exit 1. Python 3.15.2 lacks PyYAML. The documentation CI pins Python 3.12. Verify with isolated Python and PyYAML. |

The default sandbox denied access to the local Docker named pipe and GitHub API. The scoped preflight outside the shell sandbox recovered both checks. The PostgreSQL smoke used a dedicated unexposed Compose network and disposable volume. Application, browser and restore checks are tracked separately.

## ENG-001 and ENG-002 development runtime

- Tested revision `07c70a4627556bf6b8684609982289ae2356ea5a`. See the [exact-SHA verification record](../evidence/ENG-001/07c70a4627556bf6b8684609982289ae2356ea5a.md).
- Local runtime passed real PostgreSQL, Chromium, dependency and redacted history scans. The development runner uses pnpm 10.34.9.
- GitHub `rules/branches/main` returned an empty array (exit 0) and classic protection returned 404. The merge and release gate remains blocked.

## ENG-014 Live Poll lobby slice

- Source revision [d1e5adcc4b09](../evidence/ENG-014/d1e5adcc4b09d8ecea6c880a1ee985a2a023b3ed.md) passed 13 real PostgreSQL integration tests, 2 security tests and 3 Chromium journeys. The live journey captured separate presenter and guest WebSocket frames and recovered the same state after PostgreSQL restarted.
- A disposable run at the source revision verified the 005-to-006 upgrade, an archive restore of the live room and guest records, and the disabled feature response. The release gate remains open.

## ENG-014b Live Poll host controls

- Source revision [be898f0ceea9](../evidence/ENG-014b/be898f0ceea991afef379b1c1cd8607bc7eb0c5b.md) passed 14 PostgreSQL integration, 2 security and 4 Chromium tests. PostgreSQL accepted one concurrent host transition at the same revision. Chromium confirmed two ongoing sockets and automatic guest recovery to the current revision.
- A seeded upgrade preserved a versioned lobby and its guest, and the archive restore retained a paused session. A connected guest whose capability expired received no newer frame after a committed transition. Scoring, 50-user contention, multi-instance fan-out and release approval remain open.
