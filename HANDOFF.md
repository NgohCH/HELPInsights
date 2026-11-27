# v2.3 mandatory unattended entry gate

Read `docs/PREFLIGHT_STOP_GATE.md`, `docs/EXECUTION_RUNBOOK.md`, `docs/CONTINUOUS_EXECUTION_CONTRACT.md` and `docs/APPROVAL_MATRIX.md` before beginning any unattended coding. The environment preflight must PASS and be reported first; otherwise STOP. Actual PostgreSQL and browser evidence is mandatory; do not defer checks. Earlier conflicting scheduling or permissions statements are subordinate to these safety and evidence rules.

> **v2.2 current instruction:** `SPEC.md` is authoritative for current requirements and unified-build policy; `docs/CONTINUOUS_TESTING.md` enforces NO DEFERRAL. Historical phase/amendment wording below is subordinate. Start with ENG-001–ENG-005 in `docs/TASK_GRAPH.md`; current archive contains documentation only and *intentionally failing* runtime-required GitHub gate until application+real tests exist. Do not delete/disable the gate to get green. `docs/CI_AND_BRANCH_PROTECTION.md` describes required GitHub rulesets.

# HANDOFF — Autonomous implementation guide

**Project:** Independent Survey Platform (HELP University first implementation)  
**Status:** authorised for specification and local/isolated development of **all stages** under this document; production deployment and live external actions need separate approvals.  
**Owner/approvers:** **TBD — assign before production**. Never invent owners, approvals, dates or operational credentials.  
**Read first:** `README.md`, `INTENT.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_OPERATIONS.md`, `docs/DATA_RETENTION.md`, `docs/PROJECT_LISTEN.md`, `docs/API_GUIDE.md`, `api/openapi.yaml`.

## 0. Mission to developer / AI coding agent

Build an independent general-purpose survey platform that is extremely easy to use and maintain, modular, secure and reliable by design. HELP University Project Listen is the first deployment, not a hard-coded product dependency. Implement **all stages within a single unattended development programme** with feature branches and shared architecture. Stage 1 and 1B remain the first production priorities, but Stage 2 advanced and Stage 3 research features may be developed and tested in isolation concurrently. Production enablement of each stage requires a separate evidence-backed release gate. Follow `docs/AUTONOMOUS_BUILD_PLAN.md`.

The implementation must be runnable locally, automatically testable, versioned, documented, and deployable by controlled steps. Do **not** report completion without commands, test results and source references.

## Mandatory GitHub / Docker / database execution gate

Read and follow **`docs/GITHUB_DOCKER_RUNTIME_VERIFICATION.md`**. GitHub is authoritative; every deliverable must be built from a recorded GitHub commit and tested inside an isolated Docker stack using a **real PostgreSQL database**. Static source checks or simulated APIs cannot substitute for database-backed runtime tests. Before working, verify Git remote, branch, SHA, Docker Engine/Compose access and Docker Hub image-pull ability; distinguish registry access from access to the local daemon. If the agent cannot reach the user's machine, report the limitation and use an authorised local execution agent/runner; never pretend Docker was used. Record migration, API/UI E2E, durable SQL assertions, fault injection, backup/restore and security evidence. No production write/merge/deploy without approval.

## 1. Operating rules for autonomous build

### Allowed without further approval

- Inspect the repo, create branches, edit isolated source windows, add tests/docs, generate fixtures, run local builds/typechecks/test suites/security scans, create local throwaway databases, use mock adapters, run isolated Docker Compose.
- Create draft pull requests and post factual evidence to them if the repository workflow permits it.
- Propose ADRs and tasks; mark uncertainties explicitly.

### Approval required

- Any real production/staging provider writes, tenant/account creation, sending email to real recipients, real respondent-data exports, production migrations, changes to credentials/roles/secrets, policy changes, enabling live integrations, merging/releasing to protected branches, DNS/WAF changes or deleting data outside ephemeral test environments.
- **Enabling Stage 2 or Stage 3 in production**, adding a cloud subscription/cost, publishing product outside HELP or selecting licence. Isolated development of all stages is in scope.
- All intrusive security tests against non-owned/non-isolated systems.

### Explicit prohibitions

