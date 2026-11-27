# Mandatory preflight & stop gate

This package authorises **local isolated development only**, not production changes. Before unattended coding begins, Codex must produce an operator-readable completed checklist with exact command outputs, environment identity, Git SHA and any failures. An assertion from a previous conversation is not an observed test on the current runner.

| Item | Verification | Hard stop when missing |
|---|---|---|
| Repository | Clean, writable Git checkout; known remote, branch, SHA | YES |
| GitHub | `gh auth status`, repository read and push permissions for permitted feature branch | YES |
| Docker | Local engine `docker info`, Compose, ability to run disposable containers | YES |
| Registry | Pull official public image in the authorised Docker context | YES |
| PostgreSQL | `scripts/test-postgres.ps1` or `.sh`: real SQL + persistence across restart | YES |
| Node tools | Supported Node/Corepack/pnpm versions and reproducible lockfile once scaffolded | YES |
| Isolation | Disposable Compose project, no production credentials/volumes/ports | YES |
| Privileges | No need for unrestricted admin access; explicit narrowly scoped Docker authorisation | YES |
| Documentation | Read `AGENTS.md`, `SPEC.md`, `HANDOFF.md`, test/approval rules | YES |
| Environment safety | No live student data; no live Email/SMS/Person Registry/Ticketing writes | YES |
| Recovery | Clean baseline, branch protection policy, safe test volume cleanup | YES |

**Stop rule:** If any required item is BLOCKED, log `PREFLIGHT_BLOCKED` in BUILD_STATUS and stop the unattended coding run. Do not substitute mocking for failed runtime access. Ask for only the missing infrastructure/permission; no continuation by assumption. Do not rerun privileged commands under elevation without approval for that exact environment.

**Reported earlier (not reverified here):** local Docker Engine 29.7.2 and public Docker Hub manifest reachability under elevated access. Registry reachability is not proof of container execution or PostgreSQL integration.

**Entry sequence (Windows PowerShell):** `./scripts/preflight.ps1` then `./scripts/test-postgres.ps1`. The latter pulls the PostgreSQL image and creates/removes a disposable volume; it is a controlled local test and must not target a production Docker context.
