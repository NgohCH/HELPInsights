# Verification evidence ledger

For each PR record the exact revision, environment, image digest, commands and exit codes, migration checksum, browser and direct SQL assertions, fault or restore checks and independent reviewer findings.

## 2026-11-27 environment entry gate

Runner Microsoft Windows NT 10.0.26300.0. Repository `NgohCH/HELPInsights`, `main`, SHA `5d5e443d13328a07a71810cd90eb3a9785a3c902`.

| Command | Result | Observed evidence |
| --- | --- | --- |
| `git status --porcelain`, `git rev-parse HEAD`, `git ls-remote --exit-code origin refs/heads/main` | PASS | Clean checkout. Local and GitHub main returned the recorded SHA. |
| `gh auth status`, `gh repo view NgohCH/HELPInsights --json viewerPermission --jq .viewerPermission` | PASS | Exit 0. NgohCH authenticated and repository permission was ADMIN. |
| `docker context show`, `./scripts/preflight.ps1` | PASS | Exit 0. Context desktop-linux, Git 2.56.0.windows.4, Docker Engine 29.9.2, Compose v5.6.1, Node v24.22.1 and Corepack 0.36.0. |
| `./scripts/test-postgres.ps1` | PASS | Exit 0. Official postgres:16-alpine pulled. Healthy project survey-preflight-83421fd356fb. CREATE TABLE and INSERT 0 1. PostgreSQL restarted and returned the expected before_restart row. Container, network and volume were removed. |
| `docker image inspect postgres:16-alpine --format '{{index .RepoDigests 0}}'` | PASS | postgres@sha256:f2f98726820d0342055351c6e9d36e705f5bfffb3dd53ff556325114b08afb6d |
| `python scripts/validate_docs.py` | BLOCKED_ENVIRONMENT on host Python | Exit 1. Python 3.15.2 lacks PyYAML. The documentation CI pins Python 3.12. Verify with isolated Python and PyYAML. |

The default sandbox denied access to the local Docker named pipe and GitHub API. The scoped preflight outside the shell sandbox recovered both checks. The PostgreSQL smoke used a dedicated unexposed Compose network and disposable volume. Application, browser and restore checks are tracked separately.

## ENG-001 and ENG-002 development runtime

- Tested revision `07c70a4627556bf6b8684609982289ae2356ea5a`. See the [exact-SHA verification record](../evidence/ENG-001/07c70a4627556bf6b8684609982289ae2356ea5a.md).
- Local runtime passed real PostgreSQL, Chromium, dependency and redacted history scans. The development runner uses pnpm 10.34.9.
- GitHub `rules/branches/main` returned an empty array (exit 0) and classic protection returned 404. The merge and release gate remains blocked.




## First anonymous survey workflow

- Source `838fa64abe0f4bebb515abe666434145304ad662` passed the exact local PostgreSQL, Chromium and export verification. See [the verification report](../evidence/ENG-007/838fa64abe0f4bebb515abe666434145304ad662.md) for commands, findings and remedies.
- Bootstrap GitHub docs-contract and runtime-required checks passed on draft PR #1. The survey draft stacks on that branch.

## Saved draft preview

- Chromium and direct PostgreSQL verification passed at `3f423e7fa94e23b09d3f74d4327c5dc4e49e0d7a`. See [the exact-SHA record](../evidence/ENG-006b/3f423e7fa94e23b09d3f74d4327c5dc4e49e0d7a.md).
- Draft PR #2 GitHub Actions passed for `58d8fc7fddcb1edb3821afd9fa39fc77b49101e3` across [runtime-required](https://github.com/NgohCH/HELPInsights/actions/runs/46008917842) and [docs-contract](https://github.com/NgohCH/HELPInsights/actions/runs/46008917660).

## ENG-008a curated template preview and copy

- Source commit `b494970fcde1e0bec0381a0e316359632fc1b8f5`. Fifteen real PostgreSQL integration tests, two security tests and three Chromium tests passed on the recorded tree. The scoped clone rollback regression and role denials passed. See the [exact-source evidence](../evidence/ENG-008a/b494970fcde1e0bec0381a0e316359632fc1b8f5.md).


## Preview and template integration

