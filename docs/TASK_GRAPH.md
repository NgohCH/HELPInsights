# Small dependency-linked autonomous work items

All tasks are PR-sized (aim: one observable vertical behaviour and its negative test). Each ticket must declare **ID / goal / prerequisites / owned paths / contracts / migrations / failing test / runtime test / negative tests / done evidence / reviewer**. Do not start a dependent task before its contract and prerequisite tests are green. Integration owner controls OpenAPI, domain contracts and migrations; parallel agents own disjoint source windows.

| Ticket | Depends on | Acceptance proof |
|---|---|---|
| ENG-001 Repository + CI/bootstrap check | — | docs CI passes; app CI explicitly NOT IMPLEMENTED until runnable |
| ENG-002 Disposable Docker/Postgres stack | ENG-001 | SQL readiness/transaction and container reset evidence |
| ENG-003 Tenant/session and roles contract | ENG-002 | cross-tenant denial, RLS/permission tests |
| ENG-004 Survey versions and CRUD contract | ENG-003 | immutable published snapshots & schema validation |
| ENG-005 Publish and respondent submission | ENG-004 | real DB submit, idempotent retry and SQL assertions |
| ENG-006 Wizard/create/edit/preview UI | ENG-004 | browser path, keyboard and screen-reader checks |
| ENG-007 Results, privacy filter and JASP CSV | ENG-005 | golden export and leakage test |
| ENG-008 Template + feature request service | ENG-004,ENG-003 | copy-on-use, backend entitlement bypass denied |
| ENG-009 Admin health/incident model | ENG-002,ENG-003 | durable incident and redacted audit records |
| ENG-010 Retention/hold/disposal | ENG-005,ENG-009 | clock and backup restoration tests |
| ENG-011 Registry simulator/adapter | ENG-003 | authenticated eligibility, anonymous unlinkability, failure closed |
| ENG-012 Ticket simulator/outbox | ENG-005,ENG-009 | consent/triage, dedupe, reconciliation, status sync |
| ENG-013 Branch/piping/advanced widgets | ENG-004,ENG-005 | shared client/server rules and negative cases |
| ENG-014 Live host/session API | ENG-004,ENG-003 | state machine, unauthorised PIN rejection |
| ENG-015 Live scoring and client | ENG-014 | 50-user contention, server timing, reconnection |
| ENG-016 Research consent/exports | ENG-003,ENG-004,ENG-007 | governance, seeded assignment, golden outputs |
| ENG-017 Notifications/monitoring/backup | ENG-009,ENG-010 | alert delivery, real restore and retry limits |
| ENG-018 Install wizard and documentation | ENG-002,ENG-003 | clean first admin, upgrade, rollback / recovery drill |
| ENG-019 Independent full-suite challenge | All relevant above | exact SHA review, risk disposition and release-gate record |

The old WP-001–WP-056 identifiers remain historical feature references; map each into smaller tickets in the issue tracker. Do not close broad WPs because child tasks exist. Product features may be developed concurrently after their shared contracts are stabilised; production feature activation retains separate gates.