- Never fabricate test success, consent, a policy approval or external provider capability.
- Never push secrets, respondent records, copied proprietary source code or unlicensed instruments.
- Never grant super-admin access as a fix for failing permissions.
- Never let AI autonomously write and deploy patches to production, change firewall-wide settings or run unrestricted shell commands from the admin interface.
- Never make anonymous response content linkable to identity by default; no Person Registry ID, raw IP tracking or invitation-to-response key in anonymous responses.
- Never build a HELP-specific workflow directly into the core survey modules.

## 2. Execution approach

Adopt **vertical slices**. Complete a small end-to-end journey with test evidence before building broad infrastructure. Each work package must include domain code, UI/API changes, tests, migrations/fixtures as relevant, docs and a PR. Work on protected source windows serially; parallelise only disjoint modules with explicitly assigned interfaces. Do not have multiple agents modify the same database migration or central contracts simultaneously.

### Initial bootstrap decisions

1. Inspect existing repo and available tooling; if empty, initialise pnpm TypeScript workspace, React UI, Node API, worker, PostgreSQL migration runner, Docker Compose, lint/format/test pipelines and security scanning.
2. Choose and record libraries and versions in an ADR (prefer actively maintained, compatible, production-ready packages; check current security advisories). Do not assume dependencies or live versions from this design pack.
3. Define tenant/session context, DB scopes and privacy boundaries **before** implementing public endpoints.
4. Define schema versioning and API contracts; generate shared request/response types from OpenAPI or an equivalent single source of truth.
5. Create local example fixtures and a documented one-command bootstrap with `.env.example` and test-only secrets.
6. Add CI gates on every PR; all production migrations require reviewed scripts and rollback/forward-fix plan.

## 3. Work packages and dependencies

| WP | Scope | Depends on | Acceptance evidence |
|---|---|---|---|
| WP-001 | Repository scaffold, Docker/local DB, worker, CI, docs skeleton | none | clean local boot; tests/typecheck; CI evidence |
| WP-002 | Organisation/workspace/identity/roles; tenant isolation | 001 | cross-tenant denial, role matrix, RLS tests |
| WP-003 | Versioned survey schema, draft CRUD, validation | 001,002 | schema round-trip, invalid definitions rejected |
| WP-004 | Survey builder and user dashboard | 003 | create/edit/preview in browser; keyboard/mobile UX |
| WP-005 | Publish/close lifecycle, immutable versions, links/QR | 003 | published version unchanged; safe public link |
| WP-006 | Respondent runtime, question widgets, idempotent submit | 002,003,005 | mobile E2E; no duplicates on retry; server validation |
| WP-007 | Analytics/aggregates, safe CSV + codebook export | 006 | export matches version and permissions; formula escaping |
| WP-008 | Retention policy, expiry notices, async disposal/export TTL | 002,005,006,007 | retention/hold/restore tombstone tests |
| WP-009 | Admin control centre, health, audit, action notices | 001,002 | operational UI; no implicit response access |
| WP-010 | Bounded self-healing, backups/restore, security hardening | 001,006,009 | fault injection, restore drill, security test evidence |
| WP-011 | Project Listen template, fixture adapters, initial pilot | 004-010 | complete staff/respondent/admin pilot journey |
| WP-012 | Stage 1 UAT, accessibility, penetration review, launch gate | 011 | independent sign-offs + defects disposition |
| WP-013 | Stage 1B event/outbox case handoff to external workflow | 007,009,012 | redacted event, retry and dedupe tests |
| WP-014 | Stage 1B operational case lifecycle and reporting proof | 013 | real owner assignment, closure evidence and gate review |
| WP-020+ | Stage 2 advanced survey features | 003,005,006 and stable logic contract | tests and review; production feature flag OFF until Gate C |
| WP-030+ | Stage 3 research features | 002,003,007, research privacy contract | research fixture/golden export tests; production flag OFF until Gate D |

No date/owner is inferred by these work-package IDs. Prioritise WP-001 to WP-011 with small PRs and frequent integration. WP-009/010 must be present before pilot go-live, not added as cosmetic panels later.

### JASP export requirement (cross-stage contract)