- Chromium first reproduced that Preview draft stayed disabled after cloning. The combined creator now keeps the clone response as its saved definition. The repaired browser test checks the copied question and option, return focus, and the private draft SQL record.
- `corepack.cmd pnpm test:stack` exited 0 in disposable Compose project `helpinsights-test-b440bff8f6c3`. Fifteen direct PostgreSQL integration, two security and four Chromium tests passed. The project volume was removed.

## ENG-009a operations development slice

- Tested revision `3bf00776434715cdf34d6c3673ff40ca5363e398` on isolated local PostgreSQL 16.16 and Chromium. The stack passed 14 integration, 2 security and 3 browser tests. See the [exact-SHA verification record](../evidence/ENG-009a/3bf00776434715cdf34d6c3673ff40ca5363e398.md).
- The integration reviewer examined the role boundary and persistence. The findings, fix, and remaining scope are recorded with the test evidence.

## Operations integration

- The combined survey, preview, template and operations stack passed 18 PostgreSQL integration, two security and five Chromium tests. The run verified the seeded 006 upgrade and restore, separate operations role, public survey roundtrip, and disposal of the uniquely labeled Compose project volume.
- `corepack.cmd pnpm test:stack` exited 0 in `helpinsights-test-116d5f3f5fc4`. The local transcript is `runtime-evidence/integration-operations.log`.

## ENG-014 Live Poll lobby slice

- Source revision [d1e5adcc4b09](../evidence/ENG-014/d1e5adcc4b09d8ecea6c880a1ee985a2a023b3ed.md) passed 13 real PostgreSQL integration tests, 2 security tests and 3 Chromium journeys. The live journey captured separate presenter and guest WebSocket frames and recovered the same state after PostgreSQL restarted.
- A disposable run at the source revision verified the 005-to-006 upgrade, an archive restore of the live room and guest records, and the disabled feature response. The release gate remains open.


## Live Poll lobby integration

- Preserved operations migration 006 and assigned lobby migration 007 in the combined development branch. Standalone candidate source and test evidence remain in the original worktree and draft.
- `corepack.cmd pnpm test:stack` exited 0 in `helpinsights-test-22cf96775bcc`. Twenty PostgreSQL integration, two security and six Chromium tests passed. Real presenter and guest lobby sockets, operations persistence, template copy and the survey/JASP roundtrip all ran in the same disposable stack.
## Searchable creator guide

- The PostgreSQL and Chromium suite passed at `476237eb03493f52a09b8a1ad6dff32266b4becb`. See [the verification record](../evidence/ENG-006c/476237eb03493f52a09b8a1ad6dff32266b4becb.md).
- Independent source review prompted two failing browser regressions for lost focus and malformed guide content. The corrected behavior passed both.

## Creator guide integration

- `corepack.cmd pnpm test:stack` exited 0 in `helpinsights-test-8cdfdb56e216`. Twenty PostgreSQL integration, two security and eight Chromium tests passed. The guide's asset recovery and keyboard focus tests ran with the survey, template, operations and Live Poll lobby paths.

## ENG-014b Live Poll host controls

- Source revision [be898f0ceea9](../evidence/ENG-014b/be898f0ceea991afef379b1c1cd8607bc7eb0c5b.md) passed 14 PostgreSQL integration, 2 security and 4 Chromium tests. PostgreSQL accepted one concurrent host transition at the same revision. Chromium confirmed two ongoing sockets and automatic guest recovery to the current revision.
- A seeded upgrade preserved a versioned lobby and its guest, and the archive restore retained a paused session. A connected guest whose capability expired received no newer frame after a committed transition. Scoring, 50-user contention, multi-instance fan-out and release approval remain open.

## Live Poll host control integration

- In the combined branch, migration 008 adds host controls after operations 006 and lobby 007.
- `corepack.cmd pnpm test:stack` exited 0 in `helpinsights-test-9dc6b5905854`. Twenty-one PostgreSQL integration, two security and nine Chromium tests passed. Presenter commands reached the open guest socket and an offline guest recovered current PostgreSQL state.

## ENG-008b workspace review for NPS authoring

- Source commit `cd071f2560308cb185def788b4b8a70c8da6a4d7`. Fifteen real PostgreSQL integrations, two security tests, and three Chromium tests passed. The migration preserved a seeded numeric survey, and the entitlement check denied draft and publication requests once approval expired. See the [exact-source evidence](../evidence/ENG-008b/cd071f2560308cb185def788b4b8a70c8da6a4d7.md).

