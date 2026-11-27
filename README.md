# v2.3 unattended coding start

Read `docs/PREFLIGHT_STOP_GATE.md`, `docs/EXECUTION_RUNBOOK.md`, `docs/CONTINUOUS_EXECUTION_CONTRACT.md` and `docs/APPROVAL_MATRIX.md` before beginning any unattended coding. The environment preflight must PASS and be reported first; otherwise STOP. Actual PostgreSQL and browser evidence is mandatory; do not defer checks. Earlier conflicting scheduling or permissions statements are subordinate to these safety and evidence rules.

> **v2.2 engineering-ready specification package:** Not executable application code. Start at [`SPEC.md`](SPEC.md), [`docs/CONTINUOUS_TESTING.md`](docs/CONTINUOUS_TESTING.md), [`docs/TASK_GRAPH.md`](docs/TASK_GRAPH.md). Documentation CI passes once verified; application CI intentionally fails closed until real Docker/PostgreSQL tests are implemented. Existing historical stage wording is superseded by SPEC.md.

# Survey Platform

**Status:** implementation specification; no application code has been written by this package.  
**Initial customer:** HELP University (Project Listen).  
**Product scope:** independent, reusable, multi-organisation survey platform; HELP integrations are optional adapters.  
**Language:** English (British spelling for UI and documentation).

**Build mode:** all stages developed together in isolated branches; production deployment is gated. See [Autonomous Build Plan](docs/AUTONOMOUS_BUILD_PLAN.md). This is a specification pack, not a compiled release.

## What this is

A self-hostable survey platform that combines low-friction authoring and respondent experience with advanced survey and academic research capabilities built under one integrated development programme. Modules can be deployed selectively after independent release verification. It is **not** a fork of LimeSurvey or Formbricks. No third-party proprietary code, UI assets or instruments may be copied without licensing review.

Three interfaces share one application backend:

1. **User workspace:** survey creation, preview, publishing, distribution, results, exports, retention notices, collaboration.
2. **Respondent experience:** mobile-first survey completion; no account required for public or genuinely anonymous surveys.
3. **Administration centre:** tenants, workspaces, policies, platform health, security and recovery events, notices, audit trails, and controlled operations.

## Non-negotiable principles

- Intuitive for non-technical staff, accessible, fast on mobile and consistent across workflows.
- Maintainable out of the box: health visibility, upgrade/migration preflight, backups, restore drills, diagnostics, alerts, documentation.
- Modular monolith with explicit boundaries and optional adapters; no HELP-specific rules in core.
- Secure and private by default; least privilege, multi-tenant isolation, no implicit access to responses by system operators.
- Resilient submissions and jobs with idempotency, retry limits and graceful degradation.
- Self-healing only for pre-authorised, reversible, bounded operational actions.
- Cyber-resilient with layered controls; edge DDoS/WAF services remain an infrastructure responsibility.
- Retention and secure disposal by design: no indefinite default survey or response retention; authorised exports before expiry.
- Actionable user and administrator notifications with ownership, severity, status and audit trail.
- API-first integration with documented and versioned interfaces.

## Delivery phases and gates

| Phase | Objective | Gate |
| --- | --- | --- |
| **Stage 1: Project Listen pilot** | Prove survey usability, collection, dashboards, retention, reliable operations, core security, basic API/events | Staff can independently create surveys; students submit on mobile; privacy, exports, backups and operational checks pass |
| **Stage 1B: feedback-to-action operations** | Establish triage, assignment, escalation, resolution verification and reporting, mainly via an *external* workflow/tracker | A real feedback cycle completes with named owners and evidence; leadership signs off |
| **Stage 2: advanced surveys** | Branching/piping, richer question types, distribution, collaboration, multilingual surveys, analytics | Can be developed alongside other modules; production enabled only after Gate C approval |
| **Stage 3: academic research** | Consent governance, randomisation, psychometrics, longitudinal studies and reproducible research exports | Can be developed alongside other modules; production enabled only after Gate D and academic/security review |

**Revised planning baseline (not a promise):** Full-scope development runs in parallel, estimated 14–22 weeks with experienced engineers and AI assistance; Stage 1 controlled pilot may be available earlier after Gate A. Feature flags and independent gates protect production activation. See `docs/AUTONOMOUS_BUILD_PLAN.md`.

## Suggested technical stack

