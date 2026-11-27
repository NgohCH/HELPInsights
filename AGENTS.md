# v2.3 mandatory unattended entry gate

Read `docs/PREFLIGHT_STOP_GATE.md`, `docs/EXECUTION_RUNBOOK.md`, `docs/CONTINUOUS_EXECUTION_CONTRACT.md` and `docs/APPROVAL_MATRIX.md` before beginning any unattended coding. The environment preflight must PASS and be reported first; otherwise STOP. Actual PostgreSQL and browser evidence is mandatory; do not defer checks. Earlier conflicting scheduling or permissions statements are subordinate to these safety and evidence rules.

## v2.2 authoritative execution rules (read before all historical appendices)
Read `SPEC.md`, `docs/DOMAIN_MODEL.md`, `docs/CONTINUOUS_TESTING.md`, `docs/TASK_GRAPH.md`, and `docs/CI_AND_BRANCH_PROTECTION.md` first. No tests are deferred. Write test criteria before implementation, run focused tests during each task, run real Docker/PostgreSQL tests per PR, independently challenge green evidence. No placeholder green status. On failure, fix before promoting ticket or record BLOCKED; after 3 repair/review cycles reassess. Documentation-only CI success is not implementation readiness. `SPEC.md` resolves conflicts with historical addenda. Never bypass an approval gate.

# AGENTS.md — instructions for Codex and local coding agents

Read `HANDOFF.md` then `INTENT.md`, `README.md`, `docs/AUTONOMOUS_BUILD_PLAN.md`, `docs/SMART_CREATION_WIZARD.md` and `docs/FEATURE_MATRIX.md` before editing. Implement the **entire integrated development scope**, with isolated branches and per-feature production gates. Latest instructions supersede earlier sequential development wording.

## Execute, do not merely plan

- Inspect repo state and current git commit; verify Docker Engine, image pull ability, isolated real PostgreSQL, Node toolchain and permissions. If unavailable report `BLOCKED_ENVIRONMENT` truthfully.
- Work via small branch/PR vertical slices, preserving stable contracts; do not alter others' source windows. Start with one successful survey create -> publish -> respond -> SQL assert -> chart -> JASP CSV export roundtrip.
- Keep `api/openapi.yaml`, README, actual tests, `docs/BUILD_STATUS.md` and `docs/EVIDENCE_LEDGER.md` synchronised.
- Implement guided wizard, expert builder, templates, feature requests, contextual user guide, analytics, admin control centre, self-healing reports, retention, security, modular Person Registry and Ticketing connectors, and advanced/research features.
- Run end-to-end UI, API and database checks, restore/upgrade exercises and focused security/failure tests on every relevant feature; never self-certify green CI as proof of correctness.
- Each coding change needs independent challenge: What could still fail, how would it be detected, contained and recovered?
- No real recipient SMS/email, production migrations, secret rotation, expenses, protected merges or production deployment without explicit approval.

See `docs/UNATTENDED_EXECUTION_GUIDE.md` for the agent-run loop and stopping conditions.

## Live Quiz Arena agent instructions

Treat `docs/LIVE_QUIZ_ARENA.md` and WP-053–056 as mandatory full-scope work. Run presenter and participant Playwright journeys against a real local websocket/realtime transport and PostgreSQL database. Do not conflate a mock websocket, UI animation or HTTP 200 with a working live quiz. Keep realtime transport and scoring isolated from ordinary survey collection; retain proof of multi-user concurrency, restart/reconnect, privacy and correct persistence. Never use live class rosters or contact real students during autonomous tests.