- JASP is a supported downstream statistical analysis application: https://jasp-stats.org/ . Read `docs/JASP_COMPATIBILITY.md` before implementing exports.
- As part of **WP-007**, implement `jasp_csv_bundle`: UTF-8 `responses.csv`, `codebook.csv`, `manifest.json`, `IMPORT_IN_JASP.md` inside a ZIP; enforce stable column codes, explicit nominal/ordinal/scale metadata and value/missing-value definitions. Keep existing `csv_bundle` compatibility.
- Do not claim that metadata in a separate CSV codebook is automatically applied by JASP. Include human-readable instructions for reviewing/correcting variable types in JASP, and automated structure/consistency checks.
- Verify an example bundle by opening it in a supported JASP version as Stage 1 UAT; record screenshots/test notes as evidence. Missing labels, ambiguous types, broken non-ASCII text, incorrect missing values or unexpected respondent identifiers are release defects.
- For Stage 3 (isolated build authorised; production deployment gated), reserve work package **WP-03X** for `.sav` export with richer variable/value labels, scale scoring and JASP integration tests. Do not create `.jasp` files by guessing an undocumented internal format.

## 4. Acceptance contract for Stage 1

### User usability

- Staff can create, preview, test, publish, share and view results without IT assistance; measure proposed five-question/10-minute benchmark with actual non-technical testers.
- Draft/published/closed statuses are clear. Preview submissions never appear in production analytics.
- User dashboard lists owned/shared surveys, responses, expiry/closing notices, action-required items. Empty state is helpful.
- Respondent UI works on mobile; input errors are accessible; target WCAG 2.2 AA with measured automated and manual checks.

### Survey/runtime correctness

- Support short/long text, single/multi choice, number, rating, dropdown, date, simple matrix. Validate every input on server.
- Published version immutable. Responses contain version IDs and stable question/option codes.
- At-least-once client/network retries produce one committed response through idempotency, with conflict on same key different content.
- Anonymous mode does not persist a link to identity through logs, exports, token mappings or ordinary audit events.
- No duplicate guarantee for public anonymous QR links; identified or unlinkable one-time-token modes used for eligibility as appropriate.

### Operational/admin/security

- Organisation/workspace isolation in SQL and routes; forbidden reads and exports rejected.
- Admin dashboard health, jobs, backups, security notices and retention status; authorised action lifecycle and audit.
- Health/recovery events create deduplicated notices. Bounded restarts/retries and rollback strategy tested.
- Rate limit/public abuse control, secret handling, dependency scan, SAST and deployment threat review.
- Restore drill proves recoverability; RPO/RTO agreed by operators rather than invented.

### Retention

- Policy inheritance, explicit expiry after closure, owner reminders, authorised archive export and secure disposal.
- Live data deletion includes responses and related attachments/jobs; export links expire; backup lifecycle documented; disposal ledger replay after restore.
- Holds/extension approval only by authorised role; no indefinitely retained default.

### Pilot and documentation

- Full demo: creator -> publish -> respondent submits -> chart -> export -> closure/expiry notice -> admin event -> restore/health demonstration.
- README contains real tested setup commands, design rationale, environment variables and troubleshooting; API reference generated and verified against implementation.
- Independent reviewer signs off privacy, security, permissions, usability and unresolved launch risks.

## 5. Stage 1B: operational process before Stage 2

Do **not** build a second ticketing system. Confirm preferred existing tracker/service desk with owner. Deliver privacy-safe triage integration, event delivery, operational monitoring and management reporting. The business workflow must specify who reviews, what constitutes actionable feedback, who assigns, escalation timing, verification criteria, respondent communication and retention of follow-up records. AI may propose policy/owners, never assert they are approved. See `docs/PROJECT_LISTEN.md`.

Stage 2 remains frozen until a Product Owner records the real-world Stage 1B gate decision, with at least one demonstrated completed feedback cycle.

## 6. Definition of Done (per WP)

- User-facing behaviour implemented with keyboard/mobile/accessibility review.
- Domain schema and permission checks tested, including negative and cross-tenant cases.
- Unit, integration and relevant E2E tests pass; no skipped release-critical tests.
- API contract, database migration and release notes updated together.
- Security risk and data retention implications reviewed; no secrets or sensitive records in code/logs.
- Operational metrics, error conditions, recovery steps and notices documented.
- Developer PR provides commands, versions, exact test results, risks, screenshots/fixtures where useful, rollback plan and what remains unknown.
- CI green **plus** independent review of privileged paths, auth, RLS and destructive operations; green CI alone is not sufficient proof.

