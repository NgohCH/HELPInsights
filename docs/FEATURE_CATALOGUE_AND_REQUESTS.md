# Feature Catalogue, Entitlements and Request Centre

**Purpose:** self-service discovery of functionality while controlling expensive, sensitive and specialist features. This is not an app marketplace, billing engine or substitute for role-based authorisation.

## Categories and example feature identifiers

- **Essentials:** standard questions, multipage, drag-and-drop, links/QR, basic reports.
- **Advanced authoring:** conditional logic, matrix/rank/NPS, multilingual, calculations, question banks.
- **Delivery:** email invites, SMS, reminders, secure embed and SSO, kiosk and offline.
- **Intelligence:** sentiment analysis, trends, cross-tabs, privacy-safe summaries.
- **Research:** study records, consent, randomisation, scales, longitudinal and labelled exports.
- **Integration:** Person Registry, Ticketing, generic webhooks and institutional adapters.

Feature descriptor fields: `feature_key`, semver, category, name, description, audience, availability (`included|requestable|unconfigured|planned|policy_restricted`), dependencies, required role, organisation policy, risk level, data classes processed, provider configuration, cost indicator, preview/demo link and help reference.

## Lifecycle

`discover -> preview -> request -> policy review -> approve/deny -> enable -> periodic review -> suspend/retire`.

- No form for a feature already granted. Show reason for unavailable feature and whether admin setup is needed.
- Request requires intended workspace, purpose, relevant privacy/data classification and optional justification; no unnecessary personal information.
- Approval actions require delegated role, explicit decision rationale, expiry for temporary access, audit history and notification.
- Auto-grant only for organisation-approved low-risk features. External AI processing, SMS charges, offline personal data and sensitive respondent features require appropriate approvals.
- Feature flags control rollout; **server evaluates entitlement for each protected API action**, not just UI visibility. Roles and policy always apply even when a flag is on.
- Administrators can view requests and provider readiness, grant/revoke feature access, inspect notices and audit records without reading underlying survey responses.
- Revoke access should not corrupt already-published surveys: pause incompatible functions, preserve versioned metadata, explain remediation, maintain export subject to policy.

## API, models and tests

Models: `FeatureDefinition`, `FeatureEntitlement`, `FeatureRequest`, `FeatureDecision`, `ApprovalPolicy`, `FeatureUsageEvent` (aggregate/minimised).

Test request -> reviewer approval -> entitlement read -> successful API call; rejected/expired entitlement must yield `403`; cross-tenant request/approval isolation; concurrent approvals are idempotent; provider unconfigured cannot be enabled; all transitions audited. Use simulated providers in Docker.
