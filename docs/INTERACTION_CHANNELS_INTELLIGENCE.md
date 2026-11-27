# Interaction, distribution and intelligence requirements

**Status:** Mandatory full-scope development contract; features are not implemented until demonstrated against a running Docker/PostgreSQL installation. **Revision:** 2026-11-25.

This document supplements `HANDOFF.md`, `INTENT.md`, `docs/FEATURE_MATRIX.md`, `docs/SECURITY_OPERATIONS.md`, `docs/API_GUIDE.md`, and `api/openapi.yaml`. Feature delivery can run concurrently in isolated branches. Activation in production remains governed by release and privacy gates. All UI must meet the platform's accessibility target and be verified with real users.

## 1. Drag-and-drop, multi-page survey builder

- Reorder questions **within** and **between** pages through keyboard-accessible drag-and-drop; also provide Move up/down, Cut/Paste, and page selectors for touch and assistive technology.
- Add/delete/duplicate pages, named sections, progress indicator, optional page descriptions, page conditions, preview mode and undo/redo. Persistent autosave with conflict detection, version history and visible save status. Never lose concurrent edits silently.
- Use a typed, versioned survey-definition schema: `survey_version -> pages -> blocks/questions -> options`, stable IDs and variable codes. Preserve identities when reordering; published versions immutable.
- Disallow invalid references, cycles and unreachable mandatory paths. Test full page-navigation logic with back/forward, resume, refresh and mobile screen readers.
- Question palette includes short/long text, single/multiple choice, numbers, date, rating/Likert, **NPS (0–10)**, matrix/grid, ranking, image-based choice and file upload. Specify max dimensions, allowed content, validators and accessible alternatives per type.
- NPS: store original 0–10 answer; compute the standard score from promoter 9–10, passive 7–8 and detractor 0–6 proportions, with denominators and empty-group handling. Never infer a precise score without enough data.
- Ranking: enforce uniqueness and selection bounds; define exported rank position codes. Matrix: type and validate every sub-item with stable column/row codes. Image questions: require accessible labels/alt text, remote-image allowlist/proxy policy and file size constraints.
- File uploads: malware scan before authorised access, private object storage, MIME/content-signature validation, bounded sizes, deny execution, signed temporary downloads, retention cleanup and upload quota. Infected/unscanned objects must be quarantined and cannot be downloaded.

## 2. Branching, visibility and piping

- Create a **declarative, side-effect-free** rules DSL with typed operators: `equals`, `in`, numeric comparisons, `answered`, `and/or/not`. No evaluation of arbitrary author-written JavaScript, SQL, or templates.
- Conditions operate at question, page and section level; support conditional show/hide, skip/route, answer/text piping and computed fields with strict context-aware escaping.
- Same deterministic rules implementation on browser and server or byte-for-byte shared package; the server independently validates submitted visible/required answers and disallows tampering with hidden answer fields.
- Define explicit policy on hiding previously answered questions: clear hidden values or preserve for revisiting; do not accidentally export values respondents cannot see. Add rule debugger, dependency graph, unreachable-route analysis and simulation test cases.
- Support versioned/translated labels without changing answer codes. Test nested branches, multi-page resume, back navigation and language changes.

## 3. In-app linking and SSO

- Provide secure in-app launch for HELP Student App and generic external host apps using OIDC/OAuth 2.0 integration and embeddable SDK or deep link. The platform **must not trust, log or persist arbitrary raw SSO tokens passed by URL parameters**.
- Verify token issuer, audience, expiry, signature, nonce/state (as applicable) and required scopes at a trusted backend or standards-compliant OIDC client; use authorization-code + PKCE for public clients and server-side token validation / token exchange where appropriate. Never pass bearer tokens in iframe query strings, fragment-based forwarding or analytics events.
- Establish an app-scoped server session, secure `HttpOnly`, `Secure`, suitable `SameSite` cookies or standards-compliant controlled cross-origin handoff. Define an iframe design that works with third-party-cookie restrictions; prefer same-site launch or secure one-time handoff rather than assuming iframe SSO always works.
- Allow anonymous, identified and pseudonymous respondent modes. An eligibility token should not create an invitation-to-answer mapping in an anonymous survey; verify privacy requirements by independent threat review. Optional Person Registry resolution is restricted by explicit consent/purpose and least privilege.
- Protect embedding with CSP `frame-ancestors` allowlist, origin validation and strict `postMessage` origin and schema validation. Have fallback to top-level browser navigation if iframe login is blocked.

## 4. Distribution and collection channels