- TypeScript monorepo: React web UI, Node.js API, background worker, shared packages.
- PostgreSQL **dedicated database per deployment**, with tenant isolation enforced in code and database (RLS where appropriate).
- Durable DB-backed jobs initially; move to a dedicated queue only if measurements demand it.
- S3-compatible object storage abstraction for attachments and short-lived exports.
- Docker Compose local deployment. Cloud Run, Kubernetes or on-premises hosting may be implemented later with the same contracts.
- OpenID Connect for external SSO; local bootstrap admin credentials only with mandatory password controls and MFA support as applicable.
- OpenAPI 3.1. The checked-in contract is the source of truth and must be checked against runtime behaviour in CI.

These are **recommended choices**, not an existing implementation.

## Repository layout to create

```text
survey-platform/
  apps/web/                       # User workspace, respondent UI, admin centre
  apps/api/                       # Versioned REST API
  apps/worker/                    # Email, webhooks, expiry, export, repair jobs
  packages/contracts/             # Shared API and domain schemas
  packages/survey-runtime/        # Published-survey rendering + validation
  packages/security/              # Authorisation, tenancy, privacy primitives
  packages/database/              # Models, migrations, RLS, seed fixtures
  packages/events/                # Transactional outbox, consumers, retries
  adapters/identity/              # Generic OIDC + optional Entra/Keycloak
  adapters/institutional/         # Optional HELP SIS, Person Registry, Moodle
  docs/                           # Keep this pack under version control
  api/openapi.yaml
  infra/docker/
  tests/unit/ tests/integration/ tests/e2e/ tests/security/
  README.md INTENT.md HANDOFF.md
```

## JASP compatibility

[JASP](https://jasp-stats.org/) is a first-class supported analysis destination. Stage 1 provides a **JASP-friendly CSV research bundle** with a codebook and import guide, alongside ordinary CSV export. Stage 3 targets labelled SPSS `.sav` export (which JASP can open), subject to tested format fidelity. The platform does not bundle JASP, run JASP analyses, or promise native `.jasp` project-file generation. See [docs/JASP_COMPATIBILITY.md](docs/JASP_COMPATIBILITY.md) and [docs/API_GUIDE.md](docs/API_GUIDE.md).

## Documentation index

- [INTENT.md](INTENT.md): vision, scope, product principles, constraints, stage gates.
- [HANDOFF.md](HANDOFF.md): autonomous developer instructions, work packages, acceptance criteria and operational rules.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): module boundaries, data model, tenancy, privacy, events.
- [docs/SECURITY_OPERATIONS.md](docs/SECURITY_OPERATIONS.md): threat model, self-healing, incident controls, backup/restore.
- [docs/DATA_RETENTION.md](docs/DATA_RETENTION.md): retention, expiry, deletion and exports.
- [docs/PROJECT_LISTEN.md](docs/PROJECT_LISTEN.md): pilot journeys and feedback-action boundary.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): developer setup, verification and conventions.
- [docs/AUTONOMOUS_BUILD_PLAN.md](docs/AUTONOMOUS_BUILD_PLAN.md): complete-scope unattended build and agent work allocation.
- [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md): install wizard, upgrade, restore and exposure checks.
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md): cyberattack defence, low-exposure deployment and bounded self-healing.
- [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md): all stages and acceptance evidence.
- [docs/OPERATOR_GUIDE.md](docs/OPERATOR_GUIDE.md): admin dashboard, notices and maintenance operations.
- [docs/BUILD_STATUS.md](docs/BUILD_STATUS.md), [docs/EVIDENCE_LEDGER.md](docs/EVIDENCE_LEDGER.md): truthful build progress and test results.
- [api/openapi.yaml](api/openapi.yaml): initial OpenAPI contract. See [docs/API_GUIDE.md](docs/API_GUIDE.md) for semantics, integration examples and evolution rules.

## GitHub and real-container verification

The source repository on GitHub is the single source of truth. See [GitHub, local Docker and real PostgreSQL verification](docs/GITHUB_DOCKER_RUNTIME_VERIFICATION.md) for the required CLI environment, pinned image checks, isolated Compose stack, database-backed E2E and evidence protocol. **A green source lint/typecheck is not sufficient.** The implementation must include runnable `doctor`, `test-stack`, backup/restore-test scripts, CI workflow and an installation guide. Docker Hub is an image registry; Docker Engine/Docker Desktop must be available separately. Nothing in this handoff package itself is a runnable survey platform.

## Getting started

