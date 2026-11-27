# Security and low-exposure threat model

**Security objective:** minimise discoverability of privileged surfaces and reduce attack impact, not claim invisibility or invulnerability. Applies to public anonymous surveys, user workspace, admin console, APIs, background jobs and sensitive research data.

## Primary threats and preventive controls

| Threat | Prevent / detect / recover |
|---|---|
| Internet DDoS/bot submission | edge DDoS/WAF/CDN and rate rules; application quotas, velocity checks, challenge policies; volume/error telemetry; avoid blocking accessibility by default |
| Credential stuffing and admin takeover | standards-based OIDC, phishing-resistant MFA where available, session controls, anti-enumeration, login rate limits, audit/alert, emergency revoke |
| Tenant/workspace response leak | authenticated tenant context, explicit authorisation, DB RLS defence-in-depth, cross-tenant and IDOR negative tests, separate responder identity store |
| SQL injection/XSS/CSRF/SSRF | parameterised queries, safe rich text, sanitisation/CSP, anti-CSRF, validated URLs/outbound allowlists, exploit-regression tests |
| Malicious file upload | strict type/size validation, malware scanning/isolation, random object keys, private buckets, expiring access tokens |
| Survey logic abuse | declarative allowlisted expression AST; no eval; resource limits; server-side validation and input bounds |
| Export and privacy leakage | permissions, scope-limited export, re-identification checks, formula injection escaping, short TTL, download audit, privacy-preserving logs |
| Supply chain & image compromise | locked dependencies, signed images, SBOM, SCA/SAST/secrets scans, reproducible builds, vulnerability advisories with triage and approval |
| Compromised dependency/integration | scoped tokens, secret rotation, egress restrictions, isolated connectors, circuit breakers, incident revocation |
| Ransomware/data deletion | off-host immutable or versioned encrypted backups, restore drills, privilege separation, incident freeze and audit evidence |

## Self-healing policy

**Automatic low-risk:** bounded service restarts, exponential retry with idempotency, circuit breakers, dead-letter queue, non-destructive health validation, queue backpressure, temporary preapproved rate restrictions and alert routing.

**Human-authorised:** code changes and deployment, database schema/data restoration, production credential/role rotation unless emergency containment has been preauthorised, firewall changes outside preapproved rules, disabling large user groups, disabling security controls, destructive actions.

Automations have max retry count, cooldown, deduplication, verified recovery and escalation if still degraded. Do not use AI to write/run production shell commands. AI diagnosis is advisory, sandboxed, scrubbed of secrets/response content and optional.

## Evidence required before release

- Threat model owner/reviewer assigned; test unauthenticated internal endpoint exposure and security headers.
- Verify IDOR/cross-tenant denial and anonymous mode privacy including logs, exports, backups and integrations.
- Run meaningful fault injection (DB outage, queue down, container crash, malformed submissions), track response integrity and recovery time.
- Verify WAF/rate-limit with permissioned isolated load, not against live external targets.
- Security findings triaged by impact; critical/high unresolved release blockers unless formally approved with compensating controls.
- Provide incident procedure for suspected breach: detect -> contain -> preserve evidence -> assess -> restore -> notify stakeholders/regulators where required.

## Live-session threat scenarios

Protect against PIN guessing/enumeration, replayed or duplicated answer messages, browser-time manipulation, presenter token theft, scoreboard identity leakage, forged host commands, denial-of-service through mass joins, shared-device kiosk remnants, cross-tenant session access, stale websocket events and operational restart loops. Controls: high-entropy expiring PINs plus attempt thresholds, session-scoped participant credentials, server-side timestamps/scoring, database uniqueness/idempotency, origin/auth checks for upgraded sockets, per-principal/network rate limits, signed or authenticated event delivery, CSP and safe display aliases, tenant-scoped SQL and log redaction. Security review must include concurrent state transitions and result-release permissions; a successful 50-user load test alone is not sufficient.
