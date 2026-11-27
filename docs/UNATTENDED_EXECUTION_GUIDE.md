> **v2.2 mandatory:** Follow `CONTINUOUS_TESTING.md`, `UNATTENDED_TEST_POLICY.md` and `CI_AND_BRANCH_PROTECTION.md`. The `runtime-required` workflow is intentionally fail-closed until `scripts/ci-runtime.sh` and the real app exist. Never describe documentation checks as runtime validation; do not skip or defer tests for a PR.

# Unattended Development Execution Guide — Codex Desktop + GitHub + Docker

**Status:** instructions and acceptance protocol, not proof of an installed runtime.

## Prerequisites and preflight

- Use a **dedicated, trusted developer machine** with Codex Desktop, Git, GitHub CLI and Docker Desktop/Engine running; Node/pnpm according to chosen pinned versions. Agent must have authorised local execution scope.
- Clone the GitHub repository, add this pack, create a worktree per independently owned module, require PR checks for protected branches.
- Verify remote and worktree `git status`, `git rev-parse HEAD`, `gh auth status`, `docker info`, `docker compose version`, registry pull for pinned images and basic DB readiness. Do not publish Docker daemon ports or mount Docker socket into public-facing containers.
- Use disposable local credentials, test-only fixture identities and isolated test volumes. Prod/staging systems and real recipients are outside unattended scope.
- If any prerequisite is absent, record the blocker and continue independent safe source/docs tasks. Never substitute mocked DB/API tests for runtime evidence.

## Recommended separated agent workstreams

1. **Core/domain** owns contracts, PostgreSQL migrations, tenant/privacy model, respondent runtime, eligibility.
2. **Creator UX** owns wizard, templates, drag/drop builder, contextual help, respondent accessibility.
3. **Operations/security** owns Docker, deployment doctor, admin action centre, security, retention, self-healing reports.
4. **Analytics/integrations** owns exports, sentiment, Person Registry and Ticketing simulator adapters, reporting, multichannel.
5. **Advanced/research** owns advanced logic, quiz/poll rules, experimental consent and labelled research exports; consume stable contracts only.
6. **Independent reviewer** owns adversarial review/evidence, not feature implementation.

Start with no more than 3–4 concurrent coding worktrees; one integration owner coordinates database schema and contracts. Agents may build all scope in parallel but cannot enable protected production capabilities without gates.

## Repeatable autonomous loop

1. Select next unblocked work package; identify data/permissions and failure impact.
2. Create dedicated branch/worktree, implementation+tests+docs, update API contract and migration.
3. Start isolated Compose stack; wait for ready DB; run migrations and seed fixtures.
4. Execute UI/browser, API, SQL assertions, edge cases, concurrency, privacy/tenant and applicable failure-injection tests.
5. Record test command, exit code, revision, environment, timestamps, failures, logs (sanitised), recovery and evidence path in `docs/EVIDENCE_LEDGER.md`.
6. Separate independent reviewer checks scope, attack surface, residual risks and recovery ability.
7. Fix boundedly; after three ineffective fix cycles, pause that PR for design assessment and work on safe independent tasks.
8. Open PR, rerun integration on the exact merge candidate, update `docs/BUILD_STATUS.md` and proceed to next unblocked work package.

## Required real journeys

- Wizard -> curated template -> questions/pages -> preview/readiness -> publish -> real respondent -> durable PostgreSQL -> analytics -> JASP CSV/codebook package.
- Quiz scoring, polls, branching, invitations, embed SSO handshake, simulated Person Registry resolution, simulated Ticketing case sync, offline safe sync, file upload security.
- Catalogue request -> admin approval -> entitlement change -> API authorisation; template cloning independent from master; contextual user-guide access.
- Self-healing incident -> bounded action -> functional verification -> durable admin report -> alert/acknowledge/escalation.
- Retention notice -> authorised archive -> expiry/hold checks -> verified disposal; backup restore/tombstones and audit.
- Installation on clean isolated host -> wizard/doctor -> configure DB -> first admin -> first survey -> backup/restore demonstration.

## Hard approval gates

Do not autonomously change production infra, permissions, DNS/WAF, secrets, real user data, billing, send live notifications, merge protected branches or deploy. Do not launch security tests against external providers. Request exact named authorisation with scope and rollback plan. Report `NEEDS_SPECIFIED_EVIDENCE` when tests not observed; do not claim a fully secured or attack-proof platform.

## Evidence fields

`work_package; branch; commit_sha; image_digest; docker_engine; db_version; migrations; fixture; command; exit_code; expected_and_observed; screenshot/log_location; permissions_and_privacy; fault_scenario; restoration; reviewer; residual_risk; approval_status`.

## Handoff at session end

Update `docs/BUILD_STATUS.md` truthfully and write a short `NEXT_ACTIONS.md` detailing the next unblocked task, owned worktree, blocked decisions, commands to rerun and expected evidence. A new agent should be able to continue without guessing.

## Live Quiz Arena Docker-backed unattended verification

The autonomous agent starts the web/API/worker/realtime/real PostgreSQL stack from a GitHub worktree, performs a lecturer-login fixture, publishes a quiz, starts a session, has 50 synthetic mobile participants join through live PIN/QR-derived flow, answers under varying concurrency and latency, advances/pauses/resumes/ends, verifies authoritative scores via direct SQL, checks privacy-safe leaderboard, exports results and tests retention. Force a presenter disconnect and a worker/realtime-process restart; require successful state snapshot recovery without duplicate score. Collect sanitized browser traces, command exit codes, image digests, commit SHA, query assertions and resulting incident notices. All synthetic identities, no live outbound messages, no real provider writes. Record whether horizontal scale was actually exercised; do not infer it from a single-container test.
