# ENG-018b deployment readiness checklist

Provide a terminal checklist for the deployment owner alongside the existing local doctor and disposable installation demo. Keep the interactive workflow independent of the production host and external identities.

- [ ] Write CLI tests for completion, a failed mandatory check, early input closure, and the optional integration condition.
- [ ] Run the tests against the existing branch and observe the missing command.
- [ ] Implement guided prompts with structured, redacted status output. Distinguish operator attestations from runtime evidence and deployment approval.
- [ ] Run focused tests, static checks, the existing clean local rehearsal on this branch, and the mandatory PostgreSQL and Chromium suites.
- [ ] Obtain independent review, capture exact evidence and prepare a draft PR.

The wizard accepts only enumerated answers. It uses no deployment credentials, runs no production changes, and produces a handoff for a separate approved activation. The selected audience controls the applicable survey checks. Authoring approval and MFA apply to every audience because every published survey has an authorised creator.
