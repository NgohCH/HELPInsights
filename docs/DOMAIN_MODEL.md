# Domain model and invariants

| Term | Definition / invariant |
|---|---|
| Organisation | Top-level tenant. Every read/write has verified tenant scope. |
| Workspace | Authorised collaboration boundary within an organisation. |
| Survey audience | The people a published distribution is intended to reach. An open public audience needs no University account. A University-only audience requires institutional eligibility. |
| Survey creator | An authenticated person with explicit creator approval and authority in a workspace. |
| Public creator | An approved creator using an account outside University sign-in. Uses the general tools enabled for that audience. |
| System administrator | A person with explicit platform authority to set tool availability, approve users or groups and manage integrations. |
| Tool grant | An administrator's scoped approval for a named user or approved identity group to use a tool. The tool's audience and workspace permissions also apply. |
| Eligibility policy | A versioned University-approved rule with an accountable owner and approved institutional data source. A department selects an approved policy for its restricted distribution. |
| Integration client | An approved application with its own identity, owner, named operations and explicit organisation, workspace or resource scope. Access can vary by department and environment. |
| SurveyDefinition | Editable design, questions, pages, logic and metadata; draft only. |
| Question visibility | An optional match against a stable option code of an earlier unconditional single-choice question. Hidden questions accept no answers. |
| SurveyVersion | Immutable published snapshot with stable question and option IDs. |
| Distribution | Channel/campaign referencing exactly one published version. A University-only distribution is bound to its approved eligibility policy and version. The synthetic Registry fixture also binds its selected policy to the distribution in development. |
| Participation | Eligibility/attempt ledger; separated from answers for anonymous modes. |
| Response | A submission against a single version, with idempotency and server validation. |
| Attempt | Quiz/self-paced attempt governed by attempt policy, distinct from Response. |
| LiveSession | Ephemeral hosted game referencing a published quiz version; server authoritative transitions. |
| LiveAnswer | Participant/session/question attempt with unique constraints; server timestamp and scoring. |
| ResearchStudy | Study consent, governance and approved retention settings; may have waves. |
| SyntheticConsentVersion | A fixed test notice snapshot bound to one published distribution. Its revision follows the survey version. |
| SyntheticConsentOptIn | A private affirmative event linked to the consent version. No respondent or response pointer is stored. |
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