## 7. Mandatory checkpoints and reports

At the end of each WP, write `docs/progress/WP-XXX.md` (or link to a PR) with:

```text
Work package / branch / commit:
Scope completed and changed files:
API/schema migrations and compatibility:
Commands executed and actual outcomes:
Security, privacy and cross-tenant test evidence:
UAT/visual review evidence:
Remaining defects and risks:
Provider actions taken (none unless approved):
Approvals required and requested:
Next non-overlapping work package:
```

Before production provide `RELEASE_READINESS.md`: feature and UX gate, threat model, scan findings and disposition, dependency inventory, access matrices, backup restoration evidence, retention dry run, alert routing, provider readiness, release/rollback steps and explicit named approval. Do not set launch success based on prototype screenshots.

## 8. First autonomous development cycle

1. Create branch `feature/wp-001-platform-foundation` (or repo-conforming naming).
2. Inspect/install supported Node/pnpm and database tooling; pin tool versions; document decisions.
3. Implement minimal API (`/health/live`, `/health/ready`), React shell (user/respondent/admin routes), worker health, migration framework, Docker Compose, `.env.example`, scripted bootstrap and standard tests.
4. Add CI lint/typecheck/unit/integration/container scan, OpenAPI lint and a simple role/tenant test fixture.
5. Create initial README instructions based on successful command output, not guessed commands.
6. Produce PR, evidence report and request independent review. Proceed only to non-overlapping WP-002/003 work after the foundation contracts stabilise.

## 9. Unresolved decisions register (block launch, not local prototyping)

- Final name/branding, code licence and commercial/open-source policy.
- Hosting region/provider, domain, edge WAF/DDoS provider, data residency and data processing agreements.
- Authentication bootstrap and HELP Entra tenancy/configuration; account provisioning policy.
- Approved default retention windows, backup TTL, exception authority, legal/research review.
- Named Product Owner, survey data owner, privacy/security approvers and incident responders.
- Project Listen exact question templates, respondent distribution modes, class/eligibility source and consent wording.
- External case-management system, Stage 1B owner and escalation SLAs.
- RPO/RTO, support hours, patch policy, vulnerability severity thresholds and operating budget.

Never silently decide any unresolved governance item. Implement safe configurable defaults for isolated development and record launch blockers explicitly.

## Full-scope build execution override (2026-11-25)

This section supersedes any earlier statements that prohibit Stage 2/3 *development* before Stage 1B sign-off; only production activation remains approval gated. Execute `docs/AUTONOMOUS_BUILD_PLAN.md` with parallel workstreams. Implement first-run wizard and `doctor` as specified in `docs/DEPLOYMENT_GUIDE.md`. All agents must keep `docs/BUILD_STATUS.md` and `docs/EVIDENCE_LEDGER.md` current. Each PR requires independent review focused on failure modes beyond green CI, and evidence for user/tenant/privacy/security impacts. See `docs/FEATURE_MATRIX.md` and `docs/THREAT_MODEL.md`.

## Additional mandatory full-scope requirements — interactive survey, channels and operational reports (2026-11-25)

Read and implement `docs/INTERACTION_CHANNELS_INTELLIGENCE.md`. This extends the full-scope autonomous build with drag-and-drop, multi-page surveys, NPS/matrix/ranking/image/file questions, secure declarative branching and piping, OIDC-based in-app launches, email/SMS/QR/embed/reminders, kiosk and offline collection, sentiment-assisted analytics, and **durable self-healing incident reports in the Administrative Control Centre**. The Person Registry and Ticketing contracts remain available from day one via simulator-tested ports. Include linked work packages WP-040 through WP-047, module boundary ownership, database-backed E2E, security/fault-injection evidence, and documented production activation gates. Compile-only verification cannot close these WPs.

- WP-040: accessible drag-and-drop and multipage authoring.
- WP-041: advanced question palette and safe file/image support.
- WP-042: declarative branching/piping and server-validation parity.
- WP-043: SSO in-app launch, trusted token verification, safe embeds and Person Registry adapter.
- WP-044: email/SMS/QR/reminders, simulator-backed delivery.
- WP-045: kiosk and verified offline queue/sync.
- WP-046: sentiment/analytics optional provider with privacy and retention controls.
- WP-047: self-healing event ledger, reports, notices, verification and escalation.

