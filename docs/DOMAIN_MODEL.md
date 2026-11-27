# Domain model and invariants

| Term | Definition / invariant |
|---|---|
| Organisation | Top-level tenant. Every read/write has verified tenant scope. |
| Workspace | Authorised collaboration boundary within an organisation. |
| SurveyDefinition | Editable design, questions, pages, logic and metadata; draft only. |
| Question visibility | An optional match against a stable option code of an earlier unconditional single-choice question. Hidden questions accept no answers. |
| SurveyVersion | Immutable published snapshot with stable question and option IDs. |
| Distribution | Channel/campaign referencing exactly one published version. |
| Participation | Eligibility/attempt ledger; separated from answers for anonymous modes. |
| Response | A submission against a single version, with idempotency and server validation. |
| Attempt | Quiz/self-paced attempt governed by attempt policy, distinct from Response. |
| LiveSession | Ephemeral hosted game referencing a published quiz version; server authoritative transitions. |
| LiveAnswer | Participant/session/question attempt with unique constraints; server timestamp and scoring. |
| ResearchStudy | Study consent, governance and approved retention settings; may have waves. |
| CaseHandoff | Privacy-reviewed outbox event and delivery receipt, not an internal ticket. |
| RetentionHold | Authorised limited-time exception, reason/review date, audit and policy control. |
| Incident | Immutable operational detection/recovery/action history; redacted, no response content. |
| FeatureEntitlement | Tenant/workspace/user policy enforcing backend capability access. The development NPS grant is derived from a workspace request approved by a delegated reviewer and whose expiry is in the future. |
| FeatureRequest | Workspace request with a stated purpose and data classification. A delegated reviewer records a decision and rationale with expiry when approved. |

## Security and correctness invariants
- Published version never mutates; subsequent edits produce a new snapshot.
- Every response/attempt references exactly one published version and permitted tenant.
- Server never trusts tenant/person IDs from client requests or embeds without authorisation.
- Eligibility proof and response data are separated for truly anonymous modes; do not log query strings that could link them.
- Idempotency keys uniquely govern survey submission, live answer and case handoff delivery.
- Timer and score are server authoritative; reconnect replays current state without duplicate scores.
- No side effect is committed twice after at-least-once queue delivery.
- Retention deletes live data plus derivative stores; backup expiry and restoration honour tombstones.
- Sensitive cross-system identity attributes are minimised and auditable.
- Server-enforced entitlements and row isolation are mandatory; frontend hiding is not security.

## Immediate tasks
Document state transitions and DB uniqueness constraints for SurveyVersion, Response, LiveSession, LiveAnswer, CaseHandoff, retention and anonymous Participation; write golden contract tests before parallel agents alter schema.
