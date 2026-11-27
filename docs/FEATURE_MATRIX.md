> **v2.2 verification status:** Every feature below is DESIGN-SPECIFIED, NOT IMPLEMENTED and NOT TESTED in this package. `docs/TEST_MATRIX.md` defines mandatory positive/negative checks and `docs/CONTINUOUS_TESTING.md` governs the continuous/no-deferral policy. Feature owners must add stable IDs, task links, test paths, CI SHA and evidence before claiming completion.

# Full-scope implementation and acceptance matrix

This file tracks **development scope for all stages**. Production enablement is controlled independently by deployment gates. Initial status: **NOT IMPLEMENTED / NOT VERIFIED** for all items unless proven by repository test evidence.

| Module | Must deliver | Evidence to collect | Production gate |
|---|---|---|---|
| Survey authoring | builder, templates, preview, versioned draft/publish/close, common input types, accessible mobile UX | creator/respondent browser tests, beginner UAT | A |
| Workspace / identity | multi-organisation scopes, OIDC, permissions, anonymous mode, invitation options | RLS, access matrix and anonymity tests | A |
| Submission runtime | deterministic logic, server validation, retries/idempotency, data durability | load/concurrency fault tests | A |
| Dashboards and exports | user dashboard, reporting, admin console, JASP-friendly CSV bundle + codebook | datasets opened in JASP; no PII leak; UAT | A |
| Maintenance/self-healing | install wizard, doctor, backups, restore, health/alerts, bounded recovery | clean install/restore, fault-injection evidence | A |
| Data retention | inherited policies, expiry notifications, verified disposal, approved holds and export | clock-driven deletion test, backup tombstone test | A |
| Feedback-to-action | redacted event, triage, owner, status/escalation, verification, safe external connector | full case round trip; privacy and retries | B |
| Advanced engine | logic/piping, formulas, quotas, randomisation of questions, translations | deterministic engine parity tests; quota concurrency | C |
| Advanced admin | collaboration, reusable libraries, invitations/reminders, audit and governance | permissions and distribution integration tests | C |
| Research | research studies, informed consent versions, withdrawals, experiment groups, scales | ethics, scoring and randomisation independent tests | D |
| Research interoperability | SPSS `.sav` fidelity, JASP import, R-ready dataset, manifest/provenance | JASP/SPSS/R import checks and golden datasets | D |
| Longitudinal | participant pseudonyms, repeat waves, re-identification safeguards | linkage permissions, repeat-wave integrity | D |

**Feature ownership and detailed test cases:** developers must expand this matrix into issues/PRs with evidence links; avoid treating this matrix as completion proof.

## Extended full-scope feature matrix (all NOT IMPLEMENTED / NOT VERIFIED until tested)

| Module | Required end-to-end proof | Release control |
|---|---|---|
| Drag-and-drop multipage builder | pointer/keyboard reorder, autosave, versioning and page preview | explicit feature verification |
| Advanced questions | NPS/matrix/ranking/image/file input, security, exports | explicit feature verification |
| Branching/piping | shared deterministic rules, browser/backend parity, negative security checks | explicit feature verification |
| In-app SSO and embedding | OIDC validation, no URL bearer token, CSP/origin and cross-browser test | privacy/security gate |
| Multichannel distribution | email/SMS/QR/reminders and provider simulator retry/consent tests | live provider approval |
| Kiosk/offline | secure session clearing, encrypted offline queue, idempotent recovery sync | device/privacy gate |
| Sentiment analytics | privacy controls, opt-in provider, manual review, uncertainty, retention | model/data protection gate |
| Self-healing incident report | durable admin event, actionable notice, recovery verification and audit | operational gate |

Detailed requirements and test cases: `docs/INTERACTION_CHANNELS_INTELLIGENCE.md`.

## Creator onboarding, access and help — additional mandatory acceptance matrix

All rows start **NOT IMPLEMENTED / NOT VERIFIED** until code and real runtime evidence is attached.

| Feature | Expected behaviour | End-to-end evidence | Build WP |
|---|---|---|---|
| Purpose-first creation | Survey, quick poll, scored quiz, feedback, evaluation, research share one canonical schema | each type publishes, submits and persists in PostgreSQL | 048 |
| Wizard guidance | Step back/forward, autosave/resume, plain-language defaults and safe Expert switch | refresh/conflict/advanced round-trip tests | 048 |
| Accessible drag/drop | reorder questions and pages with keyboard and touch equivalents | desktop/mobile/browser accessibility | 040/048 |
| Readiness report | blocking errors vs warnings, privacy/retention/provider checks, no false validity certification | invalid publish blocked on API; valid version immutable | 048 |
| Feature Catalogue | category/search, preview, availability status and dependency messages | UI and API E2E | 049 |
| Feature requests/entitlements | workspace request, reviewer decision, expiration, revocation, audit and API enforcement | 403 denial, tenant isolation, approval idempotency | 049 |
| Curated templates | Project Listen, training, survey, poll, quiz, research starter; demos and licence metadata | preview/clone/version/export and cross-tenant tests | 050 |
| Contextual user guide | skippable onboarding, searchable topics, on-screen hints and plain-language errors | task tests with first-time staff, accessibility | 051 |
| Integrated journey | survey from template through response, chart, JASP export and retention | verified Docker/API/PostgreSQL/browser artefacts | 052 |
| Quiz and poll correctness | server-side score and vote controls, policy-bound visibility | score/vote abuse cases and SQL assertions | 048/052 |

## Live Quiz Arena — required full-scope delivery and acceptance

**Initial status: NOT IMPLEMENTED / NOT VERIFIED.** Every row requires a real containerized runtime and evidence; cannot be closed by static review alone.

| Feature | Expected behaviour | Required verification | WP |
|---|---|---|---|
| Reuse of quiz definitions | Live and self-paced modes use same immutable published definition and question bank | create once, launch both modes, compare codes/export | 053 |
| Join and lobby | Unique short-lived PIN, QR, optional verified SSO; controlled presenter admission | valid/invalid/expired/guessed PIN, unauthorised presenter, repeated joining tests | 053 |
| Presenter control | Start/pause/resume/advance/finish; authoritative session state | concurrent control, stale client and presenter disconnect tests | 053/055 |
| Timers and scoring | Server applies deadlines, correctness, configured speed score, consistent tie breaks | boundary-clock, altered browser time and multi-client race tests | 054 |
| Participant reconnection | Rejoin same session without duplicating answer or score | reconnect and forced worker restart with SQL assertions | 054/056 |
| Game Show | Optional leaderboard and live answer reveal; privacy-safe aliases | privacy visibility tests, screen sharing, 50-user simulation | 055 |
| Classroom mode | Lecturer-paced, explanations, optional zero scoring | keyboard and projector viewport tests | 055 |
| Live Poll | Real-time counts, no winner ranking, suppression of small groups where needed | duplicate-vote controls, aggregate privacy test | 055 |
| Formal Assessment | Identity/attempt policy, delayed results, no public leaderboard by default | role, identity, attempt and result embargo checks | 055 |
| Runtime/operations | Durable PostgreSQL events, realtime health and degraded-mode signalling | Docker + PG + transport; loss/restart/recovery, alert + audit | 056 |
| Accessibility | Screen reader, keyboard-only, mobile, reduced motion and sufficient contrast | tested on presenter and participant flows | 055/056 |
| Analytics/exports/retention | Session, version and question codes in JASP-ready export; retention and deletion apply | end-to-end export, privacy and disposal regression | 056 |
