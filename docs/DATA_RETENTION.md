# Retention, export and secure disposal specification

## Product rule

Surveys and response data are **not retained indefinitely** by default. Owners receive clear dates and authorised export opportunities before scheduled disposal. Policies inherit `platform -> organisation -> survey`, with organisation/platform constraints taking precedence. Academic-research retention rules are Stage 3; Stage 1 must support a generic policy engine that can accommodate later obligations.

## Policy fields

`policy_id`, `version`, `scope`, `trigger` (`closed_at` for completed surveys or `last_modified_at` for inactive drafts), `duration_days`, `notice_days`, `export_allowed_roles`, `holds_allowed`, `maximum_extension_days`, `backup_retention_days`, `effective_at`. Any changes to live policies require audit and impact preview.

**Illustrative defaults requiring operator approval:** quick polls 90 days after closure, ordinary surveys/Project Listen 365 days after closure, dormant drafts 180 days after last edit. Academic studies have approved, study-specific retention and are not auto-assigned the ordinary default once research mode exists. No policy permits indefinite retention as a silent default. Minimum/maximum periods, notices and grace periods must be agreed with HELP's data owner/DPO and, where applicable, legal/research governance.

## Lifecycle

`draft -> published -> closed -> retention_due -> disposal_pending -> disposed`. Pausing is an operational state, not a permanent retention bypass. Late reopen must either create a new distribution/survey version with new deadlines or obtain authorised extension. Every state transition is auditable.

1. Calculate an explicit expiry timestamp and display it in the user dashboard when a survey closes (and earlier when predictable).
2. Send advance in-app/email notices, e.g. 30 and 7 days ahead where policy allows; inform owners of export rights.
3. At expiry evaluate legal/research hold, statutory requirement, pending authorised extension and open export jobs; do **not** allow unbounded blocking from repeated export requests.
4. Delete response content, identity mappings, survey definition versions eligible for disposal, related attachments, generated datasets, resumable drafts, caches, indexes and outbox payloads according to policy.
5. Write a minimal non-content disposal record; log failed deletion and retry safely. No lingering export URLs.
6. Expire and purge backups under their *separate* documented retention cycle. On restore, replay tombstones/disposal ledger before exposing restored records.

## Export before deletion

Stage 1 bundle: `survey.json` (definition/version), `responses.csv`, `codebook.json` or `.csv`, `manifest.json` (version, date, scope, hashes, privacy redactions, file list). Download is asynchronous, access-controlled, audited, encrypted in storage, signed URL short-lived, export object deleted automatically after TTL. Protect against spreadsheet formula injection in CSV. Never export identifiable mappings to analysts without explicit permission. Later research archives add instrument/consent/scoring provenance where appropriate.

## Privacy and exceptions

- Anonymous respondents must not become identifiable through metadata, exports, logs or helpdesk actions.
- A survey creator cannot override an organisational maximum, bypass a mandated hold or force-delete data needed for a lawful obligation.
- Hold: reason, scope, approver, start, review/expiry date and evidence reference; approval role distinct from ordinary creator; regular review required.
- Respondent data rights and withdrawal processes depend on privacy mode, consent and applicable law. Truly anonymous data may not be retrievable by identity after submission; display that limitation clearly.
- Exported data outside the platform is a *separate* repository and remains the responsibility of the receiving owner and their institutional policy. The platform should advise approved storage, not assert it can delete all external copies.
- Aggregate trend reporting after deletion is permitted only when formally assessed as non-identifying and compatible with policy; small-cell disclosures need suppression.

## Development retention slice

ENG-010a keeps the workspace policy's expiry when a published survey closes.
PostgreSQL stamps closure and adds the policy duration in 24-hour days.
Deadlines already stored before the migration are preserved. A closed
survey with no finite deadline cannot be disposed. Workspace members can
read the disposition and deadlines through the survey retention endpoint.
The `eligible` disposition records an expiry and hold check only.

A workspace member with a separate hold approver appointment can record a
legal or research hold with a future UTC deadline and an opaque evidence
reference. PostgreSQL records the verified approver and time. The
workspace-facing status omits audit attribution and evidence references.
Survey ownership and platform operations roles confer no hold approval.
Approval locks its membership and appointment until the transaction ends.

PostgreSQL guards deletion of core surveys, versions and responses. Approval
and deletion serialize through the survey row. Privileged TRUNCATE and
trigger bypass fall outside the row guards. A future disposal role must
have narrowly scoped rights and no TRUNCATE or trigger-bypass privileges.
This API provides no
execution endpoint or worker for scheduled disposal. Workspace policy
inheritance beyond the existing workspace default, notices, hold review
and release workflows, derivative cleanup, and post-disposal tombstone
replay remain separate acceptance scope. Removing the guard independently
would remove hold protection. Preserve active holds and deadlines during
any coordinated rollback or restore.

## Disposal preview and fixture proof

ENG-010b adds a read-only eligibility preview for explicitly appointed
retention reviewers in the survey workspace. The same appointment can
approve holds. The preview exposes the current deadlines and disposition
only. Due surveys with linked Live Poll rooms show a protected disposition until a live derivative policy is implemented. Other due surveys with a queued export show `export_pending`. A deployment
still needs an approved rule for outstanding jobs and a bounded window
that repeated export requests cannot extend indefinitely.

The runtime migration creates a restricted tombstone table containing a
survey ID, workspace ID and disposal time. Runtime database roles have
no tombstone write grants. The runtime has no disposal endpoint or
automatic disposal execution.

A test-only function and its runner demonstrate atomic cleanup of core
survey records, distribution links, stored export archives and linked
download audit in owned synthetic fixture databases. The function and
its marker tables are excluded from packaged runtime files. In the test
restore, a separately owned database starts with an earlier snapshot.
The test applies the redacted tombstone before connecting an application,
and the old survey data and generated archive are removed. A failed or
mismatched replay requires manual escalation with the restore isolated
from application traffic. The fixture creates no runnable repair or
disposal path for a deployed system.

Production scheduling, policy for in-flight exports, outbound notices,
retention for minimal ledger data, external derivative stores and trusted
post-restore replay remain separate acceptance gates. A deployment rollback
must preserve records and any future approved tombstones.

## Acceptance tests

Policy inheritance; expiry calculation across time zones; user notices; inaccessible expired export links; RBAC on dataset exports; disposal retries/idempotency; preservation under valid hold; deletion of file/cache/jobs; backup expiration; restore re-applies tombstones; draft aging; exports escape formula-like cells; survey definition and codebook agree with response version.
