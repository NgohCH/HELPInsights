> **v2.2 requirement:** Comprehensive product features remain in a single integrated build programme; continuous tests and real-database verification are required throughout implementation, not at a later phase. `SPEC.md` resolves historical delivery language, with separate production release gates for Project Listen, case follow-up, advanced features, research and Live Quiz Arena.

# INTENT — Independent Survey Platform

## Mission

Create a general-purpose, independent, reusable survey platform for organisations, with HELP University as its first adopter. The product should enable ordinary staff to create effective surveys without developer support and later support sophisticated surveys and academic research.

## Deployment policy

- Stage 1 proves usability and Project Listen collection/analysis, including essential safety, monitoring, retention and admin operations.
- **Pause feature expansion after Stage 1 go-live.** Stage 1B establishes the feedback-to-action operational process, separate from the generic survey engine. No Stage 2 work until a documented gate decision.
- Stage 2 adds advanced survey capabilities.
- Stage 3 adds research-specific capabilities. Neither is pre-authorised by this document.

## Non-negotiable qualities

Intuitive UX; out-of-box maintainability; modular design; security and privacy by design; reliability; bounded self-healing; cyber-resilience; central admin action centre; personal user dashboard; configurable retention and disposal; clear APIs, tests and operational documentation.

## Architectural constraints

- Standalone product, no dependency on HELP Person Registry, MyHELP, Kainow, OTRS, Moodle, Microsoft/Entra or cloud-vendor-specific services.
- Optional HELP integrations behind replaceable adapter interfaces.
- Dedicated application database per installation; multi-tenancy inside that database where enabled.
- Published survey versions immutable. Collect only needed data.
- Explicit anonymous/identified/pseudonymous modes, enforceable at storage, API, export, audit, notifications and analytics boundaries.
- Durable, idempotent response and event processing. Defined lifecycle and tenant-aware access policy.
- Security-first operational automation; high-impact remediation with human authorisation.

## Stage 1 product success criteria

1. Non-technical pilot staff can independently create, preview and publish five-question surveys in a target of 10 minutes following brief orientation (measure in usability tests; target is provisional).
2. Students can submit short Project Listen surveys on common mobile devices, with accessible interactions.
3. Draft/published/closed/expired lifecycle works with published version locking.
4. Simple question types, basic validation, basic dashboard charts, safe CSV/data dictionary export, survey definition export and distribution links/QR codes work.
5. Identified and genuinely anonymous survey modes and permission boundaries are validated by automated security tests.
6. Admin centre shows health, backup, retention/disposal status, security notices and actionable notifications. Automatic recovery bounded and audited.
7. Database restoration, ingestion idempotency, expiry/disposal and cross-tenant denial are tested, with evidence.
8. A small, well-defined event/API pathway supports Stage 1B triage without leaking identities.

## JASP interoperability (required)

