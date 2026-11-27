# Security, self-healing and operations

## Threat model baseline

Consider tenant breakout, broken object-level authorisation, account compromise, public API flooding, malicious survey definitions, scripting in respondent content, CSV formula injection, malicious attachments (if enabled), fake responses, token replay/enumeration, webhook SSRF, insecure third-party adapters, supply-chain compromise, ransomware, backup tampering, admin impersonation and export misuse. Maintain and review a threat register at every release.

## Required defensive controls in Stage 1

- Deny-by-default server-side role and resource checks; tests cover every protected endpoint and cross-workspace/cross-tenant reads and writes.
- Safe response encoding, content security policy, CSRF controls where cookie-based, strict schema/input validation, parameterised SQL and predictable error messages without details.
- Edge WAF/DDoS controls and TLS implemented by chosen production infrastructure; application rate limits by IP/network where permitted, token, tenant and endpoint with reasonable accommodation for shared campus networks.
- Hash signing/invitation tokens at rest; short-lived session tokens, rotation/revocation capability, MFA for privileged access where supported.
- Secrets in managed secret facilities, never in committed config or client code; scoped database credentials, non-root containers, minimal image, dependency scan, signed/provenance build as deployment matures.
- Structured audit of admin and export actions; security monitoring without sensitive survey response contents or IP retention that defeats anonymity.
- Backups encrypted and inaccessible to the main application write credential where feasible; restoration drills and defined recovery objectives approved by operator.
- Security checks: SAST, dependency scanning, container image scan, migration and permission tests, dynamic smoke tests, penetration assessment before public production exposure.

## Self-healing: bounded playbooks

| Failure | Automatic operation | Verification | Escalation |
|---|---|---|---|
| App process unhealthy | Orchestrator restarts with limit/backoff | readiness and representative request | repeated crash loop |
| Worker delivery failure | bounded retry with jitter, dead-letter state | processed once / idempotent | retry budget exhausted |
| DB transient disconnect | reconnect with backoff; do not acknowledge uncommitted responses | DB health and submission consistency | persistent failure |
| Webhook provider unavailable | circuit breaker and retry queue | provider success receipt | threshold exceeded |
| Suspected traffic abuse | rate limit or challenge under preapproved controls | traffic stabilises; false-positive review | widespread legitimate-user impact |
| Backup job failure | bounded retry | valid backup metadata and sample restore drill | repeated failure |
| Bad deployment | stop rollout; rollback code only if schema compatible | health + functional canaries | irreversible schema or data risk |

Never allow healing loops to overwrite databases, silently alter access policies, run arbitrary AI-generated shell commands, auto-merge patches or delete forensic evidence.

## Authorisation levels

- **Automatic (pre-approved)**: restart, retry, alert, throttle within caps, circuit-break connector, quarantine bounded jobs.
- **Controlled emergency containment**: temporarily block a clearly defined suspicious source, invalidate confirmed compromised integration credentials according to preapproved emergency policy. Always log and promptly notify.
- **Explicit human approval**: schema/data migrations, dependency upgrades, policy changes, restoring production data, deleting customer datasets outside authorised retention workflow, modifying code, rotating organisation-wide credentials, changing firewall-wide rules, granting permission.

## Administrative Control Centre

Main tiles: service health, database/storage/job state, scheduled and verified backups, vulnerabilities, pending migrations, integration health, tenancy policy status, active surveys, retention expiries, pending approvals and actionable notices. Administrative actions are RBAC-protected, require confirmation, expose dry-run where feasible, have audit records, and never run raw unrestricted shell commands in the browser.

Notice states: `open`, `acknowledged`, `assigned`, `in_progress`, `resolved`, `closed`. Each notice has severity (`critical`, `action_required`, `advisory`, `information`), source, evidence pointers, recommended action, responsible role, timestamps and escalation policy. Deduplicate repeated events and avoid routine alert spam. Delivery channels: in-app and email in Stage 1; webhooks/Teams optional adapters later.

The ENG-009a development slice exposes /admin, /api/v1/admin/health and
/api/v1/admin/incidents. Explicit platform operations viewers and operators can
read the platform-wide readiness and history. Operators can append an event
containing a fixed component, state and severity. PostgreSQL adds server time,
event ID and authenticated audit attribution. API responses omit the audit
actor and the database schema accepts only fixed event codes. Platform
operations membership is empty at installation and gives no workspace or
survey permissions. Automated detection, incident lifecycle correlation,
notices and role provisioning are later scopes.

The application database role can append the three event fields and select the
redacted projection under row-level security. Mutation of history or audit
attribution requires database-owner privileges. The migration is additive.
Retain both tables when reverting the application. The previous runtime
compares exact migration history for readiness, so a rollback needs a
compatible build or a coordinated, explicitly approved database restore.

## Safe operational workflows

- Health checks `/health/live` and `/health/ready` disclose no secrets or tenant data.
- Metrics are aggregated/scrubbed; no raw response texts as metric labels.
- Migrations have preflight, backward-compatibility plan and staged deployment; **database rollback may require restore and approval** and is not inherently automatic.
- Every release must include rollback conditions, security release notes and a fresh backup/restore check.
- Retention deletions use independent, idempotent workers and durable disposal log; restore workflows re-apply deletion markers before serving restored data.

## Success evidence

Stage 1 acceptance must include: container kill/restart; DB outage and idempotent submissions; public endpoint abuse simulation; cross-tenant attempts; expired permission/token checks; backup restore; notification routing; queue exhaustion and non-disruptive recovery; tests to ensure logs/webhooks do not leak anonymous identities or answers. Record exact commands, versions, timestamps, outcomes and defects.

## AI usage

AI is optional for explaining logs, proposing remediation and drafting pull requests. It may not be the sole detection control, and it has no direct high-privilege production access. Treat logs, survey text and external webhook payloads as untrusted prompt-injection surfaces. Redact sensitive content before analysis. Human approval plus CI and independent review are required before production code changes.
