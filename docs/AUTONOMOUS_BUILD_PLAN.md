> **v2.2 change:** The continuous test contract in `CONTINUOUS_TESTING.md` and dependency graph `TASK_GRAPH.md` take precedence. Every unblocked vertical slice must be tested in isolation and through real Docker/PostgreSQL before acceptance. Broad waves are planning groupings, not permission to postpone tests.

# Autonomous full-scope build plan

**Status:** Implementation instructions; package is NOT a functioning application. **Scope:** Stages 1, 1B, 2 and 3 are all authorised for *isolated development and test* under this handoff. Production publishing, integration writes, policy changes, expenditure and destructive actions still require explicit authorised approval.

## Outcome and build philosophy

Deliver one coherent, modular, extensible self-hostable survey platform for all general surveys, Project Listen, advanced branching/distribution, and research-grade studies. All modules are implemented under one roadmap, without waiting for Stage 1B operational acceptance before writing Stage 2/3 code. Production activation remains gated by evidence and authorised approval; new modules default OFF until verified. HELP-specific integrations are optional replaceable adapters.

An unattended build means the agents independently work through the backlog, run permitted isolated tests, make scoped repairs, update docs and issue reviewable pull requests. It does **not** mean they can acquire privileged secrets, invoke production APIs, incur costs, change external roles, merge protected branches, or deploy live systems without permission. Never claim work was performed when it was only planned.

## Proposed technology

- pnpm monorepo, TypeScript, React SPA, Node API, background worker, PostgreSQL 16+ (verify current supported version), S3-compatible object storage and isolated Docker Compose for development.
- Modular monolith with explicit typed boundaries. React UI for creator/respondent/admin; separate authz/context layer; design contracts in `api/openapi.yaml`.
- Review actively maintained packages and licences before selecting a survey renderer, editor, auth library or queue implementation. SurveyJS Form Library may be evaluated as a replaceable rendering implementation; Survey Creator licence must be verified before production use. Do not import LimeSurvey/Formbricks proprietary code as a shortcut.
- Generic OIDC with adapters for Entra and Keycloak; optional HELP Student App, SIS/LMS, registry and feedback workflow integrations.
- Deployment: Docker Compose and reverse proxy reference as baseline; documented portability to Kubernetes/managed containers; never expose DB, worker, internal metrics or admin API publicly.

## Agent structure and protected work

1. **Architect/integration lead**: contracts, module boundaries, schema migration sequencing, merge gate, integration test environment. Owns central contracts/migrations.
2. **Product UX**: survey builder, respondent UI, user dashboard, responsive layout, accessibility.
3. **Core services**: survey definitions, publication, runtime, responses, workspace and tenancy.
4. **Advanced/research**: branching, piping, randomisation, multilingual, psychometrics, research datasets, JASP-compatible exports.
5. **Platform operations**: installation wizard, admin centre, queues, retention, backup verification, alerts, telemetry and security.
6. **Independent evidence reviewer**: adversarial tests, cross-tenant / anonymity / data loss scenarios, accessibility, upgrade/restore checks, review reports; no self-certification of own feature.

Parallelise only disjoint directories and contracts. Use a single integration owner; no competing migrations or overlapping source edits. Each agent works in a separate branch/worktree. All changes funnel through PRs and CI with independent review. Limit active work to 3–4 coding branches until merge throughput is demonstrated.

## Required execution infrastructure

