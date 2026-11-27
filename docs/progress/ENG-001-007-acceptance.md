# First survey workflow acceptance

Use synthetic organisations, workspaces and anonymous responses on loopback. This slice uses Node 24, TypeScript and the locked pnpm workspace. PostgreSQL is the source of truth. Tests use HTTP, Chromium and independent SQL assertions.

| Ticket | Expected behaviour | Failure signal |
| --- | --- | --- |
| ENG-001 | Documentation validator passes and the runtime check fails when app or test entry points are missing | A missing suite exits zero or browser smoke cannot read the HELPInsights heading |
| ENG-002 | Fresh PostgreSQL migrates on boot. Reapplying migrations preserves existing state. Readiness depends on the migrated PostgreSQL schema | App reports ready with no connection or current schema, or rerun fails |
| ENG-003 | Session determines organisation, workspace and role. Non-members cannot read or write scoped data even when they know an object ID | Cross-tenant API or database read/write succeeds |
| ENG-004 | Creators save drafts with stable codes. A published SurveyVersion stays immutable after the definition is edited | Invalid design accepted or changed content appears under an existing version |
| ENG-005 | Public link targets one version. Server validates answers. Concurrent identical submissions with one idempotency key commit one row | Invalid answers persist, retry duplicates the row, or a changed payload succeeds with the same key |
| ENG-006 | Creator and mobile respondent complete the survey using labelled, keyboard-operable controls | Creator cannot reach publish or respondent cannot submit and see confirmation |
| ENG-007 | Authorised creator sees chart totals and downloads a JASP CSV bundle. CSV fields reconcile with stored codes, formula-like text is escaped and private identity is absent | Unauthorised access succeeds, data leaks or UI and CSV disagree with SQL |

Start with browser smoke, then database readiness and restart, before opening tenant and survey endpoints. After the complete browser journey, restart the app and database and reconcile charts and export with SQL again. Each PR requires independent standards and specification review and an exact-SHA verification record.
