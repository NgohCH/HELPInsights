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
2. **Respondent experience:** mobile-first survey completion. Public audiences can respond without an account. University-only audiences sign in and can submit anonymous answers.
3. **Administration centre:** tenants, workspaces, policies, platform health, security and recovery events, notices, audit trails, and controlled operations.

The development Operations page at /admin shows API, database and migration
health and up to 100 recent incidents for a session with an explicit platform
operations role. Operators can record allowlisted incident events through
the API. The disposable test stack also records a redacted incident pair after
the export worker verifies recovery from a PostgreSQL interruption. Workspace
ownership and survey access use separate permissions. See
[Operations and security](docs/SECURITY_OPERATIONS.md).

The development survey API exposes workspace-scoped retention status and
hold approval for appointed workspace members. PostgreSQL protects core
survey data from deletion before expiry and during active holds. See
[Retention policy and scope](docs/DATA_RETENTION.md).

The retention API also includes a read-only disposal preview for appointed
reviewers. Disposal and replay run only in the isolated test fixtures.

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

For a guided draft, select a workspace with a retention policy and choose **After-class feedback** under **Guided creation**. Edit the five prompts and choice labels, then save and open **Preview draft**. Only **Publish survey** creates an anonymous respondent link. If the saved draft changes elsewhere between preview and publication, publication returns a revision conflict and leaves the existing draft and versions intact.

To restructure a saved draft, open it in **Workspace surveys** and choose **Edit saved draft**. Add and name pages and add supported questions. On desktop, drag a page or question by its handle and drop it on a highlighted line. To make the same moves with a keyboard or touch, use the move buttons. For a move between pages, choose the destination page and the position on that page. Move feedback announces the new position. The editor blocks changes that would break an existing conditional question or answer-label reference. **Save edits** uses the loaded draft revision and leaves published versions intact.

To reuse an answer label in a later question, open **Edit answer label source** and choose an earlier unconditional single-choice question. **Preview saved draft** and the published response form append the selected option label to the question wording. If the respondent skips the earlier question, the original wording appears on its own. Live Poll and Game Show use the original wording. Analytics and CSV codebooks use the original wording, and responses store option codes.

In the creator, choose a workspace and select **Browse templates** to preview **Event feedback**. A workspace owner or editor can select **Use this template** to start an independent anonymous draft under the workspace’s retention policy. The preview does not open a respondent link.

The development **Feature catalogue** lets workspace owners and editors request NPS authoring for anonymous surveys. A delegated workspace reviewer can approve time-limited access or deny the request. Approval unlocks 0–10 NPS questions for authoring and publishing.

To publish a reopened draft, choose **Publish saved draft** and select who can respond. A University-only publication requires an approved workspace policy. Each publication has its own respondent link. **End response collection** closes the survey's ordinary respondent links after confirmation. The previously collected responses and published versions are retained.

Open a saved survey and use **Reporting publication** to choose an earlier version. **View results** applies the publication's own question wording and privacy thresholds. **Export JASP CSV** uses the displayed publication and remains available after collection closes for authorised users.

During authoring, **Show a follow-up when** lets you attach a required text question to one choice. The saved preview uses the same rule as the published form. Exported blanks can mean a question was hidden or was visible and unanswered. The analytics response count covers the entire published version.

