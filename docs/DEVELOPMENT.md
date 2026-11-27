# Development, local deployment and verification runbook> All development must originate from the authorised GitHub repository and run container-backed tests against disposable **real PostgreSQL**, not mocks alone. See [GitHub and Docker runtime verification](GITHUB_DOCKER_RUNTIME_VERIFICATION.md).



This is a proposed development contract. **No runnable services are included in this handoff archive.** The developer must update this document with the exact tested commands after implementing WP-001.

## JASP fixture-based verification

- Add deterministic fixtures with nominal category codes, ordered 1–5 Likert responses, continuous numeric measurements, free-text UTF-8 (including Malay and Chinese), skipped answers, explicit missingness, and anonymous-mode responses.
- Check exported row/column counts; stable headers; label/codebook alignment; missing value rules; formula-injection escaping; zero identity leakage from anonymous surveys; reproducible hashes where content is fixed; download TTL and authorisation.
- Manual Stage 1 UAT must import the CSV into a currently supported JASP version and document nominal/ordinal/scale type adjustments. Stage 3 adds actual `.sav` round-trip and JASP import verification.

## Local stack requirements

Target tools: pinned supported Node LTS, pnpm, Docker with Compose, PostgreSQL 16 or another explicitly reviewed supported version, Git. Determine and record actual compatibility and security advisories at build time; do not assume current runtimes in a future deployment.

Example developer commands **to implement and verify** (not yet executable):

```sh
cp .env.example .env
pnpm install --frozen-lockfile
docker compose -f infra/docker/compose.yml up -d --build
pnpm db:migrate
pnpm db:seed:test
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm security:check
pnpm api:lint
```

Add `pnpm dev` and `pnpm build` scripts with clear logs and predictable exit codes. `db:seed:test` must refuse to run against non-test databases.

## Minimal local deployment

Components: `web`, `api`, `worker`, `postgres`, optional mock email receiver and optional object storage emulator. Use least-privilege service accounts, resource limits, health checks and persistent DB volume for local testing. Production installation uses separate credentials, secret store and approved backup arrangements. Do not expose DB/admin ports publicly by default.

## Environment variable categories

`APP_BASE_URL`, `DATABASE_URL` (secret), `SESSION_SECRET` (secret), `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (secret), `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET`, `EMAIL_PROVIDER`, `WEBHOOK_SIGNING_KEY` (secret), `METRICS_ENABLED`, `RETENTION_WORKER_ENABLED`, `LOG_LEVEL`. Use `.env.example` with dummy placeholders only; document every variable, validation, defaults and secrets management.

## CI and automated checks

- Lockfile install, formatting/linting, typecheck, unit and API contract tests.
- PostgreSQL integration tests including RLS and concurrent idempotent submissions.
- Browser tests for survey publish, respondent mobile path, dashboards and retention warnings.
- Secret scanning, SAST, dependency checks, image scan, SBOM/provenance where available.
- Migration dry run on fresh and previous-version database fixtures.
- Fault injection for DB outage, webhook failure, worker crash, invalid survey definition and restoring expired records.
- WCAG automated checks and manual keyboard/screen-reader review.

## Documentation standards

Keep README current for users/operators; `docs/API_GUIDE.md` and machine-readable OpenAPI for integrators; architecture ADRs for design decisions; admin/user runbooks; privacy and retention policy guides; installation/upgrade/restore instructions; troubleshooting; versioned changelog; release verification reports. Documentation updates are required for any behaviour or configuration change.

## Production readiness

1. Product Owner approves pilot scope and current test evidence.
2. Security/privacy review of auth, tenancy, anonymity, survey content processing, exports and retention.
3. Record accepted infrastructure provider, DNS/WAF, backups, telemetry, roles and budget.
4. Perform staged migration and isolated restore test; test rollback feasibility.
5. Run UAT with actual staff and representative mobile respondents.
6. Review action notices, alert recipients and on-call coverage.
7. Deploy only with separate approval, capture deployed commit, migrations and runtime versions, run smoke tests.
8. Observe pilot and log defects, operate Stage 1B feedback-to-action before enabling Stage 2 features in production. Stage 2 and 3 isolated development can proceed concurrently.