- **Email**: invitation templates, per-tenant sender verification, expiring one-time tokens, opt-outs, throttling, queue retries, delivery/bounce reporting, and reminders that cannot reveal completed answers.
- **SMS**: optional replaceable provider adapter, explicit opt-in and usage budgets, sender compliance, rate/abuse controls, delivery callbacks and opt-out support. No real messages or charges during isolated build tests.
- **QR**: expiring / revocable campaign links where needed; anonymous/public vs personalised codes clearly separated; no sensitive information in QR payloads.
- **Embed**: copy-paste snippet / SDK with scoped published survey IDs, origin restrictions, CSP, accessibility, auto-resize and privacy-safe completion events. Host applications can launch and monitor completion without reading answers unless separately authorised.
- **Automated reminders**: timezone-aware schedules, idempotent dispatch, consent/opt-out, rate limits, suppression after completion for identified invitations, and privacy-preserving suppression in anonymous participation mode.
- **Kiosk**: one participant per isolated session; automatic clearing after submission, inactivity timeout, no personal data cache, protected supervisor exit, optional kiosk browser integration, device status and anonymised diagnostics.
- **Offline**: explicit downloadable, version-pinned survey package plus local encrypted queue where device/browser capability permits, offline eligibility rules, delayed sync with idempotency key and conflict policy. Warn when anonymity, file upload, SSO, randomisation or quota requirements cannot be safely guaranteed offline. Do not call ordinary browser caching a validated offline mode. Consider a managed PWA or dedicated kiosk client. Keys and residual device data must be removed after verified sync according to policy.

## 5. Analytics and sentiment

- Authoritative server aggregates: response counts, item distributions, NPS, completion/dropout, trend, crosstab and comparison with suppression of small cells and inference-risk combinations. Every metric declares denominator, filter, version and date range.
- Sentiment analysis is an **optional, configurable analytical assistance**, not a factual verdict on the respondent's intent. Provide local/model-neutral connector abstraction, language detection, confidence/uncertainty, examples for manual review, human-corrected classifications, and aggregate category analytics.
- No automatic transfer of identifiable or sensitive free text to external AI vendors. Separate opt-in, permission, data-processing, retention and model-cost controls. Redact data before any external analysis; keep prompts/results under retention policy and audit use. No automatic escalation solely from sentiment score; use explicit policy/human triage for Project Listen.
- JASP compatibility stays data-centric: stable answer codes, tidy export, codebook, missingness, nominal/ordinal/scale metadata and reproducible CSV/.sav bundles; JASP is **not** an architectural dependency.

## 6. Self-healing report and operator audit trail

Every automated detection, recovery, retry, circuit-breaker transition and policy-based containment **must** produce a durable operational event, visible in the Administrative Control Centre, with:

- Event ID, correlation ID, start/end times, severity, system/tenant scope where permitted, health signals and triggering threshold.
- What failed and user impact; safe sanitised evidence, affected component and relevant deployment version, without tokens, personal data, raw answers or sensitive infrastructure details.
- Rule/playbook used, policy version, action attempts, approvals where required, results and post-recovery verification (e.g. an actual database write/read probe, not only process running).
- Current disposition: `detected`, `recovering`, `verified_recovered`, `needs_attention`, `escalated`, `closed`; assign owner and next action for unresolved cases.
- Append-only audit history, correlated logs/metrics, RBAC, severity-based notices, deduplication, escalation and defined retention. Provide filtered export for incident review. Recovery is not 'successful' until checks pass.

Use reliable event/outbox persistence so notices survive worker restarts. Hard failures in the observability pipeline must trigger secondary alerts without blocking validated survey response commits. Do not let the agent silently edit production infrastructure or auto-deploy unreviewed patches.

## 7. Integration contracts from day one

- Generic connector ports: `IdentityResolver`, `EligibilityProvider`, `InvitationDelivery`, `CaseManagement`, `SentimentProvider`, `StorageProvider` and `EventPublisher`.
- HELP Person Registry adapter and future Ticketing adapter must have local contract simulators and real database-backed integration tests. External systems are never prerequisites for a clean installation. Exchange only authorised minimal data through APIs/signed events; never share databases or raw respondent tokens.
- Ticket/feedback flow: explicit triage decision -> privacy-filtered event -> idempotent case handoff -> acknowledge -> status sync -> closure evidence; retries/DLQ and reconciliation. Anonymous feedback must not become an identified service ticket by implication.

## 8. Definition of Done — additional mandatory test scenarios

1. Reorder two questions between pages by pointer and keyboard, save, reload and publish; stable variable codes, versions and answers remain correct.
2. NPS, matrix, ranking, image selection and uploaded-file inputs render, validate and export correctly; malicious attachment quarantined; failed upload recoverable.
3. Branching and piping show identical results in preview, published respondent browser and backend; bypassing hidden-question validation fails securely.
4. An embedded Student App simulator completes OIDC launch securely. Reject expired/wrong-audience/replayed tokens, untrusted embed origin and malicious postMessage.
5. Email/SMS adapters use simulators with failed and duplicate deliveries, opt-out, rate limits and reminder suppression; never contact real recipients during CI.
6. QR public link, personalised invite, kiosk session reset and an interrupted offline sync are exercised in browser/device tests with durable PostgreSQL assertions and privacy checks.
7. Sentiment results are labelled as estimates; real response text is not transmitted to vendors by default; manual correction and reporting provenance verified.
8. Inject worker and database interruptions. Verify recovery event, bounded action attempts, admin notice, outcome verification, deduplicated logs, escalation and retained incident record.
9. Confirm retention disposal includes offline caches/attachments/exports and derived sentiment artifacts; approved holds respected.
10. Re-run cross-tenant, anonymous-response and integration security suites after each major module change.

**Evidence requirement:** Each test records Git SHA, Docker image digest, PostgreSQL version, browser/device, commands, pass/fail, logs and outstanding limits in `docs/EVIDENCE_LEDGER.md`. A compile-only success is insufficient.