The disposable test stack also starts a private Person Registry simulator for synthetic eligibility checks. Tests publish a restricted test distribution, verify a synthetic credential, and collect an anonymous response. The default local stack uses open survey links. The temporary capability grants access to a restricted test link, and the separate `Idempotency-Key` handles retries of one submission. Simulator outages suspend new verification until recovery. Existing capabilities remain valid until expiry. [Project Listen development scope](docs/PROJECT_LISTEN.md#synthetic-registry-development-slice)

Admin Settings manages template and synthetic research consent access by workspace, individually or through approved groups. The disposable test stack exercises Entra group claims and system-administrator registration, scoped use, renewal and revocation of integration clients. See the [API and administration guide](docs/API_GUIDE.md#creator-tool-settings).

The disposable test runtime also supports a versioned, fixed synthetic consent notice on opted-in single-choice surveys. Declining leaves no response. Academic studies, governed research retention, and production activation require separate release evidence. [Research acceptance scope](docs/FEATURE_MATRIX.md#synthetic-research-consent-development-slice)

For a first-run development check, run `corepack pnpm doctor:local` to report local prerequisites and `corepack pnpm install:demo` to install locked dependencies and verify the synthetic workspace-owner survey journey on disposable PostgreSQL and Chromium. The demo cleans up its Compose resources and prints a redacted receipt. For a deployment review, run `corepack pnpm deploy:checklist`. [Local first-run instructions](docs/DEPLOYMENT_GUIDE.md#local-development-first-run) · [Deployment checklist](docs/DEPLOYMENT_GUIDE.md#wizard-checklist-and-readiness-evidence) · [Production prerequisites and procedure](docs/DEPLOYMENT_GUIDE.md#prepare-before-the-deployment-window)

Follow the [development runbook](docs/progress/ENG-001-002-setup.md) to install the locked dependencies and Chromium. Run the full synthetic demonstration from the survey workflow branch:

```sh
corepack pnpm test:stack
```

The Playwright journey creates its own development session and workspace, submits answers, restarts PostgreSQL, checks stored answers directly in SQL, and reconciles the browser chart and downloaded ZIP. The test retains the chart screenshot and sample archive under `test-results/`. See [build status](docs/BUILD_STATUS.md) for implementation and release scope.

In the disposable test stack, open **Synthetic case handoff** from the
workspace home and use the appointed reviewer token, published version and
synthetic basis provided by the fixture. Approval queues a redacted event
in PostgreSQL. [Project Listen case handoff](docs/PROJECT_LISTEN.md#synthetic-case-handoff-development-slice)

### Institutional OAuth development scope

The API can verify a delegated institutional access token for `GET /api/v1/me` and `GET /api/v1/workspaces`. Enable the path by setting all four server runtime variables `HELPINSIGHTS_OAUTH_ISSUER`, `HELPINSIGHTS_OAUTH_AUDIENCE`, `HELPINSIGHTS_OAUTH_SCOPE` and `HELPINSIGHTS_OAUTH_JWKS`. Leave them unset to keep this path disabled. Supply the canonical HTTPS issuer and a dedicated single API audience. The JSON public key set accepts up to eight approved RSA signature keys containing only `kty`, `alg`, `use`, `kid`, `n` and `e` (RSA, RS256 and sig). Key updates require replacing the configured set and restarting. The verifier has no external network dependency.

A deployment administrator provisions the explicit issuer and subject binding to an existing local user through controlled database access. The API checks the signed delegated `scp` claim and reads only workspaces in that user's actual PostgreSQL memberships. The bearer and provider subject stay out of API responses. The existing development session and anonymous respondent flows retain their current entry points.

The delegated endpoints need separate approval and acceptance in the live Entra tenant.

### University browser sign-in

Set `HELPINSIGHTS_ENTRA_TENANT`, `HELPINSIGHTS_ENTRA_CLIENT_ID`, `HELPINSIGHTS_ENTRA_CLIENT_SECRET`, `HELPINSIGHTS_ENTRA_ORIGIN` and `HELPINSIGHTS_ENTRA_DATABASE_URL` on the server to enable interactive sign-in. Use a single-tenant confidential web app registration in Microsoft Entra public cloud and register `<HTTPS app origin>/auth/university/callback` as its exact web redirect URL. Supply the client secret and identity database URL through the approved secret store. An administrator grants the dedicated login membership in `helpinsights_identity` only. The normal runtime database role cannot issue University sessions.

University IT applies the approved Entra Conditional Access MFA policy. For each approved user, the local identity administrator associates the verified issuer and the subject from this specific browser client with an existing local account. Review workspace roles separately. Sign-in creates a 30-minute application session. Sign-out revokes that application session, and removing a binding deletes its existing sessions. Sign-in grants access according to existing workspace roles. At /admin, use the same University sign-in with an explicit platform operations role to view service health and redacted incidents.

The sign-in attempt is held on the instance that starts it for five minutes. Use a single app instance or ensure the callback reaches the same instance. An instance restart during sign-in requires the user to start again. Established sessions are backed by PostgreSQL. Keep callback query strings out of proxy access logs and apply upstream rate limits to the sign-in start endpoint. The application limits pending sign-in attempts per instance. Readiness checks the dedicated database role and session grants. To disable browser sign-in, remove all five Entra variables on every instance. Keep migration 017 applied and follow the reviewed rollback procedure for any database restore. The prior migration does not support University browser sessions. Live acceptance needs approved test accounts and the actual Entra MFA policy. See the [authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

### Admin Settings

Open `/admin/settings` after University sign-in with an explicit system administrator assignment. Configure template copying and manage workspace-scoped approvals for existing users or approved identity groups. See the [access contract](docs/API_GUIDE.md#creator-tool-settings).

### University-only survey development

The disposable stack enables University-only collection for synthetic tests. After saving a draft, choose **University accounts only** in **Audience** and select an approved policy version from the survey workspace. Respondents sign in and need a current grant for that exact policy. **Anyone with the link** remains the default. [Publication and privacy contract](docs/API_GUIDE.md#university-only-distributions)

### Local Live Poll lobby

The disposable test stack enables Live Poll and Game Show. After publishing a compatible public survey, choose **Present a Live Poll** or **Present a Game Show** in the creator workspace. The presenter uses the current sign-in and the published version automatically. Share the eight-digit PIN with a synthetic participant at `/live/join` within 30 minutes. Local development can also open `/live/host` with a development session token and the version ID.

If you reload the same creator tab, choose **Resume live presentation** to return to your latest active Live Poll or Game Show. The app checks the current University sign-in and opens that room. The plaintext join PIN is available when you first open the lobby. Reloading clears it from the presenter screen. Guests can keep using a shared PIN until it expires.

The presenter can start, pause, resume, end and archive the poll. The presenter and guest see committed state changes over a same-origin WebSocket. A disconnected tab reconnects to the current PostgreSQL state. Refresh lobby also reopens the connection. Guest credentials stay in the current page and expire after eight hours. Once running, the presenter opens and advances questions in published order. Each guest can cast one vote per question and see their own receipt. The presenter sees turnout in groups of five and may close the question to reveal exact counts when the category and nonvoter groups meet the privacy threshold. See the [voting test criteria](docs/LIVE_POLL_VOTING_TEST_CRITERIA.md) and [remaining Live Quiz Arena release gates](docs/LIVE_QUIZ_ARENA.md).

### Local timed Game Show

The disposable test stack opts in to Game Show through LIVE_GAME_SHOW_ENABLED. Open /live/game-host and supply a published version with one unconditional single-choice question. The presenter enters its exact correct option code and sets an answer time of 5 to 120 seconds. Guests join at /live/join.

Opening the question starts the PostgreSQL clock. A pause prevents new answers while the deadline continues. Resuming and reconnecting keep the same deadline. The private accuracy_v1 rule records 1000 points for a correct answer and zero otherwise. Participants receive their own answer receipt. Scores and the answer key stay private in this slice.

An anonymous room requires an open distribution. The Registry and research consent integration must establish that a source version permits anonymous reuse before activation. See the [Game Show verification criteria](docs/GAME_SHOW_SCORING_TEST_CRITERIA.md).

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

The disposable test stack exercises export worker recovery. The full-scope requirements include accessible drag-and-drop multipage surveys, additional question formats, broader branching, in-app OIDC survey launches, email, SMS, QR, embeds, reminders, kiosk and offline collection, privacy-governed sentiment analysis and automated recovery notices. [Interaction, Channels and Intelligence](docs/INTERACTION_CHANNELS_INTELLIGENCE.md) · [Test gates](HANDOFF.md)

## Guided creation and self-service requirements

Users begin with **Create → Survey / Quick Poll / Pop Quiz / Feedback / Evaluation / Research**. A guided wizard recommends a curated template, helps configure audience/privacy, supports multipage drag-and-drop questions, previews a draft, checks publication readiness and publishes an immutable version. Users can switch to Expert Mode without losing advanced settings. A searchable contextual user guide explains each step. Specialised features can be discovered in a categorised Feature Catalogue and requested for approval; API enforcement is mandatory.

Documentation: [Smart Creation Wizard](docs/SMART_CREATION_WIZARD.md) · [Feature Catalogue and Requests](docs/FEATURE_CATALOGUE_AND_REQUESTS.md) · [Template Library](docs/TEMPLATE_LIBRARY.md) · [User Guide and Onboarding](docs/USER_GUIDE_AND_ONBOARDING.md) · [Unattended Execution](docs/UNATTENDED_EXECUTION_GUIDE.md) · [Codex agent instructions](AGENTS.md).

**Verification warning:** These files specify features; they do not demonstrate an installed or working platform. Follow the evidence ledger and Docker/PostgreSQL runtime gates.

## Live Quiz Arena

The Smart Creation Wizard supports a **Live Quiz Arena** delivery choice alongside self-paced quizzes. A lecturer can host a synchronised quiz using a PIN or QR code and choose Game Show, Classroom Learning, Live Poll or Formal Assessment styles. The same canonical questionnaire, answers, policies and export pipeline apply. Game scores and rankings are optional; results and visibility follow configured privacy rules. See [`docs/LIVE_QUIZ_ARENA.md`](docs/LIVE_QUIZ_ARENA.md). Runtime verification needs actual local realtime transport, Docker containers, PostgreSQL and concurrent participant tests; it is not included as runnable code in this specification package.
