# GitHub + local Docker + real PostgreSQL verification contract

**Status:** mandatory implementation and acceptance specification. The documentation package itself is not an application. Do not claim these checks pass until the code and execution evidence exist.

## 1. Mandatory operating model

GitHub is the source of truth. Every agent starts from a verified repository URL, target branch, current commit SHA, clean working tree, and authorised permissions. Build in feature branches and/or isolated Git worktrees; submit pull requests with proof. Source-only lint/type checks **never** constitute a successful delivery.

The preferred execution environment is the developer's **local Docker Desktop / Docker Engine** with a local, dedicated, disposable PostgreSQL container. Docker Hub is an **image registry** and is not the Docker daemon. The agent must check Docker Engine connectivity separately from optional Docker Hub authentication and image pull/push capability.

The coding environment must have explicit permission to run Git, Docker CLI, Docker Compose and containerised tests. A hosted ChatGPT session **cannot automatically reach** the user's Windows Docker Desktop or Docker Hub account. If direct local access is unavailable, supply a documented CLI script to execute locally or configure an approved, restricted self-hosted GitHub Actions runner on the development machine. Do not claim a connector alone grants Docker daemon access. Never open an unauthenticated TCP Docker API or share `docker.sock` with untrusted code.

## 2. Preflight (agent must execute, not assume)

Record date/time, OS, Git SHA, Docker/Compose versions, daemon mode, Docker context and image digests without exposing credentials. Commands for a supported terminal:

```sh
git remote -v
git status --short
git rev-parse HEAD
docker version
docker compose version
docker context show
docker info
docker image ls
```

For Docker Hub, `docker pull postgres:<pinned-supported-tag>` is a practical read-only connectivity test; authenticate using credential helpers only if required, never embed passwords/tokens in instructions or logs. Prefer image digests pinned after security review. **Do not assume any existing local Docker services, volumes or networks belong to this project.**

On Windows, document PowerShell equivalents and the requirement for Docker Desktop Linux containers, WSL2 integration where applicable, and the relevant permissions. Use a project-prefixed Compose name and dedicated network/volumes. Prevent collisions with other local HELP projects.

Preflight failure must be reported as `BLOCKED_ENVIRONMENT` with exact output and a safe remediation; continue documentation/unit-only work but do not mark runtime checks PASS.

## 3. GitHub-based autonomous workflow

1. Confirm repository URL/default branch/protection rules and authorised bot identity. Do not create repositories or push to a guessed organisation.
2. Clone/fetch from GitHub. Validate commit SHA and working tree; create `feat/<wp>-<short-scope>` branch or dedicated worktree.
3. Make PR-sized code changes; generate/update migrations, fixtures, API contracts, operator docs and tests.
4. Build *real application images* from the current checked-out revision (not stale published images).
5. Start the isolated application stack with real PostgreSQL and worker using `docker compose -p survey-platform-ci -f compose.test.yaml up --build -d` (command becomes authoritative only when the file exists).
6. Run schema migrations and a test seed against that database; fail on migrations that cannot be reapplied safely.
7. Execute API, browser and persistence E2E against running containers, including the project listening workflow. Inspect database state using authenticated read-only SQL for correctness, not HTTP status alone.
8. Test restart/retry, cross-tenant denial, anonymous privacy, export and retention. Conduct a clean backup and isolated restore drill.
9. Save redacted command transcripts, image digests, migration checksums, test reports and incident logs as PR artifacts. Include commit SHA, runner OS and execution time.
10. An independent reviewer challenges remaining risks; merge protected branches and production deployment require explicit approval.

Use GitHub Actions on a hosted runner for reproducible PR checks where possible. If tests specifically require local Docker Desktop, use an **approved ephemeral or tightly isolated self-hosted runner** on a trusted development machine. Never run untrusted fork PR code on a self-hosted runner with repository secrets or unrestricted access to the host Docker daemon. Restrict runner group/repository/branch and clean up ephemeral environments.

## 4. Minimum real-database test suite (release blocker)

