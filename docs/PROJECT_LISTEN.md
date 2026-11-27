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

## Stage 1B acceptance gate

- End-to-end feedback cases processed using agreed roles: review, assignment, deadline, evidence and resolution verification.
- Leadership has access to basic trend/action reporting and can distinguish received feedback, actioned items and unresolved concerns.
- Owners and escalation recipients assigned by **real project governance**, not fabricated by AI developer.
- Sensitive and anonymous modes pass a privacy review.
- Document at least one live complete feedback cycle, post-launch issue review and operational sign-off before Stage 2 is enabled in HELP production.

## Proposed initial KPIs — require approval

95% actionable feedback triaged in 2 working days; 100% accepted cases with an owner; all critical/overdue cases escalated under policy; closure requires evidence. These are proposed targets, not current institutional KPIs.