## Authoritative feature expansion — guided creation and adoption (25 November 2026)

**Read before implementation:** `docs/SMART_CREATION_WIZARD.md`, `docs/TEMPLATE_LIBRARY.md`, `docs/FEATURE_CATALOGUE_AND_REQUESTS.md`, `docs/USER_GUIDE_AND_ONBOARDING.md`, `docs/UNATTENDED_EXECUTION_GUIDE.md`, `AGENTS.md`. These requirements apply to the **single unified build**. Earlier text about deferring advanced/research development is superseded; **production enablement still requires Gates A–D**.

- **WP-048 — Smart Creation Wizard:** purpose-led wizard for survey, quiz, poll, feedback, evaluation, research; wizard state, privacy/audience, autosave, reusable canonical schema, safe Expert Mode switching, readiness check, browser+DB E2E.
- **WP-049 — Feature Catalogue and Request Centre:** discover/preview/request/approve/revoke; entitlement policy and enforced API authorisation; notifications and audit; cross-tenant/expiry tests.
- **WP-050 — Curated Template Library:** seed sample Project Listen, pop quiz, quick poll, evaluation, staff feedback, service feedback and research starters; preview, immutable master, clone/version/access control, licence metadata and E2E.
- **WP-051 — Contextual Help and User Guide:** first-run tour, in-editor help, search, role-aware help, accessible plain-language steps, versioned admin-manageable content and task-based usability tests.
- **WP-052 — Integrated creator E2E:** wizard -> template -> multipage questions -> readiness -> publish -> respondent -> PostgreSQL -> analytics/JASP export; quiz scoring and poll tally; retention and self-healing admin notice.

Agent instructions: implement actual code in PR-sized changes, protect shared schemas/contracts, supply real PostgreSQL and browser evidence (not screenshots of mocks alone), update OpenAPI and help with each change, run independent review, and never deploy live without permission. Follow `AGENTS.md` and `docs/UNATTENDED_EXECUTION_GUIDE.md`.

## WP-053–WP-056 — Live Quiz Arena (mandatory full-scope development, production gated)

Read `docs/LIVE_QUIZ_ARENA.md` before modifying quiz, scoring, survey schema, realtime or respondent sessions. The shared survey definition and publication semantics remain canonical; no second quiz database or competing scoring algorithm.

| WP | Scope | Integration verification |
|---|---|---|
| WP-053 | Live quiz domain, session states, presenter controls, session PIN/QR, mode settings and authorised join flow | Real PostgreSQL room lifecycle with immutable published quiz version; scoped presenter controls; PIN expiry and brute-force protection |
| WP-054 | Server-authoritative live question timer, submission deadlines, scoring, answer receipts, reconnect and durable results | 50 concurrent simulated participants initially; one score per player/question; deterministic tie rule; concurrent updates and rejoin proof |
| WP-055 | Presenter/projector UI, mobile participant UI, leaderboards, answer distributions, classroom/poll/assessment presentation styles, accessible reduced-motion operation | Playwright multi-browser tests, classroom screen-sharing layout, keyboard/screen reader and privacy-safe nickname modes |
| WP-056 | Real-time transport, horizontal-ready coordination, monitoring, retention, report/export integration, fault injection, documentation and independent security review | Docker + real PostgreSQL + live transport E2E; presenter disconnect, worker restart, stale events, duplicate answer, room recovery, accessibility and export evidence |

Implementation priorities: session lifecycle `draft → lobby → running → paused → ended → archived`; secure joins; verified host role; deterministic scoring; late-answer rejection; limits and abuse controls. Realtime push is a notification transport, not the source of truth. An answer acknowledgement is issued only after durable acceptance; preserve idempotency across reconnect. Agents may implement and verify locally but must not broadcast to real users or enable production Game Show without release approval.

**Do not claim verified until** actual Docker-based concurrent load, database queries and browser evidence are attached to `docs/EVIDENCE_LEDGER.md` for an exact commit. Independent reviewer must challenge timing manipulation, session hijacking, scoreboard leakage, reconnect and horizontal scale assumptions.
