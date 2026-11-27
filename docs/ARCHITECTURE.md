# Architecture and data model

## Modular monolith

Expose interfaces from coherent in-process modules. Avoid microservices until scaling evidence warrants separation. Suggested modules:

1. Organisation and workspace management
2. Identity/authentication and authorisation
3. Survey authoring and immutable publishing
4. Respondent runtime and answer validation
5. Response ingestion and reporting
6. Distribution/invitation tokens
7. Data retention, export and disposal
8. Notification/action queue
9. Operations, security events and audit
10. Integration gateway/outbox

The web application presents **three role-specific surfaces**: user workspace, respondent UI, administrative control centre. Never use UI gating as the sole authorisation mechanism.

## Primary entities

| Entity | Key fields and constraints |
|---|---|
| Organisation | id, name, policy references, active; isolated tenant |
| Workspace | id, organisation_id, name, access policy |
| Membership | user_id, workspace_id, role, effective dates |
| User | id, identity_provider, subject; optional cross-tenant memberships with explicit context |
| Survey | id, organisation_id, workspace_id, owner_id, lifecycle_status, privacy_mode, retention_policy_id |
| SurveyVersion | id, survey_id, version_number, definition_json, schema_version, hash, published_at; immutable once published |
| SurveyDistribution | id, survey_id/version_id, type, open/close dates, target scope |
| Invitation | id, distribution_id, hashed_token, participant eligibility and delivery status; *not linked to answers for anonymous mode* |
| Response | id, survey_version_id, organisation_id, status, submitted_at, answer_json, idempotency_token_digest; privacy mode-specific storage |
| RespondentIdentity | separately protected mapping for identified/pseudonymous modes only; absent in anonymous mode |
| ExportJob | id, requester, scope, fields, status, short-lived object key, expiry, audit record |
| RetentionPolicy | id, tenant scope, trigger, duration, holds/extension rules, policy_version |
| DisposalJob / DisposalRecord | survey/version scope, eligibility check, execution status, non-content proof of disposal |
| Notice | id, organisation_id nullable for platform, audience, severity, category, state, owner, due_at, recommendation |
| AuditEvent | actor, action, tenant, purpose, timestamp, result, metadata without response contents |
| OutboxEvent | id, tenant, type, schema_version, privacy-safe payload, delivery attempts, delivery state |

Use UUIDs, explicit foreign keys, timestamps with time zones, stable question IDs and immutable answer option codes. Design indexes and migration scripts. Use database constraints for state/foreign-key integrity. Responses should be queryable without allowing cross-tenant reads.

## Privacy-sensitive separation

- Anonymous mode: no Person ID, account ID, IP address, exact device fingerprint, invitation-response mapping or correlatable access log tied to response content. If eligibility verification is needed, issue a one-use anonymous completion capability and record its consumption separately. Review the threat model for timing correlation and small groups.
- Identified mode: a separate, explicitly authorised identity relationship and appropriate consent/notice.
- Pseudonymous mode: mapping stored and protected independently from answers; control access and key lifecycle; cannot be advertised as anonymous.
- Logs/analytics/notifications must not include free-text answers, raw invitation tokens, identities or sensitive payloads by default.
- Use platform-created random response IDs and per-tenant scope; prevent side-channel enumeration where practical.

## Survey definition contract (Stage 1)

Store a canonical JSON definition with fields such as `schemaVersion`, `surveyId`, `version`, `title`, `description`, `pages`, `questions` (stable `id`, `code`, `type`, `title`, `required`, `options`, `validation`), `theme`, `privacyMode` and `settings`. Version changes require explicit migration and tests. Validate the definition server-side using a versioned schema. Avoid executable JavaScript in survey definitions.

Stage 1 question types: short text, long text, single choice, multiple choice, number, rating, dropdown, date, simple matrix. Exact edge cases and constraints must be specified with tests before each type is implemented. Logic engine architecture should be reserved; complex branching is Stage 2.

## Submission and concurrency

- A submitted response is associated with an immutable survey version.
- Require idempotency key per submission or equivalent client-generated token. Same key + same payload returns same receipt; same key + different payload is a conflict. Keys scoped by distribution and token/session; store digests, not raw secrets.
- Submission transaction validates publication status, dates, question schema, invitation eligibility/limits and response uniqueness as relevant. Commit response + outbox event atomically.
- Duplicate prevention for identified surveys relies on explicit respondent/distribution scopes and database uniqueness; anonymous public links cannot promise one response per person.
- Return plain-language client errors; never leak auth details or hidden fields.

## Boundaries and events

- Define internal domain contracts; shared types live in `packages/contracts`. All external APIs enforce permissions and tenant scope.
- Optional adapters: OIDC/Entra, SMTP/Graph mail, HELP SIS, Person Registry, Moodle, external action tracker, storage, metrics.
- Stage 1B event: `survey.response.flagged.v1` or manually authorised `survey.action.requested.v1` with **redacted** summary and no identity for anonymous responses. Respect consent and triage rules; do not automatically create tickets for all negative answers.
- Webhook delivery via transactional outbox with retries, signature, expiration and deduplication; no fire-and-forget calls in response transactions.

## Tenant model

Require organisation context derived from verified session/token and server-side authorisation, never merely a caller-supplied tenant header. Use tenant IDs in all tenant-owned rows. RLS policies protect per-tenant resources with correctly scoped DB roles and transaction-local context; test pooled-connection leakage. Dedicated installations must remain possible. Platform operators can see operational metadata but must not automatically access survey answers.

## Integrations for HELP

First deployment may use Entra OIDC; live SIS/Person Registry data are **optional**, not prerequisites for first vertical slice. Integration fixtures may model class/session/eligible student for Project Listen, without hard-coding HELP emails, IDs, names or institutions in core. Any production connection requires separate approval, scoped credentials and verification.

## Engineering decisions to document as ADRs

ADR-001 modular monolith; ADR-002 tenant isolation; ADR-003 anonymity guarantees; ADR-004 survey schema and versioning; ADR-005 queue/outbox; ADR-006 retention and disposal; ADR-007 external case-management boundary; ADR-008 operational automation approvals. Each ADR records alternatives, risks and migration implications.

## Live Quiz Arena module and persistence boundary

Introduce `packages/live-session-engine`, `packages/live-scoring`, `apps/web` presenter and participant views, and a replaceable realtime broadcaster. PostgreSQL is source of truth for `LiveSession`, `LiveParticipant`, `LiveQuestionState`, `LiveAnswer`, `LiveScoreEvent` and `LiveAuditEvent`; enforce organisation/workspace/session ownership and immutable `SurveyVersion` references. Session events are monotonic and carry revision/sequence numbers to ignore stale broadcasts; server owns clock, scoring and question progression. Durable writes and outbox notifications precede client acknowledgements. Use a single authorised state-transition coordinator with locks/optimistic concurrency; if scaled to multiple nodes, document atomic state coordination and fanout (e.g. Redis) without making Redis the source of truth. Avoid using volatile in-process timers as sole deadline authority. Distinguish lobby PIN from bearer identity; do not send authentication tokens over QR or URL. Session results feed existing analytics, privacy, retention and JASP-ready export modules.
