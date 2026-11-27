# Build status

| Scope | Status | Evidence |
| --- | --- | --- |
| Environment entry gate | PASS | Clean source baseline `5d5e443d13328a07a71810cd90eb3a9785a3c902`. PostgreSQL persisted SQL across restart. |
| ENG-001 and ENG-002 bootstrap | VERIFIED_INTEGRATION | Local and GitHub checks passed on [draft PR #1](https://github.com/NgohCH/HELPInsights/pull/1). |
| ENG-003 through ENG-007 first anonymous survey roundtrip | VERIFIED_INTEGRATION | Opened in [draft PR #2](https://github.com/NgohCH/HELPInsights/pull/2). |
| ENG-006b saved draft preview | VERIFIED_INTEGRATION | Opened in [draft PR #3](https://github.com/NgohCH/HELPInsights/pull/3). |
| ENG-006c searchable creator guide | VERIFIED_INTEGRATION | Browser search and contextual preview help passed on the combined stack and [draft PR #7](https://github.com/NgohCH/HELPInsights/pull/7). |
| ENG-008a curated template | VERIFIED_INTEGRATION | Opened in [draft PR #4](https://github.com/NgohCH/HELPInsights/pull/4). |
| Combined preview and template development branch | VERIFIED_INTEGRATION | Chromium exercised template preview, copy, saved draft preview and editing together. |
| ENG-009a operations roles, health and incident history | VERIFIED_INTEGRATION | Exact revision `3bf00776434715cdf34d6c3673ff40ca5363e398` passed PostgreSQL permissions, restart, upgrade, restore and Chromium. See the [verification record](../evidence/ENG-009a/3bf00776434715cdf34d6c3673ff40ca5363e398.md). |
| ENG-014 Live Poll lobby slice | VERIFIED_INTEGRATION | Host and guest snapshots passed real PostgreSQL and Chromium restart checks at [d1e5adcc4b09](../evidence/ENG-014/d1e5adcc4b09d8ecea6c880a1ee985a2a023b3ed.md). Scoring and broader Live Quiz acceptance remain open. |
| ENG-014b authorised live controls and single-instance updates | VERIFIED_INTEGRATION | Standalone PostgreSQL and Chromium checks passed on [draft PR #9](https://github.com/NgohCH/HELPInsights/pull/9). |
| ENG-008b workspace review for NPS authoring | VERIFIED_INTEGRATION | PostgreSQL and Chromium verified requests, delegated decisions, expiry, preserved numeric drafts and NPS submissions. [Exact source evidence](../evidence/ENG-008b/cd071f2560308cb185def788b4b8a70c8da6a4d7.md). |
| ENG-010a survey closure expiry and hold guard | VERIFIED_INTEGRATION | Exact revision `c801b00963a0165c58e468a1723db950bd6dac3f` passed scoped approval, clock boundaries, concurrent disposal protection, upgrade, archive restore and Chromium regression. See the [verification record](../evidence/ENG-010a/c801b00963a0165c58e468a1723db950bd6dac3f.md). |
| ENG-007b checked-out PostgreSQL interruption | VERIFIED_INTEGRATION | A deterministic regression recovered the same pool. The survey export passed after a database restart on [draft PR #14](https://github.com/NgohCH/HELPInsights/pull/14). |
| ENG-010b read-only disposal preview and synthetic archive replay | VERIFIED_INTEGRATION | Standalone database and Chromium checks passed on [draft PR #11](https://github.com/NgohCH/HELPInsights/pull/11). Scheduled production disposal remains open. |
| ENG-011a synthetic Registry eligibility | VERIFIED_INTEGRATION | Standalone browser, provider outage/recovery and PostgreSQL passed on [draft PR #12](https://github.com/NgohCH/HELPInsights/pull/12). Unlinkable one-use eligibility remains open. |
| ENG-014c Live Poll voting and privacy-filtered aggregates | VERIFIED_INTEGRATION | Independent scope review and focused testing included 50 concurrent synthetic guests and exact SQL vote counts. See [draft PR #13](https://github.com/NgohCH/HELPInsights/pull/13). |
| ENG-013a conditional visibility and private preview | VERIFIED_INTEGRATION | Mobile authoring and collection passed on [draft PR #16](https://github.com/NgohCH/HELPInsights/pull/16). The combined template-code regression is verified. |
| ENG-012a case handoff | VERIFIED_INTEGRATION | Standalone synthetic approval, SQL deduplication and mobile browser passed on [draft PR #15](https://github.com/NgohCH/HELPInsights/pull/15). Delivery and governance remain open. |
| ENG-016a synthetic consent | VERIFIED_INTEGRATION | Standalone PostgreSQL and Chromium verified versioned opt-in and atomic persistence on [draft PR #17](https://github.com/NgohCH/HELPInsights/pull/17). Cross-module integration remains open. |
| Cumulative development stack through Live Poll voting and conditional follow-ups | VERIFIED_INTEGRATION | Exact source 4a1a20f7aa68 passed 35 PostgreSQL integration, two security and 13 Chromium checks. [Cumulative evidence](../evidence/ENG-INTEGRATION/4a1a20f7aa68d2d2c29b9c3d5b04a9e45a463f81.md). |
| Cumulative lifecycle and Live Poll disposal protection | VERIFIED_INTEGRATION | Exact source 179289716ac8 passed 38 PostgreSQL integration, two security and 13 Chromium tests. [Cumulative evidence](../evidence/ENG-010b/179289716ac8f434114e338252965069a75008f7.md). |
| ENG-015a Game Show timed scoring | VERIFIED_INTEGRATION | Standalone private score persistence, deadline, restart, archive and Chromium checks passed on [draft PR #20](https://github.com/NgohCH/HELPInsights/pull/20). Private score release and rankings remain open. |
| ENG-017a export worker recovery incident | VERIFIED_INTEGRATION | Standalone verified real backend interruption and the same worker completing the export at [draft PR #19](https://github.com/NgohCH/HELPInsights/pull/19). Durable incident buffering and routing remain open. |
| ENG-018a local install and doctor | VERIFIED_INTEGRATION | Clean Windows local install/demo passed on [draft PR #21](https://github.com/NgohCH/HELPInsights/pull/21). Persistent administrator provisioning and fresh OS/browser dependencies remain open. |
| Cumulative synthetic policy boundaries | VERIFIED_INTEGRATION | Exact source 2edb7592e419 passed 53 PostgreSQL integration, two security and 16 Chromium checks. Entra eligibility and research governance are external. [Evidence](../evidence/ENG-016a/2edb7592e419c784835df19edeccda79aa3a8511.md). |
| Remaining platform features | NOT_STARTED | See the uncompleted features and prerequisites in [the task graph](TASK_GRAPH.md). |
| Production release | BLOCKED | Branch protection, required evidence and authorised approval remain pending. |

See [the evidence ledger](EVIDENCE_LEDGER.md).
