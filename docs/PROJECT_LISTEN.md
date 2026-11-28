# Project Listen — Stage 1 pilot and Stage 1B operating workflow

## Purpose

Use Project Listen to validate general-purpose survey creation, respondent UX, privacy, reporting, retention and operations. The core must remain independent of HELP University. Workflow/case-management is **not part of the core survey engine**.

## Stage 1 pilot journeys

1. An authorised staff member creates a five-question after-class feedback survey from a template, previews it and performs a dry run.
2. Creator configures anonymous or identified mode **before** publication, closing time, respondent eligibility and allowed retention period.
3. Creator publishes an immutable version and distributes a QR/link or invitation tokens.
4. Student completes it on mobile; backend validates submission, stores reliably and returns a receipt. The form explains privacy and data handling.
5. Owner views permitted aggregate results, filters safely, exports labelled CSV and sees expiry date.
6. Admin views operational health, notices, failed tasks and backup status without automatic access to survey answers.

Optional fixture-supported use case: a per-class invitation list supports one response per *eligible token* or verified student/class/distribution for identified mode. **An open anonymous QR link cannot guarantee one response per student**; do not make that promise. Use anonymous one-time tokens when eligibility must be checked without identifying answers, with careful unlinkability testing.

## Synthetic Registry development slice

ENG-011a adds a network adapter and private HTTP Registry simulator to the disposable test stack. In that stack only, an authorised creator can publish a distribution with `eligibilityMode: registry-synthetic`. The respondent verifies a synthetic credential before seeing the questionnaire or submitting. The adapter sends only that opaque fixture credential to the simulator. The simulator returns a boolean without seeing the survey or answers.

A successful check issues a signed capability that is scoped to the exact distribution and expires in five to ten minutes. The browser keeps it in memory and sends it in a header. Survey responses, receipts, application logs, and simulator logs store no capability, credential, or person ID. The capability is shared across successful checks for the same distribution in the same time window. It can be shared or reused until expiry, so there is no one-use or per-person guarantee. Timing and small-group risks, one-use unlinkable collection, and live-provider approval remain production gates. If the simulator is unavailable, no new capability is issued. Existing unexpired capabilities retain their expiry.

## Stage 1B feedback-to-action process (operational rollout)

`Response collected -> authorised triage -> classify -> decide action required -> create/route case in external tracker -> assign owner -> follow up/escalate -> verify resolution -> communicate outcome where possible -> close and report.`

Build only the bounded integration capabilities needed for that process. Case management, SLAs, owner assignment and resolution are managed in a designated external service/tracker (to be selected/approved), not a full ticket system embedded in survey core.

Triage rules:
- Not every negative answer creates a ticket. Use thresholds plus human review, or approved narrow automation.
- Distinguish patterns for aggregate operational improvement from individual cases requiring follow-up.
- Anonymous feedback generally cannot receive individual response; only send privacy-safe information and suppress small group detail.
- Safety/welfare disclosures need a governed referral path, not open email/webhook broadcasting.
- Prevent leakage of raw free-text responses to systems not authorised to hold them.
- Case references stored as **opaque external IDs**, not as unauthorised response-content copies.

## Minimum event/data contract

`survey.action.requested.v1` carries `eventId`, `organisationId`, `surveyId`, `surveyVersionId`, `createdAt`, `category`, `priority`, `sanitisedSummary`, `consentOrLawfulBasisRef`, `originMode` and optional privacy-safe aggregate context. Do not include `respondentId` in anonymous mode. Include an idempotency key; receiver deduplicates. All payload fields must be policy-controlled and reviewed.

## Synthetic case handoff development slice

In the disposable test stack, open **Synthetic case handoff** from the
workspace home. The test fixture supplies an appointed reviewer token, the
survey and version IDs, and the synthetic basis reference. Choose an
allowlisted category and priority, confirm approval and queue the event.
The page and endpoint require both `NODE_ENV=test` and
`HELPINSIGHTS_DEV_CASE_HANDOFF=synthetic`, set by the test Compose overlay.

PostgreSQL requires the reviewer to be a member of that workspace and the
active fixture basis to match the exact published anonymous survey version.
PostgreSQL generates the category summary and stores the verified reviewer
privately. The receipt carries opaque survey, version and basis identifiers
and a standard summary. It contains no raw response, response or respondent
identifier, reviewer identity or token. Events stay queued in PostgreSQL.
The synthetic fixture does not establish participant consent.

A matching retry receives the same event while the reviewer and basis are
still authorised. If the reviewer appointment or basis has been revoked
since a lost receipt, the retry is denied. A trusted reconciliation
process is needed before enabling delivery.

Migration 023 adds the outbox after the cumulative integration settings
migration. The basis and audit event deliberately avoid foreign keys into
the survey collection so eligible core deletion can proceed. A disposal
tombstone prevents approval against restored survey rows. The audit event
retains minimal attribution after core deletion. Define a separate
outbox/basis retention and reconciliation policy, and review whether survey
identifiers or timing can identify small cohorts before any provider use.

To turn off the test path, remove the test flag and restart the app. The
schema stays applied. Keep the additive migration in the ledger. Any future
external ticket connector, delivery simulator, reviewer provisioning,
welfare referrals, real lawful basis and delivery audit require separate
work and governance.

## Stage 1B acceptance gate

- End-to-end feedback cases processed using agreed roles: review, assignment, deadline, evidence and resolution verification.
- Leadership has access to basic trend/action reporting and can distinguish received feedback, actioned items and unresolved concerns.
- Owners and escalation recipients assigned by **real project governance**, not fabricated by AI developer.
- Sensitive and anonymous modes pass a privacy review.
- Document at least one live complete feedback cycle, post-launch issue review and operational sign-off before Stage 2 is enabled in HELP production.

## Proposed initial KPIs — require approval

95% actionable feedback triaged in 2 working days; 100% accepted cases with an owner; all critical/overdue cases escalated under policy; closure requires evidence. These are proposed targets, not current institutional KPIs.

## University eligibility and research governance

Microsoft Entra is the external authority for institutional identity and student eligibility. The Research Ethics Board clears a research project before kickoff. The university's approved external study process governs participant consent. Apply these boundaries when choosing the minimum information the survey platform may receive. The Registry and consent simulators exercise local failure and privacy behavior with synthetic data.
