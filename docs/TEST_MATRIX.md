# Requirement-to-evidence traceability seed

These are required, **NOT EXECUTED** until application implementation. Link each row to feature matrix IDs, PR SHA and tests as implemented.

| Requirement | Positive test | Negative/adversarial test | Gate |
|---|---|---|---|
| Basic wizard and templates | Create 5 question survey, publish, answer | unauthorised template edit | A |
| Multipage/logic | path choices produce correct visible questions | forged hidden answer rejected server-side | C |
| SSO/Registry | valid signed login/eligibility | expired/wrong-audience/token spoofing; identity leak | A |
| Respondent collection | real PostgreSQL write and correct export | simultaneous duplicate submits | A |
| Project Listen | issue triaged and tracked | no unauthorised or anonymous deanonymisation | B |
| Ticketing adapter | outbox handoff and status sync | replay, duplicate, unavailable endpoint | B |
| CSV/JASP | golden-coded dataset and codebook | missing values, formula injection, wrong scale type | A/D |
| Live Quiz Arena | 50 joins and server scoring | replay, answer after close, reconnect double count | LIVE |
| Retention | expiry/export/tombstone through restore | legal hold bypass, residual cache/files | A/D |
| Admin self-healing | fault, recovery, verified incident record | infinite retry loop, false-success green | A |
| Offline/kiosk | encrypted pending sync and cleared kiosk state | session bleed, duplicate sync, expired auth | C |
| Research | consent/assignment/golden scoring | cross-study participant identity exposure | D |
| Deploy/maintain | fresh install/admin/backup restore/upgrade | failed migration and recovery path | A |
