# Smart Creation Wizard — Functional and UX specification

**Status:** The [after-class feedback development slice](../evidence/ENG-006d/926b185a51e517cdef4845b3e02d13276b400724.md) is verified. The remaining unified-build requirements and release gates are open. **Owner:** assign in repository. **Personas:** ordinary staff, lecturer, student survey creator (if authorised), researcher, workspace reviewer. **British English** in copy.

## Product goal

A first-time creator should build and publish an appropriate survey, poll, pop quiz, evaluation, feedback form or research questionnaire without understanding technical survey terminology. The guided flow is the default; an accessible expert drag-and-drop editor remains available. Both modes create/edit the **same versioned canonical survey definition**. A failed wizard must never corrupt or discard drafts.

## Journey and step contracts

1. **Purpose:** Survey / Quick Poll / Pop Quiz / Feedback / Evaluation / Academic Research. Show plain-language examples, estimated effort and a preview. This choice preloads a configuration profile; it does not fork the runtime.
2. **Audience and access:** Public / authenticated SSO / invited respondents; select privacy mode separately (identified, pseudonymous, genuinely anonymous). Explain effects and incompatibilities. Never assume that SSO implies identified answers.
3. **Starting point:** Curated template, guided blank questionnaire, or import an authorised template/package. Templates must be cloned to a draft rather than modified in place.
4. **Question design:** Suggested question palette, accessible drag-and-drop and keyboard move controls, pages/sections, labels, validation, ordering, optional skip/visibility logic, answer piping, readable examples and estimated completion time.
5. **Purpose-specific configuration:** Quiz: answer key, points, feedback, attempt controls and release of marks; Poll: ballot options, eligibility and result-visibility rules; Feedback: issue category and follow-up consent; Research: consent and ethics metadata, variable codes and instrument rights.
6. **Distribution and settings:** Link/QR, in-app embed, SSO or invite, optional email/SMS, closing date, retention policy, reminder schedule. Chargeable channels require provider setup and approval.
7. **Readiness review:** Validate required questions, impossible routes, missing answer keys, invalid scoring, inaccessible media, permissions, privacy, retention, unauthorised feature use and unsatisfied provider dependencies. Classify **blocking errors**, **warnings**, **information**; do not call this an ethics/psychometric certification.
8. **Publish:** Show exact publication preview and immutable version summary. Explicit confirmation; record owner, version, settings and audit event. Publishing requires server-side validation and authorisation.

## Interaction principles

- Autosave resilient to refresh and network interruption; indicate last successful save and pending changes.
- Back/forward preserves answers. Resume draft by authorised user across devices. All steps are optional where not needed.
- Guide explains *why* a choice matters; no modal maze or busy interface. Show short examples and progressive disclosure.
- Switching to Expert Mode preserves canonical content, including unknown advanced settings. On returning, warn and offer a safe link to advanced controls; never silently drop unsupported settings.
- Interactive preview uses fixture responses in a separate test namespace and cannot contaminate production counts.
- Keyboard accessible reordering, focus/announcement of page changes, mobile gestures, WCAG 2.2 AA testing.
- Localisation-ready labels and guidance; no hard-coded HELP-specific templates or programme lists in core.

## Quiz and poll-specific boundaries

- Quiz scores are from explicitly authored keys/rubrics, not AI guesses. Server validates attempts, timing policy and release of results.
- Live poll results are shown only when configured and eligible; protect against repeat vote and vote inference where anonymity is promised.
- Survey, quiz and poll are *types/configuration*, not independently developed databases or authentication stacks.

## Suggested product instrumentation (privacy-preserving)

Wizard completion rate per step, median time to first publish, abandonment rate, errors at publish, number of help views and template usage. Aggregate and minimise event data; never log questionnaire answers or SSO bearer tokens in product analytics.

## Acceptance tests (real browser, API and PostgreSQL)

- First-time creator completes 5-question survey after brief orientation (proposed target <10 min; validate with actual users).
- Quiz with marked questions produces correct score and respects score-release policy; quick poll enforces configured voting eligibility.
- Draft refresh/resume, page reorder, copy template, switch to Expert and back, failed publish validation and safe recovery all pass.
- Simulated two-user concurrent editing shows conflict/version resolution, not silent overwrites.
- Cross-tenant templates cannot be read or cloned; feature controls enforced by server.
- Published version remains unchanged by subsequent draft editing; responses retain version identifier.
- Screen-reader, keyboard-only, mobile and low-bandwidth representative test evidence captured.

## Engineering ports

`CreationProfileRegistry`, `WizardStateRepository`, `SurveyDefinitionService`, `ReadinessValidator`, `TemplateCatalog`, `EntitlementEvaluator`, `HelpContentProvider`. No wizard-only schema; domain contracts are versioned. See `api/openapi.yaml` for the updated *design* endpoints.

## Live delivery selection for Pop Quiz and Poll

After designing a quiz/poll, the wizard asks **How would you like to deliver it?**: Self-paced, Live Game Show, Classroom Learning, Live Polling, or Formal Assessment. Only compatible modes are offered. The user chooses timing per question, presenter control, scoring method (accuracy; accuracy+speed), leaderboard visibility, joining policy (PIN/QR, SSO/invitation), attempts, correct-answer reveal timing and retention. Preview includes a working local presenter and participant simulation with fixture identities; final publish locks the questionnaire version, and creating a session does not mutate it. Feature entitlement decisions are enforced server-side; missing real-time infrastructure is a blocking readiness error for live mode only. Show privacy and classroom inclusivity guidance, with rankings off by default.