- **JASP (https://jasp-stats.org/) is an explicitly supported downstream analysis tool**, alongside R and SPSS, not an optional afterthought.
- Stage 1: export a JASP-importable, UTF-8 CSV dataset with stable machine-safe column names, consistent one-row-per-response structure, separate `codebook.csv`, `manifest.json`, and a plain-language import guide. Preserve explicit nominal/ordinal/scale metadata, value labels and missing-value definitions in the codebook; CSV alone cannot guarantee JASP automatically imports these semantics.
- Stage 3: add tested `.sav` exports carrying variable/value labels and measurement metadata wherever format supports them; cover reverse-scored and computed variables, repeated measures and research version provenance. JASP can import `.sav` and `.xlsx` as well as `.csv`; no custom JASP plugin or native `.jasp` project export is promised.
- All exports require permissions, retention checks, small-cell/privacy controls where applicable, safe spreadsheet formula handling and time-limited access. Never include identifying fields in anonymous survey exports.
- Verify imports in a supported JASP release using fixture data, including Likert (ordinal), nominal coded groups, scale scores, multilingual text and missing data.

## Excluded from Stage 1 (reserve extensibility only)

Complex piping and randomisation; multilingual authoring; advanced quotas; full participant panels; experimental allocation; psychometric scale libraries; longitudinal linkage; native mobile apps; full statistical analysis; autonomous AI patching; built-in service-desk/ticketing platform; unlimited survey archive; full LimeSurvey file-format compatibility.

## Stage gate ownership

A named Product Owner and Security/Operations approver must authorise production launch and later-stage starts. These people are **to be assigned**; do not invent names, assignments, approvals or dates. Platform automation and coding agents cannot approve their own stage gates.

## 2026-11-25 full-scope autonomous build amendment

All stages (Project Listen, feedback-to-action workflow, advanced surveys and academic research) are now within the **same isolated development programme**. Original sequential development constraints are superseded wherever they conflict with this amendment. Production activation remains staged and approval-gated. Source must include an installation wizard/doctor, operational administration centre, secure low-exposure deployment, self-healing with bounded preauthorised actions, extensible modules and research-ready JASP-interoperable exports. No promise of invisibility or immunity to cyberattack. Consult `docs/AUTONOMOUS_BUILD_PLAN.md`, `docs/DEPLOYMENT_GUIDE.md` and `docs/THREAT_MODEL.md`.

## Unified-build expansion: experience, channels and operational transparency

The full-scope development contract includes drag-and-drop multipage authoring, accessible question reordering, NPS/matrix/ranking/file/image question types, declarative logic, piping and question/page visibility, secure SSO-initiated in-app surveys, multichannel delivery (email, optional SMS, QR, embed, reminders), protected kiosk and genuinely tested offline synchronisation, optional privacy-controlled sentiment analysis, and complete self-healing incident reporting in the Administrative Control Centre. Design all capabilities as replaceable, independently tested modules. Details: `docs/INTERACTION_CHANNELS_INTELLIGENCE.md`. This amendment supersedes earlier 'excluded from Stage 1' language **for development scope only**; production activation stays separately gated.

## Creator adoption (mandatory cross-stage scope)

Creation Wizard defaults to purpose-led entry for **survey, quick poll, scored pop quiz, feedback form, evaluation and academic research**. Users can begin with curated templates, guided blank forms or import, then edit pages via accessible drag-and-drop, review a readiness report, preview and publish. Feature Catalogue and Request Centre provides controlled entitlement approval for specialist functions; searchable contextual help and a user-friendly guide accompany each step. These are core reusable product modules, not HELP-specific screens. See `docs/SMART_CREATION_WIZARD.md`, `docs/FEATURE_CATALOGUE_AND_REQUESTS.md`, `docs/TEMPLATE_LIBRARY.md` and `docs/USER_GUIDE_AND_ONBOARDING.md`.

## Live Quiz Arena — mandatory unified-build capability (25 November 2026)

Add **Live Quiz Arena** as an optional real-time delivery mode for the same canonical quiz definitions used by self-paced quizzes. Provide four presenter styles: Game Show (timed scoring and optional rankings), Classroom Learning (lecturer pacing and explanatory feedback), Live Poll (no competitive ranking), and Formal Assessment (controlled identity, attempts and result release). A live room uses join PIN/QR or approved in-app SSO, presenter controls, participant reconnect, server-authoritative deadlines and scores, durable PostgreSQL records and accessible results. Do not imitate proprietary artwork, audio or software from Kahoot; use an original presentation design.

Develop this module concurrently with the full scope in isolated worktrees. **Production activation is separately gated** by real multi-user, security, accessibility, durability and fault-recovery evidence. The absence of a websocket/real-time server must not prevent ordinary surveys or self-paced quizzes. Public rankings, aliases and personally identifiable results are disabled by default unless the authorised organiser explicitly enables permitted disclosures. See `docs/LIVE_QUIZ_ARENA.md`.
