# Live Quiz Arena — product, engineering and acceptance specification

**Status:** Required product capability in the unified autonomous build; **not implemented or verified** by this document. **Activation:** independent release gate after security and runtime evidence. **Design goal:** a Kahoot-style *interaction pattern* with an original interface and no copying of proprietary code, branding, audio or graphic assets.

## User journeys

**Lecturer/host:** Smart Wizard → Pop Quiz → author/clone questions → choose Live delivery → Game Show / Classroom Learning / Live Poll / Formal Assessment → set timing, audience, access, score, leaderboard and results release → readiness check → publish immutable quiz → start live session → share PIN/QR or sanctioned in-app link → admit/join participants → start/pause/advance/reveal/end → review results and export. A host may abandon and restart a *session* without altering the published quiz definition.

**Participant:** enter short-lived PIN or scan QR → optional OIDC/Person Registry eligibility handshake if the host requires it → receive audience-scoped participant capability → show lobby and connection status → receive question/choices → answer once before server deadline → get durable receipt → optionally view explanations and ranking → reconnect and resynchronise when disconnected. A QR or PIN is not a substitute for identity verification for assessed sessions.

## Presentation modes

| Mode | Controls | Default confidentiality |
|---|---|---|
| Game Show | timed questions, accuracy or accuracy+speed scoring, configurable leaderboard | nickname aliases; public rankings opt-in |
| Classroom Learning | presenter-paced progression, hints/explanations, optional scoring | individual scores private unless explicitly disclosed |
| Live Poll | live distribution of votes, no competitive leaderboard | aggregate-only with group thresholds and suppression |
| Formal Assessment | authenticated participant, attempt and eligibility rules, delayed results, export | names and scores restricted to authorised educators |

Modes share canonical questions and scoring policies; no duplicate data model or separate authentication implementation. Non-competitive default should remain easy to select in education settings.

## Question and scoring model

Reuse supported canonical question types: single/multi-select, true/false, image choices, order/ranking and no-score polls. Support per-question server deadlines, explicit points, answer reveal/feedback timing, configurable speed bonus and deterministic tie-breaking. Never score solely in JavaScript running on a participant device. Define exactly how late submissions, reconnecting devices, paused clocks, skipped questions and simultaneous ties are handled. Disclose timing tolerances and accommodations. Server clock must be authoritative; all accepted answers are committed to PostgreSQL with idempotent uniqueness constraints before receipt. Store quiz version, session, participant alias scope, question code, answer payload, authoritative accepted timestamp and calculated score/rule version.

## Session and realtime design

- Lifecycle: `draft`, `lobby`, `running`, `paused`, `ended`, `archived`; transitions authorised by presenter and concurrency-checked against revision.
- Use websocket (or equivalent) for low-latency state broadcasts and optional polling fallback. PostgreSQL durable authoritative session/answer/score state; realtime broker transports notifications but must not be the only persistence store.
- Expiring PINs with anti-enumeration controls; QR links to limited join page only. Presenter/admin roles never conveyed through URL query arguments.
- Rejoin using narrowly scoped participant credentials. An authenticated participant has one active logical participant record per session; anonymous mode must explicitly describe its limits on duplicate control.
- Broadcast event sequence numbers; replay/snapshot after reconnect; stale messages must not roll back session state.
- Graceful degraded mode: if realtime is unavailable, show reconnect state, do not fabricate scores and either pause the session or use tested fallback by mode.

## Security and privacy

Protect access by tenant, workspace, quiz version and session membership. Signed-in assessable sessions must verify OIDC and optional Person Registry attributes server-side. Rate-limit joins and answers; CSRF/origin protections for sessions and sockets; bound payload sizes; use secure transport and no raw PII in leaderboards unless disclosure is permitted. Guest nicknames must be sanitised. Never link anonymous session answers to registry identifiers through logs or exports. Respect survey version, retention, consent, audit and export policies; no longer retention merely because scores are entertaining.

## Reporting and data exports

Report participation, completion, correct-answer proportion, response latency and per-question difficulty with privacy controls and minimum group thresholds. Link results to existing analytics and JASP-ready export: stable variable names, coded answers, explicit missing values, session/quiz-version metadata and a separate codebook. In a formal assessment, individual performance must be visible only to an authorised educator and the respondent according to the release policy. Scores must be reproducible from recorded scoring version and accepted answers.

## Operator controls and self-healing reports

Track active room count, join/answer rate, transport disconnects, late answer rejection, outbox backlog and failed broadcasts. Auto-restart unhealthy processes and recover subscription state within bounded policy; log detection, actions, outcome and post-recovery verification in the Administrative Control Centre. Critical incidents/abuse must create actionable notices. Automatic restart cannot alter accepted results.

## Required local integration and load proof

Using **GitHub commit SHA + Docker Engine + real PostgreSQL**, exercise a published multi-question quiz with 50 synthetic simultaneous participants (initial minimum), live host and attendee UIs, secure join, answer deadlines, optional ranking, presenter pause/advance, complete session, authorised analytics, JASP-friendly export and disposal policy. Test at least:

1. Two participants submitting at boundary; one response/score per player/question with SQL uniqueness and idempotency assertions.
2. Changed client clock or tampered score rejected; only authoritative server scoring persists.
3. Presenter disconnected during active question; reconnected host restores correct session state.
4. Realtime process stopped/restarted; participants recover from durable snapshot and no duplicates.
5. Invalid/expired/guessed PIN, forged presenter command, cross-tenant session ID and unauthorised result access rejected.
6. Game Show with rankings on/off, Classroom Learning, Live Poll and Formal Assessment each tested in browser.
7. Mobile, projector, keyboard, screen-reader, reduced-motion and network-loss handling tested.
8. Verified incident and recovery records visible in admin; exports and retention/identity boundaries validated.

Do not state concurrency scalability beyond tested limits; record latency, error counts, hardware/runner specs, trace samples, exact commands and known limitations. Independent reviewer must challenge a plausible failure even when all automated checks pass.

## Work package sequence and release rule

WP-053 contract and session persistence → WP-054 server scoring/concurrency → WP-055 UI/modes → WP-056 operations, integrations and independent verification. Work in separate Git worktrees once shared types are reviewed. Product owner and security/operations approver authorise production activation. Do not automatically run public classroom sessions as a development test.