## NPS approval integration

- Staged source tree df0bf3a814201ce47274d86b0dc2de02692444b8 passed lint, type checking, four unit tests and documentation validation.
- corepack.cmd pnpm test:stack exited 0 in helpinsights-test-ebf3e0cf3134. Twenty-five PostgreSQL integration, two security and ten Chromium tests passed. The test runner verified disposable volumes were removed.
- The combined branch loads NPS approval as migration 009. The approved 0–10 question uses the shared respondent and saved-preview renderer, which preserves the existing template copy and guide flows.

## ENG-010a closed-survey retention and hold guard

- Tested revision `c801b00963a0165c58e468a1723db950bd6dac3f` on isolated PostgreSQL 16.16 and Chromium. The stack passed 18 integration tests, 2 security tests, and 3 browser tests. See the [exact-SHA verification record](../evidence/ENG-010a/c801b00963a0165c58e468a1723db950bd6dac3f.md).
- Real PostgreSQL tests covered authorisation, stale snapshots, deadline and hold boundaries, seeded migration, and archive restore. Scheduled disposal and post-disposal restore replay remain separate acceptance scope.

## Retention integration and active development branches

- Cumulative tree 11d80dd5a630ea2504d8ac7b95310e5a7ab2edb8 includes migration 010. corepack.cmd pnpm test:stack exited 0 in helpinsights-test-85507d00f92d with 29 PostgreSQL integration, two security and ten Chromium tests. Closure stamped the database clock, hold approval and audit were scope-bound, the PostgreSQL archive preserved an active hold, and a stale repeatable-read disposal transaction was denied. The runner verified disposable cleanup.
- GitHub docs and runtime checks passed for retention holds, the read-only disposal preview and synthetic replay, synthetic Registry eligibility, and Live Poll voting. See draft PRs #10–13 and the status table for links.
- The PostgreSQL interruption branch reproduced a fatal 57P01 checked-out client error, then passed 12 PostgreSQL integration, two security and two Chromium tests after the fix. Draft PR #14 records the independent review and exact scope.

## ENG-014c Live Poll voting

- Voting source [95307681e932](../evidence/ENG-014c/164fb832037a2b440918c363e9e2b00a8d37ab25.md) passed 17 PostgreSQL integration, 2 security and 5 Chromium tests. One presenter stream and 50 simultaneous synthetic guests converged to 50 durable ballots with role-filtered snapshots. Closed result checks suppressed small option and nonvoter cells.
- A fresh targeted run on the conditional-admission guard added explicit 400 denial of versions with conditional questions. A seeded migration upgrade, PostgreSQL restore, app restart with same-key receipt, and revocation while a ballot waited on the room lock were observed. Scoring and the remaining release gates stay open.

## Cumulative worker, Live Poll voting and conditional workflow

- Exact source [4a1a20f7aa68](../evidence/ENG-INTEGRATION/4a1a20f7aa68d2d2c29b9c3d5b04a9e45a463f81.md) passed lint, types, four unit, 35 PostgreSQL integration, two security and 13 Chromium tests in helpinsights-test-14c78b66dce6, with verified cleanup. The branch uses migration 011 for voting and preserved the checksummed prior history.
- The exact cumulative stack proved stable template codes, private conditional draft preview, NPS authoring, database restart and JASP-ready export, worker pool recovery and 50-guest vote contention. Independent review confirmed stored-answer exclusion and noted that public survey definitions expose configured prompt text.
- Standalone case handoff, conditional visibility and synthetic consent drafts are PRs #15–17. See the status table for exact scope and review links. Main remains at 5d5e443d13328a07a71810cd90eb3a9785a3c902 both locally and on GitHub.

## ENG-010b disposal preview and fixture replay

- Tested revision `69d42925f30cf2d76b46a2a0fa22c1a617c0b95e` on isolated PostgreSQL 16.16 and Chromium. The stack passed 20 integration tests, 2 security tests and 3 browser tests. See the [exact-SHA verification record](../evidence/ENG-010b/69d42925f30cf2d76b46a2a0fa22c1a617c0b95e.md).
- The running API supplies a read-only preview. Cleanup, rollback, retries and stale snapshot replay were exercised in owned synthetic fixture databases.

## Cumulative lifecycle integration