All agents work from an authorised **GitHub repository**, with branch/commit provenance and PR-based evidence. Runtime work must access a Docker Engine (preferably Docker Desktop on the user's local development machine or a trustworthy isolated CI runner), pull vetted images from Docker Hub when needed, and start a disposable real PostgreSQL instance. Do not confuse Docker Hub connectivity with Docker daemon access. Every vertical slice must run as containers with migrations, fixture data, browser/API tests and direct SQL persistence assertions. Follow `GITHUB_DOCKER_RUNTIME_VERIFICATION.md`. If the runner cannot access local Docker, mark runtime verification blocked and do not report success. Never expose Docker daemon ports or execute untrusted PRs with a privileged local runner.

## Execution waves (development, not deployment approval)

| Wave | Duration estimate* | Deliverable | Dependencies |
|---|---:|---|---|
| 0 — bootstrap/contracts | 1–2 weeks | reproducible local boot, DB migrations, schema/API contracts, fixture data, CI | none |
| 1 — vertical survey journey | 2–4 weeks | create, preview, publish, submit, see results, export, mobile E2E | wave 0 |
| 2 — platform operations + Project Listen | 3–5 weeks overlapping | user/admin dashboards, retention, safe self-healing, alerting, backup drills, feedback event adapter | 0/1 |
| 3 — advanced survey capabilities | 4–7 weeks overlapping | conditional logic, piping, quotas, multilingual, invitations, collaboration, import/export | stable schema/runtime |
| 4 — research capabilities | 5–8 weeks overlapping | consent/versioning, assignment, longitudinal pseudonyms, instruments/scoring, JASP/SPSS/R outputs, provenance | schema + permissions + export engine |
| 5 — integration/evidence/release preparation | 3–5 weeks | multi-tenant/security UAT, load test, restore drills, documented deployment; feature-by-feature operational gate | all relevant modules |

*Estimates are indicative overlapping elapsed windows with 3 experienced engineers plus AI agents and independent security/QA. A complete, validated package is more credibly **14–22 weeks**, potentially longer for complex research features and field feedback. A Stage 1 controlled pilot may be available in **5–8 weeks** if it independently passes required gates. An AI-only single developer setup should assume substantially longer. Do not compress security or privacy review to meet a date.

## Mandatory workstream backlog

- **CORE-01**: workspace/organisation tenancy; enforced authz and isolation at data/API layers, security regression cases.
- **CORE-02**: survey definition registry and immutable published version; stable question/option identifiers; migration strategy.
- **CORE-03**: reusable questionnaire runtime, input validation, idempotent submissions, safe partial-response handling.
- **UX-01**: beginner-friendly survey creator with templates, preview, accessible respondent experience and progress indicator.
- **UX-02**: personalised owner dashboard, collaboration affordances, reports, exports, notices; separate admin console.
- **OPS-01**: admin setup wizard, secrets provisioning/checks, bootstrap admin, first-use tour, configuration test.
- **OPS-02**: health checks, durable queue with retries/dead-letter, backup/restore drill, bounded auto-recovery and alert escalation.
- **OPS-03**: retention rules, expiry reminders, export before disposal, legal hold, backup deletion/tombstone controls.
- **SEC-01**: threat model, strong auth, row/workspace permissions, rate limit, CSRF/session checks, sanitisation, CSP, vulnerability lifecycle, supply-chain signing/scan; deployment hardening.
- **ADV-01**: advanced logic, mathematical expressions using safe AST (never eval), piping, randomisation and quotas.
- **ADV-02**: invitations, scheduling, multilingual questionnaires, reusable scale/question library and survey definition portability.
- **RES-01**: ethics/consent metadata, separated participant identity, authorised research holds and withdrawal workflows.
- **RES-02**: experimental assignment, longitudinal study linkage, scale scoring, repeatable analysis exports with reproducibility manifest.
- **EXPORT-01**: Stage 1 JASP-friendly CSV bundle with codebook and variable measurement level; Stage 3 labelled SPSS `.sav` when tested; R/Python clean formats. No JASP runtime dependency.
- **LISTEN-01**: privacy-safe Project Listen response summaries and case event integration with external service desk/tracker, receipt/retry/dedupe, human triage, assignment and closure status.
- **QA-01**: smoke, browser E2E, accessibility, concurrency, restore, isolation, privacy, fault injection and upgrade regression suites.
- **DOC-01**: README, architecture, API/OpenAPI, development guide, installation wizard, deployment and incident runbooks, operator guide, full handoff and evidence ledger.

## Automated loop

1. Read the project spec and feature matrix; identify next unblocked item, security/data impact and touched modules.
2. Create dedicated branch and PR-sized change; add/update tests and docs at implementation time.
3. Run locally: formatting, lint, typecheck, unit/integration tests, database/RLS tests, API contract tests, UI E2E as relevant, dependency/SAST/secrets/container scans.
4. Run targeted failure scenarios; record exact command, revision and environment. Do not label mocked tests as live integration evidence.
5. Independent reviewer challenges the PR: **What can fail despite all green checks, how would it be noticed, and how can it be contained/recovered?**
6. Fix material findings. After three unsuccessful review/fix rounds, stop that PR for design reassessment; continue unrelated safe work.
7. Integrator verifies migrations, compatibility, feature flags, docs, and merge conflicts. Approval required for protected merges/releases.
8. Update `docs/BUILD_STATUS.md` and `docs/EVIDENCE_LEDGER.md`: implemented vs unimplemented, exact tests, blockers, accountable reviewer and next work.
9. Repeat until the complete feature matrix is verified. Report unknowns rather than inventing a pass.

## Release gates despite full-scope build

- **Gate A**: controlled Project Listen pilot; core survey workflow, privacy and security, backups, retention, JASP-friendly output, self-healing and admin monitoring demonstrated.
- **Gate B**: feedback-to-action workflow operational with assigned owners, privacy-safe handoff, escalation, evidence of closure; explicit acceptance required prior to expansion in HELP production.
- **Gate C**: advanced features verified for general availability and compatible with existing survey definitions.
- **Gate D**: research features verified with academic representative, ethics/privacy review, independent analyses and export provenance.

All work may be *built* in parallel but gates A–D control *production activation*. Work on Stage 2/3 does not auto-authorise production enablement.

## Evidence and completion requirements

Deliver runnable source, `compose.yaml`, `.env.example`, scripts for setup/check/backup/restore/migrate, migration files, tests, licences/SBOM, API contract and docs. An executable `install`/`doctor` workflow must run in an isolated clean environment. Provide known-working container/image digests and reproducible build instructions, not a claim of 'secure' without test evidence. Final report must clearly distinguish verified functionality from design-only functionality.

## Adoption workstream amendment — build with the full scope

Add `UX-WIZ-01` (WP-048), `ACCESS-01` (WP-049), `TPL-01` (WP-050), `HELP-01` (WP-051) and `E2E-CREATOR-01` (WP-052). The Wizard and template services consume stable domain APIs. Entitlements are enforced server-side with permission checks; help content uses versioned editable records. A single UX worktree owns wizard and editor integration. Ensure parallel advanced/research work does not alter published definition semantics. Use `docs/UNATTENDED_EXECUTION_GUIDE.md` as the repeatable Codex run loop.

## Live Quiz Arena concurrent workstream

Add **LIVE-01 (WP-053)** contract/session lifecycle; **LIVE-02 (WP-054)** authoritative scoring and concurrency; **LIVE-03 (WP-055)** presenter/participant experience and four modes; **LIVE-04 (WP-056)** realtime operations, load/reconnect/security/retention integration. Integrator owns session DB schema and quiz contract. UX agent owns dedicated live screens, not scoring. Security/operations agent owns transport telemetry and fault injection. Run these after the core immutable quiz definition and respondent auth contracts are stable; they may overlap advanced/research development in disjoint directories. Use 50 simultaneous synthetic participants as an initial measured test, then report observed limits; do not claim readiness for 5,000 without evidence. Release gate `LIVE` is independent of Stages A–D.
