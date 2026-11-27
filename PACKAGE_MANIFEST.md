# Survey Platform — unattended development package v2.3

**Created:** 27 November 2026. Builds on v2.2, retains product docs, API OpenAPI contract, architecture, feature matrix, live quiz, Project Listen, JASP, security and deployment requirements.

## New operational files
- `prompts/CODEX_START_HERE.md`: copy/paste first Codex turn.
- `scripts/preflight.ps1`: read-only Windows environment gate; stops on missing prerequisites.
- `scripts/test-postgres.ps1`: isolated real Docker/PostgreSQL SQL and restart test.
- `scripts/test-postgres.sh`: Linux runner equivalent.
- `infra/compose.preflight.yaml`: disposable PostgreSQL, no published ports.
- `docs/PREFLIGHT_STOP_GATE.md`: cannot start unattended run before completed checks.
- `docs/EXECUTION_RUNBOOK.md`: autonomous implementation loop and sequencing.
- `docs/APPROVAL_MATRIX.md`: explicit limits on privileges and external writes.
- `docs/CONTINUOUS_EXECUTION_CONTRACT.md`: test-no-deferral rule.
- `.github/workflows/preflight-postgres.yml`: infrastructure evidence only; not an application test.

## Honesty boundary
This package is an instruction and runnable *infrastructure preflight* bundle, not a finished survey platform. Docker, GitHub and database verification on the user's workstation must be run by Codex there. Existing runtime-required CI intentionally blocks until application tests exist. No production actions are authorised.
