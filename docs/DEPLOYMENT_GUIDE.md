# Deployment and upgrade guide (implementation contract)> **Mandatory pre-deployment verification:** Follow [GitHub and Docker runtime verification](GITHUB_DOCKER_RUNTIME_VERIFICATION.md). Validate the exact GitHub commit with freshly built images, Docker Engine/Compose, a disposable PostgreSQL database, migration, API/browser end-to-end tests, backup restore and vulnerability checks. Source-code review alone does not qualify a release. Do not use a production database for this proof.



**Status:** Required product deliverable; commands below describe the intended command interface. They are not operational until implemented and tested.

## Supported initial deployment

- Linux x86_64/arm64 host capable of running a supported Docker Engine and Compose plugin; backed by persistent volumes; non-root application containers.
- TLS-terminating reverse proxy/load balancer with valid certificates, HTTPS-only client access, and an upstream DDoS/WAF control where internet-facing.
- Dedicated PostgreSQL database or managed PostgreSQL instance; encrypted backups; least-privilege DB role; object storage for permitted uploads/exports.
- Outbound connectivity for optional SMTP, OIDC discovery and vulnerability advisory feeds. No mandatory internet access for core survey operation once dependencies are provisioned.
- Resources are **provisional** until load testing. Start pilot capacity planning at >=2 vCPU, >=4 GB RAM and >=30 GB persistent space plus database backups; test against actual concurrency/attachments. Do not present these as certified minimums.

## Installation wizard: target user journey

1. Download a signed release archive and verify its digest/signature. Read versioned release notes and compatibility matrix.
2. Unpack on an approved host, configure a DNS name/TLS proxy and Docker environment; never paste real credentials into chat or commits.
3. Run `./scripts/doctor` to check OS/runtime, container capability, ports, disk, TLS, DNS, DB connectivity, storage, backups and clock synchronisation. Report green/warning/fail with remediation.
4. Run `./scripts/install` (terminal wizard initially; graphical wizard optional). Collect hostname, deployment mode, database details via protected secret input, storage and notification settings; generate `.env` with restrictive permissions; no default admin passwords.
5. Preflight database permissions and migration compatibility. Show migration plan; require approval before touching an existing database. Create isolated roles/schema according to least privilege.
6. Launch services with a controlled Compose profile and readiness checks. Disable public access to internal admin/debug/metrics routes.
7. Create first administrator via a one-time, time-limited setup token on a protected endpoint or localhost command. Require bootstrap MFA/SSO configuration where policy mandates it, and revoke setup capability immediately.
8. Run end-to-end acceptance checks with synthetic data: create/publish/submit/export/delete sample survey; verify dashboard, alerts and health; validate restore procedure.
9. Deliver installation receipt: release digest, schema version, health/backup results, URLs, optional integration status, warnings and next maintenance tasks. **No secrets in receipt.**

## Required operational commands (to be implemented)

```
./scripts/doctor
./scripts/install
./scripts/start
./scripts/status
./scripts/backup
./scripts/verify-restore --isolated
./scripts/upgrade --preflight
./scripts/rollback --plan
./scripts/incident-diagnostics --redacted
```

All operations must be idempotent where possible, emit structured logs and safe exit codes, and avoid destructive changes without explicit approval. Provide Windows-administrator access through a browser; host-side scripts may execute through an approved Linux runner.

## Upgrade safety

- Verify signed images, SBOM, vulnerability results and release compatibility; test schema migration against a restored anonymised copy.
- Capture recoverable backup, snapshot relevant config, stage canary/blue-green update where infrastructure permits.
- Run smoke tests and inspect latency/errors/queue lag. Automatically halt rollout on failed gate; application rollback may NOT reverse committed database migrations or external side effects. Use reviewed forward-fix/restoration plan.
- Preserve audit events and operator approval. Public release notes must identify schema compatibility and retention behaviour.

## Disaster recovery

Set and approve actual RPO/RTO after a measured restore drill. Backups need separate encryption keys, access controls, retention, off-host storage and test restores. Recovery must reapply disposal tombstones for records whose live retention expired before a backup was created. Periodically exercise incident runbooks.

## Public exposure policy

Expose only necessary HTTPS survey endpoints and appropriately protected administrative routes. Do not expose PostgreSQL, Redis/queue, internal metrics, exception traces, server banners with precise versions, secrets or maintenance interfaces. Security is verified by testing rather than relying on obscurity.
