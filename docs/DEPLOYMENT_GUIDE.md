# HELPInsights deployment and upgrade guide

Use this guide to assign ownership, gather prerequisites and rehearse a release before booking production activation. The local doctor, disposable install demo and readiness checklist are available today. Production provisioning, first-administrator setup and production upgrade and recovery commands still require verified implementations.

Follow [GitHub and Docker runtime verification](GITHUB_DOCKER_RUNTIME_VERIFICATION.md) for exact-revision checks with fresh images, disposable PostgreSQL, migrations, API and browser tests, backup restore and vulnerability checks.

## Prepare before the deployment window

Open a release record for each environment. For every row, enter the owner, due date, target value or approved reference, and completion evidence. Record who can approve, operate and recover the release. Store references to secrets in the release record and keep the values in the University's approved secret store.

| Area | Prepare | Evidence to attach |
|---|---|---|
| Release | Source commit, signed artifact or image digest, compatibility notes, previous known-good artifact | Signature verification, required GitHub checks and vulnerability review |
| Host and network | Approved Linux host, Docker Engine and Compose, sizing, persistent volumes, DNS, HTTPS, reverse proxy, firewall and required outbound connectivity | Host and capacity checks, DNS, TLS and network tests |
| Data | Dedicated PostgreSQL, migration and runtime roles, encrypted backups, restore permissions and retention settings | Connectivity and role checks, migration rehearsal and measured isolated restore |
| Storage and operations | Required object storage, monitoring, alerts, service owner and on-call contacts | Storage access verification and alert delivery test |
| Identity | Approved Entra tenant and app registrations, exact HTTPS callback, MFA policy, test accounts, first-admin method and protected configuration references | Allowed and denied creator and operator sign-ins, research-tool denial for public creators, user and group grant and revocation checks, MFA and first-admin evidence |
| Survey audiences | Departments, intended distributions and eligible and ineligible test scenarios | Approved eligibility policy version and acceptance results for each University-only distribution |
| Integrations | Enabled and deferred clients, their purpose, identity, operations, resources and owners | Administrator-only settings access, allowed and denied calls, credential expiry and revocation for each enabled client |
| Release operations | Change window, approver, smoke checks, stop conditions, recovery decision owner and incident contacts | Documented rehearsal, acceptance decision and tested recovery path |

### Department eligibility and integration records

- For each University-only distribution, record the department, policy owner, approved rule identifier and version, institutional authority and minimum eligibility inputs. Record who approves changes and which distributions are affected. One department may approve a teaching cohort while another uses programme membership. Verify an eligible account, an ineligible account and denial when eligibility cannot be confirmed. Keep identity and eligibility evidence separate from anonymous answers. University research clearance and consent follow the existing external process.
- For each enabled integration, record its department, environment, client identity, delegated or approved unattended access, permitted operations, data and workspace scope, and the owner for credential renewal and revocation. Departments can use the same product with different access. Validate each client's own grant. [API guide](API_GUIDE.md#university-sign-in-and-integration-acceptance)

## Standard deployment sequence

1. **Freeze the release.** Verify the approved target, artifact digest, signature, compatibility and CI evidence. Record the prior release and the applicable migration and recovery procedures.
2. **Rehearse in isolation.** Run the local checks below using the candidate and synthetic data. Rehearse the target configuration, first-admin procedure and migration. Restore a backup into isolation, measure recovery and close required failures.
3. **Review readiness.** Run the checklist against the prepared evidence. Review each department policy and enabled client separately. Attach the checklist receipt to the target and digest. The release owner approves the window and the actions allowed. Any pending or failed required check stops activation.
4. **Prepare the target during the approved window.** Reconfirm target and release identity, apply the reviewed configuration, create a recoverable backup and record its restore point. Apply the approved migrations and start pinned services. Verify internal readiness before opening traffic.
5. **Run acceptance.** Use approved test accounts and synthetic answers. Verify first-admin access, allowed and denied creator and operator access, anonymous public submission, each enabled University-only policy, each enabled client, results and export. Check alerting, redaction and service health.
6. **Activate and hand over.** Record the release owner's decision, enable approved traffic or features and monitor agreed thresholds. Hand the service owner the redacted release record with the deployed digest, schema version, smoke results, backup reference and follow-up owners.

