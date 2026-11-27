# Build status

| Scope | Status | Evidence |
| --- | --- | --- |
| Environment entry gate | PASS | The clean baseline `5d5e443d13328a07a71810cd90eb3a9785a3c902` matched the GitHub remote. Docker PostgreSQL 16 persisted the SQL fixture across restart. |
| ENG-001 and ENG-002 development bootstrap | VERIFIED_INTEGRATION | Exact revision `07c70a4627556bf6b8684609982289ae2356ea5a` passed the local runtime, real SQL, outage, migration, restore, secret scan and Chromium checks. |
| ENG-003 session and tenant boundary | NOT_STARTED | The isolated workflow branch has the test-first criteria. |
| ENG-004–ENG-013 and ENG-015–ENG-019 | NOT_STARTED | The first complete survey workflow and later modules await the dependencies in [the task graph](TASK_GRAPH.md). |
| ENG-014 Live Poll lobby slice | VERIFIED_INTEGRATION | Host and guest snapshots passed real PostgreSQL and Chromium restart checks at [d1e5adcc4b09](../evidence/ENG-014/d1e5adcc4b09d8ecea6c880a1ee985a2a023b3ed.md). See ENG-014b for the host lifecycle extension. |
| ENG-014b Live Poll host controls | VERIFIED_INTEGRATION | [be898f0ceea9](../evidence/ENG-014b/be898f0ceea991afef379b1c1cd8607bc7eb0c5b.md) verified revision-checked controls, same-process WebSocket updates and mobile reconnect with PostgreSQL. See ENG-014c for voting and a local contention check. |
| ENG-014c Live Poll voting | VERIFIED_INTEGRATION | [164fb832037a](../evidence/ENG-014c/164fb832037a2b440918c363e9e2b00a8d37ab25.md) verified durable ballots, presenter and mobile guest WebSocket updates, suppressed live results and 50 synthetic guests on one process. Timed scoring and production acceptance remain open. |
| ENG-015a private timed Game Show | VERIFIED_INTEGRATION | [0de928312a2f](../evidence/ENG-015a/0de928312a2fbef0a8fb8dd90ed6cd32cc0dc9c2.md) verified PostgreSQL-timed scoring, separate attempts, browser deadline recovery, eligibility denial and archive restore. Score release and broader Game Show gates remain open. |
| Merge and production release | BLOCKED | GitHub reported no active main branch protection. Human release approval is pending. |

See [the evidence ledger](EVIDENCE_LEDGER.md) for commands and scope.
