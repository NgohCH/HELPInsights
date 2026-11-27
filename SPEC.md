# v2.3 verification amendment

Read `docs/PREFLIGHT_STOP_GATE.md`, `docs/EXECUTION_RUNBOOK.md`, `docs/CONTINUOUS_EXECUTION_CONTRACT.md` and `docs/APPROVAL_MATRIX.md` before beginning any unattended coding. The environment preflight must PASS and be reported first; otherwise STOP. Actual PostgreSQL and browser evidence is mandatory; do not defer checks. Earlier conflicting scheduling or permissions statements are subordinate to these safety and evidence rules.

# Authoritative Product and Engineering Specification — v2.2

**Status:** design baseline; implementation and real Docker/PostgreSQL evidence **not yet provided**. **Authority:** `INTENT.md` governs product purpose; this file governs scope and conflicting stage/implementation language; `docs/DOMAIN_MODEL.md` and `api/openapi.yaml` govern domain and API *once gaps are closed*; ADRs record approved architecture choices; `docs/CONTINUOUS_TESTING.md` governs verification; `HANDOFF.md` governs execution; `AGENTS.md` governs autonomous-agent safety. A future dated change requires a deliberate revision, not an appended override. Existing v2.1 appendices are historical context where inconsistent.

## Product outcomes
1. Independent, multi-tenant, accessible survey/poll/quiz platform, HELP first deployment but not hard-coded.
2. Guided purpose-based wizard; templates; feature catalogue/request/approval; drag/drop multipage editor; contextual guides.
3. Immutable survey versions; secure mobile/kiosk/embedded respondents; OIDC/SSO token verification; optional Person Registry eligibility; voluntary anonymous participation protected from re-identification.
4. Question bank including NPS, matrix, ranking, file/image questions; conditional visibility/branching/piping; multilingual, quota, invitations by link/QR/email/SMS and bounded reminders; offline sync with explicit limitations.
5. Live Quiz Arena: game PIN/QR, host control, realtime transport, server-clock scoring, leaderboards with opt-out, reconnection and concurrent-response integrity; self-paced quiz alternative.
6. Built-in descriptive analytics, privacy-aware filters, survey-to-action indicators, opt-in sentiment with human review; labelled CSV/codebook/JASP-ready data; research extensions for reproducibility, consent, pseudonymous longitudinal studies and SPSS/R exports. JASP is not infrastructure.
7. Retention by default with export, automatic deletion, legal holds, backup/tombstone reconciliation; system health, self-heal incident reports, alerts, security controls, WAF integration and operator dashboard.
8. Future ticketing adapter uses redacted, approved events and feedback triage; registry and ticketing both optional and simulated locally, no direct DB joins.
9. Source in GitHub; real Docker Engine and disposable PostgreSQL checks, browser E2E, backup/restore, installation wizard, first-admin setup, upgrade and rollback documentation.

## University and public access

A published survey can have an open public audience or an audience limited to eligible members of the University community. Open public surveys accept responses without a University account. University-only participation follows the University’s eligibility decision. Survey creation and publication require explicit authority in the survey’s workspace. A University account or respondent eligibility alone grants no authoring rights.

Microsoft Entra ID is the institutional sign-in option. Use OpenID Connect with OAuth 2.0 and require two-factor authentication for interactive University sign-in through University identity policy, including authoring, administration and University-only participation. University research clearance and participant consent remain external.

Deployment uses a guided checklist with readiness evidence before activation. Maintain a versioned, documented API for University and third-party applications, with separately authorised permissions and resource scope for each integration.

## Unified build, controlled activation
Build every feature family in one development programme. Project Listen release (A), feedback-to-action operations (B), advanced surveys (C), research (D), and live quiz (LIVE) have **separate production gates**. Gate B precedes HELP production expansion to C/D; do not interpret that as a ban on isolated implementation. All modules remain feature-disabled by default until corresponding policy/tests pass.

## Requirements acceptance mapping
Each feature row must map to a stable ID in `docs/FEATURE_MATRIX.md`, domain contract/API/event version, risk classification, tests, actual CI evidence, and release gate. `docs/TASK_GRAPH.md` defines initial small work slices. Never close an item with only a code diff. General usability target: first-time staff complete a 5-question survey in 10 minutes after a brief introduction, tested with representative users (target subject to pilot validation).

## Explicit exclusions / caveats
No claims of attacker invisibility, guaranteed breach prevention or self-healing of every attack. No implicit live identity access. No unlimited AI production remediation. No embedded JASP runtime. No automatic conversion of all negative responses into tickets. No claim that the current API contract completely covers the specified feature set: close the contract gaps through tracked tasks before parallel implementation.