If a required acceptance check fails, stop activation and record the failure. If traffic is already open, apply the approved containment plan and escalate to the recovery decision owner. Roll back the application only if the current schema is compatible with the previous release. For committed migrations or external side effects, follow the approved forward fix or restore procedure, then verify access and data integrity before resuming.

## Local development first run

Run from a versioned HELPInsights checkout with the Node version declared in `package.json`, Corepack, Docker Engine and Compose. Select a local Docker context with a Linux engine. The doctor checks the revision and worktree state, pinned pnpm, lockfile, Docker and Chromium, and reports a nonzero exit code on failure. It does not install dependencies or start containers.

```powershell
corepack.cmd pnpm doctor:local
corepack.cmd pnpm install:demo
```

On macOS or Linux, use `corepack` without the `.cmd` extension. On a fresh checkout the doctor can report that Chromium or the locked dependencies are missing. The install demo checks the host first, installs the pinned packages and Chromium, and then uses the existing disposable Compose verification runner. It seeds a synthetic workspace owner and development session and exercises create, publish, respond, PostgreSQL restart, results, and JASP export in Chromium. It never bootstraps a reusable administrator.

A successful run removes its own named Compose services and volume and prints `LOCAL_INSTALL_RECEIPT` with checkout, toolchain, readiness and verification results. The receipt describes a completed test run, so there is no retained service URL. A failed stage exits nonzero and leaves no success receipt. The runtime log remains under `runtime-evidence/`, and any retained browser traces belong under `test-results/`.

A receipt marked `modified` shows an advisory revision SHA. Run from a clean checkout for exact-revision evidence. On Linux, a Chromium launch failure from missing system libraries may require a separately approved `corepack pnpm exec playwright install --with-deps chromium` run.

Separate deployment work covers signed release setup, approved database provisioning, TLS, time-limited first administrator setup, MFA or SSO, and reviewed upgrade and rollback procedures.

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

## Wizard checklist and readiness evidence

The operator completes the checklist for the selected environment and audience. Show each check as pending, passed, failed, or skipped for a documented optional component. Record evidence and remediation for failed steps. Required checks must pass before the wizard marks the checklist ready for review. Keep the receipt with the exact deployment target, release digest and supporting evidence in the release record.

- [ ] Release and host. Verify the release digest, supported runtime, DNS, HTTPS, network access, capacity, database and storage.
- [ ] Inputs and secrets. Collect environment, public URL, database and backup settings, operator ownership and protected secret references. Keep secrets out of the checklist and installation receipt.
- [ ] Entra and access. Confirm the approved tenant and application registration, redirect URLs, MFA enforcement and first administrator. Verify an authorised creator can publish and a signed-in user without workspace authoring authority is denied.
- [ ] Survey audiences. Submit to a public survey without University sign-in. For each enabled University-only distribution, verify its approved policy version, eligible acceptance and ineligible denial. Use authorised test accounts and synthetic answers.
- [ ] Integrations. For each enabled application, record its owner, approved permissions and workspace scope. Verify one permitted call, one out-of-scope denial and denial after revocation. Record any optional integration left off.
- [ ] Data and recovery. Review the migration plan, verify database readiness, test backup restoration and smoke-test creation, publication, response and permitted export.
- [ ] Activation. Review the redacted receipt and record the deployment owner’s approval. For research, the University’s external clearance and consent process governs the study.

Run the terminal checklist with `corepack pnpm deploy:checklist`. Select public, University, or both, then indicate whether approved external API integrations are enabled. Answer each prompt after checking its evidence. The command prints a redacted `DEPLOYMENT_CHECKLIST` receipt with the operator's attestations. `READY_FOR_REVIEW` means all applicable steps were attested. `BLOCKED` and `INCOMPLETE` return a nonzero exit code. Activation and approval follow the University deployment process.

The local installation demo verifies the disposable development journey independently. Production host provisioning, institutional verification, and approved activation remain open.

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
