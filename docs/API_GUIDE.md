# API guide and integration conventions

See [`../api/openapi.yaml`](../api/openapi.yaml) for the initial machine-readable contract. The contract is a **target design**, not evidence of deployed endpoints. Developers must extend it alongside implementation, generate documentation and validate examples/requests in CI.

## Base path and versioning

`/api/v1`. JSON request/response bodies; UTC ISO-8601 timestamps; UUID identifiers; pagination via `limit` and `cursor` for list endpoints. Schema validation errors use a stable error envelope with `code`, `message`, `requestId`, and optional field errors. Never expose stack traces, SQL, secrets or another tenant's resource existence.

## Authentication and tenancy

- Creator/admin routes require OIDC bearer JWT/session that resolves to an internal principal and authorised organisation/workspace context.
- Public respondent endpoints use only a published `publicToken`, scoped distribution token or participation capability; **never** a broad admin credential.
- Server selects tenant based on verified token/session and membership; request-supplied `organisationId` never grants access.
- Support scopes/permissions such as `survey:create`, `survey:edit`, `survey:publish`, `response:read_aggregate`, `response:export`, `admin:manage`, `ops:read`, `ops:act` with resource-specific checks.
- Rate limit and use opaque identifiers; return `404` rather than revealing another tenant's protected resources where appropriate.

## Principal endpoint groups

| Group | Stage | Behaviour |
|---|---|---|
| `GET /health/live`, `GET /health/ready` | 1 | Infrastructure checks; no secrets |
| `GET /me`, `GET /workspaces` | 1 | Caller identity and permitted workspaces |
| `POST /surveys`, `GET /surveys`, `GET /surveys/{id}` | 1 | Workspace-scoped survey CRUD/read |
| `PUT /surveys/{id}/draft`, `POST /surveys/{id}/publish` | 1 | Validate definition, create immutable published version |
| `GET /surveys/{id}/versions` | 1 | Version history |
| `POST /surveys/{id}/close` | 1 | Close collection and calculate retention clock |
| `GET /public/s/{token}` | 1 | Fetch the public-safe published definition, or a synthetic Registry prompt for a restricted test distribution |
| `POST /public/s/{token}/eligibility` | Development | Verify a synthetic credential and issue a short-lived distribution-scoped capability |
| `POST /public/s/{token}/responses` | 1 | Validated idempotent submission. A gated test distribution additionally requires `X-Survey-Capability`. |
| `GET /surveys/{id}/analytics` | 1 | Aggregates with privacy/small-cell policy |
| `POST /surveys/{id}/exports`, `GET /exports/{id}` | 1 | Controlled async dataset export |
| `GET /me/notices`, `POST /me/notices/{id}/acknowledge` | 1 | User notices |
| `GET /admin/notices`, `GET /admin/health` | 1 | Privileged operational status |
| `GET /admin/retention`, `GET /admin/disposals` | 1 | Policy/status without exposing response content |
| `POST /integrations/action-requests` | 1B | Authorised privacy-safe request to external workflow |
| `GET/POST /webhooks` | 2 | Manage registered outbound subscriptions |
| Advanced routing, multilingual definitions, research | 2/3 | Introduce only with versioned schemas and stage approval |

For synthetic Registry tests, `X-Survey-Capability` authorises access to the selected link through its expiry and can be reused or shared. The separate `Idempotency-Key` deduplicates one submission. If verification returns 503, the simulator has issued no new capability. Verification resumes when the simulator recovers, and previously issued capabilities keep their expiry. Production eligibility remains gated on privacy review and unlinkable one-use collection.

## JASP-oriented export contract

- `POST /api/v1/surveys/{surveyId}/exports` accepts `format: "jasp_csv_bundle"` in Stage 1, in addition to `csv_bundle`.
- Output is a time-limited, authorised ZIP containing `responses.csv`, `codebook.csv`, `manifest.json`, and `IMPORT_IN_JASP.md`; export-job API stays unchanged.
- `codebook.csv` must include at minimum `variable_name`, `question_id`, `question_text`, `measurement_level` (`nominal|ordinal|scale|text`), `value_code`, `value_label`, `missing_codes`, `survey_version_id`. Repeat rows for multiple category value labels if needed; document exact encoding.
- `manifest.json` records schema version, survey version, UTC creation timestamp, privacy/export mode, row count, column order, stable hash checksums and transformation notes, without logging identifiable values.
- Preserve Unicode in UTF-8; use fixed, reproducible column names; use unambiguous ISO dates; encode missing data consistently. Never silently treat a 1-to-5 Likert variable as continuous/scale.
- `.sav` is planned for Stage 3, after the Stage 1B and Stage 2 gates; it is **not** a Stage 1 API option. `.jasp` project generation is out of scope.
- Example request: `{"format":"jasp_csv_bundle","includeAttachments":false}`.

## Example: create a draft survey

```http
POST /api/v1/surveys
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "workspaceId": "11111111-1111-4111-8111-111111111111",
  "title": "After-class feedback",
  "privacyMode": "anonymous",
  "retentionPolicyId": "22222222-2222-4222-8222-222222222222"
}
```

The response is `201` with survey UUID and status `draft`; the server checks that the caller can create a survey in that workspace. Payloads shown are examples, not real IDs.