- Exact source [179289716ac8](../evidence/ENG-010b/179289716ac8f434114e338252965069a75008f7.md) passed 38 PostgreSQL integration, two security and 13 Chromium tests in helpinsights-test-e42d471b89f5. Seeded migration 012 preserved the existing room and migration checksums. The red reproduced an incorrect eligible disposition and a real foreign-key failure. The fixed preview and fixture transaction protect the linked room, all survey derivatives and the tombstone ledger.
- The GitHub docs-contract and runtime-required checks passed on cumulative PR #18 and standalone worker recovery and Game Show PRs #19–20. The clean Windows installer demo passed standalone locally and is drafted in PR #21.

## ENG-015a private timed Game Show

- Source [0de928312a2f](../evidence/ENG-015a/0de928312a2fbef0a8fb8dd90ed6cd32cc0dc9c2.md) verified a private version-pinned fixed scoring rule on real PostgreSQL and recovered the same deadline and receipt over Chromium WebSockets. Full Docker passed 21 integration, 2 security and 6 Chromium tests. The scored archive, seeded upgrade and restart replay passed in the same disposable project.
- The source eligibility guard denied synthetic Registry and Research-consent bindings. Game Show remains opt-in. Results release, rankings, production approval and wider Game Show acceptance remain open.

## ENG-011a synthetic Registry eligibility

- Source commit `e4f63d9b2b24db853c4c08aaecd453e6f56f2687`. Fifteen PostgreSQL integration, two security, three Chromium and five unit tests passed. The Registry-adapter outage and recovery, direct SQL checks, seeded upgrade and absence of eligibility material in response rows passed. This is synthetic test-only and still requires unlinkable one-use collection for production. See the [exact-source evidence](../evidence/ENG-011a/e4f63d9b2b24db853c4c08aaecd453e6f56f2687.md).

## ENG-016a synthetic research consent

- Source commit `7534ff6591239a9ab013a33de17e643198cb386f`. Fifteen PostgreSQL integration, two security, three Chromium and four unit tests passed. Decline left no stored rows. The write-failure recovery stored the answer and separate opt-in atomically, and the seeded upgrade preserved open collection. [Exact-source evidence](../evidence/ENG-016a/7534ff6591239a9ab013a33de17e643198cb386f.md).

## Cumulative student-facing survey policy checks

- Source [2edb7592e419](../evidence/ENG-016a/2edb7592e419c784835df19edeccda79aa3a8511.md) passed 53 real PostgreSQL integration, two security, 16 Chromium and seven unit checks. The runner confirmed disposable cleanup. The exact evidence records failed mixed-policy tests, the SQL parameter-count regression and its repair, independent challenge, and the distinction between synthetic fixtures and the university's external eligibility and research process.
- The guided five-question after-class feedback draft passed GitHub docs and runtime checks in [PR #25](https://github.com/NgohCH/HELPInsights/pull/25). The cumulative disposal guard, private score release and recovery notices passed in PRs #22–24.

## ENG-006d guided after-class feedback

- Exact source `926b185a51e517cdef4845b3e02d13276b400724` passed 35 PostgreSQL integration, 2 security and 15 Chromium tests and confirmed the disposable Compose volume was removed. Keyboard authoring created a private five-question draft, an anonymous respondent submitted to the immutable version, and a concurrent draft edit blocked publication without creating a version or distribution. See the [verification report](../evidence/ENG-006d/926b185a51e517cdef4845b3e02d13276b400724.md).

## Cumulative guided student feedback

- Exact [source evidence](../evidence/ENG-006d/917b489926a779db91a5f43729626fc52092e47f.md) records 53 PostgreSQL integration, two security and 18 Chromium checks, independent review, and cleanup. GitHub docs and runtime passed on [PR #26](https://github.com/NgohCH/HELPInsights/pull/26).

## ENG-018b deployment checklist and ENG-004b delegated institutional OAuth

- Exact source `e55c2f5f7266b1d03d91fb4a92d4df7c871c0add` passed 15 unit, 53 real PostgreSQL integration, two security and 19 Chromium tests. The disposable runner removed its dedicated volume. The report records preflight, commands, test-driven repairs, independent challenges and target release gates. [Verification report](../evidence/ENG-018b/e55c2f5f7266b1d03d91fb4a92d4df7c871c0add.md).