The local development workflow creates and publishes a single-choice survey, collects anonymous responses, and displays results and an authenticated JASP CSV export. It uses a React browser client, PostgreSQL and a separate export worker.

Follow the [development runbook](docs/progress/ENG-001-002-setup.md) to install the locked dependencies and Chromium. Run the full synthetic demonstration from the survey workflow branch:

```sh
corepack pnpm test:stack
```

The Playwright journey creates its own development session and workspace, submits answers, restarts PostgreSQL, checks stored answers directly in SQL, and reconciles the browser chart and downloaded ZIP. The test retains the chart screenshot and sample archive under `test-results/`. See [build status](docs/BUILD_STATUS.md) for implementation and release scope.

### Local Live Poll lobby

The disposable test stack enables the Live Poll lobby. The normal stack leaves it disabled. Open `/live/host` on the loopback app with a development session token and the ID from an authorised survey's publish response. Use a published version with single-choice questions. Share the eight-digit PIN with a synthetic guest at `/live/join` within 30 minutes.

The presenter and guest retrieve the current lobby over a same-origin WebSocket. Each connection delivers one snapshot, and Refresh lobby opens another connection. A guest capability stays in the current page and expires after eight hours. See the [test criteria](docs/LIVE_QUIZ_TEST_CRITERIA.md) and [remaining Live Quiz Arena release gates](docs/LIVE_QUIZ_ARENA.md).

## Product governance

- Publication is versioned and immutable once collecting responses.
- Anonymity is a technical guarantee, not a UI label.
- No unlimited default retention. Survey owners can export before expiry, under permissions and policy.
- A platform administrator does **not** automatically have permission to read identifiable survey responses.
- Follow-up case records belong in a separate action-management service. The survey platform emits privacy-safe, authorised signals through an integration boundary.
- No automatically deployed AI-generated source-code fixes or privileged policy changes.

## Definition of done

Work is complete only when code, tests, threat/permission review, migration/rollback strategy, API contract, user/admin guidance and a reproducible verification report are all delivered. See `HANDOFF.md`.

## Extended survey interactions and channels

The single full-scope build also specifies accessible drag-and-drop multipage surveys, NPS/matrix/ranking/file/image questions, safe branching/piping, in-app OIDC survey launches, email/SMS/QR/embed/reminders, kiosk/offline collection and privacy-governed sentiment analysis. Self-healing operations must record administrator-readable incidents and recovery outcomes. These are **requirements, not implemented capabilities**. Read [Interaction, Channels and Intelligence](docs/INTERACTION_CHANNELS_INTELLIGENCE.md) and the test gates in `HANDOFF.md`.

## Guided creation and self-service adoption

Users begin with **Create → Survey / Quick Poll / Pop Quiz / Feedback / Evaluation / Research**. A guided wizard recommends a curated template, helps configure audience/privacy, supports multipage drag-and-drop questions, previews a draft, checks publication readiness and publishes an immutable version. Users can switch to Expert Mode without losing advanced settings. A searchable contextual user guide explains each step. Specialised features can be discovered in a categorised Feature Catalogue and requested for approval; API enforcement is mandatory.

Documentation: [Smart Creation Wizard](docs/SMART_CREATION_WIZARD.md) · [Feature Catalogue and Requests](docs/FEATURE_CATALOGUE_AND_REQUESTS.md) · [Template Library](docs/TEMPLATE_LIBRARY.md) · [User Guide and Onboarding](docs/USER_GUIDE_AND_ONBOARDING.md) · [Unattended Execution](docs/UNATTENDED_EXECUTION_GUIDE.md) · [Codex agent instructions](AGENTS.md).

**Verification warning:** These files specify features; they do not demonstrate an installed or working platform. Follow the evidence ledger and Docker/PostgreSQL runtime gates.

## Live Quiz Arena

The Smart Creation Wizard supports a **Live Quiz Arena** delivery choice alongside self-paced quizzes. A lecturer can host a synchronised quiz using a PIN or QR code and choose Game Show, Classroom Learning, Live Poll or Formal Assessment styles. The same canonical questionnaire, answers, policies and export pipeline apply. Game scores and rankings are optional; results and visibility follow configured privacy rules. See [`docs/LIVE_QUIZ_ARENA.md`](docs/LIVE_QUIZ_ARENA.md). Runtime verification needs actual local realtime transport, Docker containers, PostgreSQL and concurrent participant tests; it is not included as runnable code in this specification package.