## Example: submit through a public survey

```http
POST /api/v1/public/s/<PUBLIC_TOKEN>/responses
Idempotency-Key: 6e9b659c-52e8-4b19-8a1b-0f7a531dec31
Content-Type: application/json

{
  "surveyVersionId": "33333333-3333-4333-8333-333333333333",
  "answers": [
    {"questionId": "q-satisfaction", "value": 4},
    {"questionId": "q-comment", "value": "More examples would help."}
  ]
}
```

A successful submission returns `201` with an opaque receipt (or `200` for an identical idempotent retry); never echo respondent identity in anonymous mode. API must reject changed payload with reused idempotency key (`409`). Avoid logging answer payloads.

## Errors

```json
{"code":"VALIDATION_FAILED","message":"Some answers need attention.","requestId":"req-example","fields":[{"path":"answers[0]","message":"Select an available option."}]}
```

Other stable codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `SURVEY_CLOSED`, `SURVEY_VERSION_MISMATCH`, `RATE_LIMITED`, `IDEMPOTENCY_CONFLICT`, `RETENTION_POLICY_VIOLATION`. Each error code must be tested and documented.

## Events and webhooks

Stage 1B can use a tightly scoped integration adapter and transactional outbox; public configurable webhooks are Stage 2. Events have `id`, `type`, `version`, `occurredAt`, `organisationId`, `data`. Sign payloads with an HMAC secret per subscriber, use delivery IDs, retries with jitter, replay windows and deduplication. Verify endpoints against SSRF, private/internal IP and redirects. Sensitive fields excluded by default. Do not send raw anonymous response text outside authorised contexts.

## API contract quality gates

- Valid OpenAPI 3.1 schema; unique operation IDs; JSON schemas for success and error responses.
- API implementation checked against contract; negative authorisation tests on every protected operation.
- Generated API reference published alongside code; examples updated in PRs.
- Breaking changes need new API version or documented compatible migration policy.
- Rate limits, permissions, retention, idempotency and privacy implications documented endpoint by endpoint.

## Full-scope API evolution requirement

The checked-in `api/openapi.yaml` is an **initial Stage 1 proposal only**. It does not yet specify all Advanced, Research or Feedback Action operations. Developers must extend it with typed endpoints and access policies for: survey schema/logic evaluation; invitations, quotas and languages; consent/study versions and assignments; longitudinal participant aliases; codebook/research export jobs including JASP-ready CSV and validated `.sav`; retention hold/disposal state; operator notices/health/recovery; authorised redacted feedback-action handoff/status. Every route must be versioned, bound to caller/tenant permissions, described with error semantics and verified by contract tests. No public anonymous-to-identity join endpoint.

## API evolution: proposed extended capabilities (not yet implemented)

Update `api/openapi.yaml` alongside implementation, not as an unsupported promise. Reserve versioned resource contracts for survey pages/questions reorder and publish validation, routing-rule simulation, file upload intents/download authorisation, invitation channel dispatch/reminders, respondent session and in-app launch, offline sync receipts/idempotency, aggregate/sentiment results, and admin recovery incidents/notices. Require JWT audience/scope validation or a standards-compliant session, tenant/privacy scope and rate limiting. Never accept raw unverified SSO bearer tokens from embed links. See `docs/INTERACTION_CHANNELS_INTELLIGENCE.md` for behaviour, threat cases and verification.

## Guided creation and feature access — design API contract

`api/openapi.yaml` now describes creation profile discovery, wizard draft CRUD/autosave/readiness, template list/preview/clone, feature catalogue/request/approval/entitlements and contextual help topics. These operations are **design-only** and their basic response placeholders must be replaced with typed schemas and generated clients when implemented. An agent must not mark an API implemented simply because it exists in YAML. Protect `workspaceId` by resolved server-side principal membership, use revision concurrency on autosave and idempotency for clone/request/decision actions. No survey answer data in catalogue/help analytics. The wizard publishes only through the existing authenticated publish contract after full server validation. End-to-end checks must test `403` for cross-tenant requests and disabled entitlements.

## Live Quiz Arena proposed API and realtime event contract

The machine-readable design contract includes `POST /live-sessions`, `GET /live-sessions/{sessionId}`, `POST /live-sessions/{sessionId}/commands`, `POST /live-sessions/join`, `POST /live-sessions/{sessionId}/answers` and `GET /live-sessions/{sessionId}/results`. Joining may be anonymous by policy but must return a narrowly scoped, short-lived participant capability; never trust client-supplied role or score. Commands require presenter authorisation and `expectedRevision` to reject stale updates. Answer writes require server timestamp/deadline validation and idempotency key; duplicate returns the previous receipt and conflicting payload returns `409`. Real-time event names: `live.session.updated.v1`, `live.question.opened.v1`, `live.question.closed.v1`, `live.results.available.v1`, `live.scoreboard.updated.v1`, `live.session.ended.v1`. Every event has session ID, monotonic sequence, timestamp, authorised audience and schema version; reconnect requests state snapshot + missed events. Broadcast only privacy-safe fields, never identity mappings or raw private answers. Provide OpenAPI for HTTP and companion AsyncAPI/event schemas during implementation.