| Test | Required observed evidence |
| --- | --- |
| Initial boot | Fresh Compose stack becomes healthy, without manual DB edits |
| Migration | Real PostgreSQL schema created from empty volume; rerun is safe |
| Identity & isolation | Two tenant/workspace fixtures; forbidden reads/writes/exports fail; row-level checks where applicable |
| Survey lifecycle | API/UI creates draft, publishes immutable version, closes survey |
| Submission | Real respondent submits; data committed in PostgreSQL and returned by authorised query |
| Idempotency | Replayed request results in one durable row; changed payload using same key is rejected |
| Restart | Kill/restart API/worker during queued work; committed data survives and tasks recover within bounded policy |
| Database outage | Simulate temporary network interruption; truthful error handling and safe recovery without duplicate responses |
| Export | CSV/JASP bundle generated from inserted data; codebook matches database values and no unauthorised identity leaks |
| Retention | Expired fixture removed from live data; valid hold preserved; disposal event recorded; restore-deletion safeguards tested |
| Backups | Restore a backup to *another disposable database* and verify record counts/checksums |
| Security | Rate limiting, invalid input, authz denial, no exposed DB/metrics/admin ports, secrets/image/dependency scans |
| UI & accessibility | Browser E2E against running API+DB, mobile viewport and basic keyboard accessibility |
| Feedback integration | Outbox event persisted, retry + dedupe proven against isolated fake case receiver; privacy redaction verified |

Verify both **application response** and **durable database state**. Mock-only tests and source inspections are supporting evidence, not substitutes. Stage 2/3 features must have equivalent database-backed tests for advanced logic, multilingual, quotas, experimental allocation, consent, pseudonym separation and reproducible research exports.

## 5. Make the test system easy to run

Required implementation outputs:

```text
compose.yaml                 # documented local deployment reference
compose.test.yaml            # isolated runtime integration environment
.env.example                 # names, safe examples, no production secrets
scripts/doctor.(sh|ps1)      # Git/Docker/Compose/dependency preflight
scripts/test-stack.(sh|ps1)  # build, up, migrate, seed, API/E2E, SQL asserts, report
scripts/backup.(sh|ps1)      # safe export, no accidental data deletion
scripts/restore-test.(sh|ps1)# isolated restore rehearsal
scripts/collect-evidence.*   # redacted evidence + logs; hashes + status
.github/workflows/ci.yaml    # PR checks and container-backed DB tests
```

Script filenames are required delivery targets, **not assertions that these scripts already exist**. Provide both Windows PowerShell instructions and POSIX shell equivalents or clearly document platform support. Test scripts must clean only their own project-prefixed resources, and must not run `docker system prune`, `docker volume prune`, wildcard container deletion, or commands against non-test Docker contexts.

An installation wizard may inspect prerequisites, prepare config and safely apply reviewed migrations; it must not quietly grant administrative privileges or turn off security controls to pass tests.

## 6. Completion and evidence rules

Each PR is `READY_WITH_EVIDENCE` only when:

- GitHub commit SHA and PR link are recorded; source is pushed to authorised repo.
- Local or CI Docker image build succeeds from that revision.
- Actual API/web/worker containers connect to disposable real PostgreSQL; migration + fixture + query tests pass.
- Browser end-to-end verifies the complete user journey and underlying persistence.
- Fault-injection, security, export and retention evidence relevant to the PR exists.
- Independent review identifies remaining blind spots and remediation or acceptance path.

If a check was not executed or was performed only against mocks, use `NOT_RUN` or `MOCK_ONLY`, never `PASS`. Retain evidence in CI artifacts or repository reports without secrets/personal data. Use four separate statuses: `CODE_COMPLETE`, `RUNTIME_VERIFIED`, `SECURITY_REVIEWED`, `DEPLOYMENT_APPROVED`. No status implies another.

**Safety boundary:** Isolated local test database writes and destruction of specifically created disposable test resources are allowed. Live HELP databases, production secrets, external API calls that alter state, public service exposure, protected merges and production releases require explicit approval.
