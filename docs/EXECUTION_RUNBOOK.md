# Unattended Codex execution runbook (v2.3)

## Invocation and authority

1. Open this repository in Codex Desktop on the machine that hosts Docker. Verify the repository remote with the operator; do not invent a URL.
2. Read `AGENTS.md`, `SPEC.md`, `HANDOFF.md`, `docs/TASK_GRAPH.md`, `docs/CONTINUOUS_TESTING.md`, `docs/PREFLIGHT_STOP_GATE.md`, and `docs/APPROVAL_MATRIX.md`.
3. **Preflight first, then STOP if incomplete.** Show the completed checklist before declaring readiness. This is mandatory even if earlier Docker observations were positive.
4. Start ENG-001/ENG-002 only when the preflight gate passes and local dev authority is confirmed. Preserve a clean baseline.
5. Translate each ENG ticket into a small PR with: objective, prerequisite, owned files, test first, runtime path, negative security tests, recovery, acceptance evidence, reviewer.
6. No unattended task may mark COMPLETE while an applicable test is skipped, failing or unevidenced; run tests continuously per file/commit/PR (not deferred). New failures cause repair or a scoped block.
7. After at most three failed review/fix rounds, stop the affected ticket for reassessment. Continue unrelated independent work only if its dependencies stay sound.
8. A fresh independent reviewer assesses exact SHA, DB isolation and API changes. CI green alone is insufficient.
9. Agents may push authorised branches and create draft PRs. Protected merges, live integration configuration, cloud spend, production deployments, destructive non-test operations remain human-gated.

## Product scope

Unified build covers everyday surveys, Project Listen, multi-page wizard, templates, feature requests, drag-drop, SSO/token validation, Registry adapter, future Ticketing adapter, analytics/JASP-friendly exports, Live Quiz Arena, advanced questions/logic, offline/kiosk, invitation channels, research/consent/psychometrics, retention, admin/action notices, security and self-healing. Stage 1/1B retains first production priority; feature availability in production is controlled by separate release gates.

## Continuous evidence loop

Write `evidence/<ENG-ID>/<sha>.md` containing runner/os, commands, observed outputs, SQL assertions, browser evidence, negative cases, privacy findings, review conclusion, rollback and unknowns. No placeholders for success. Update `docs/BUILD_STATUS.md` honestly. Every real bug gets a red test that passes after repair.

## First functional vertical slice

Create survey in browser -> save version in PostgreSQL -> publish -> submit -> verify SQL row and idempotency -> view permissions-aware chart -> download JASP-compatible CSV/codebook -> restart services -> verify durable data. This workflow is required before scaling parallel work.

## Preventing false positives

`docs-contract.yml` is documentation-only. `runtime-required.yml` must fail closed until a real application, Compose stack and `scripts/ci-runtime.sh` exist. Never disable or mock the runtime check to get a green badge. `scripts/test-postgres.*` is infrastructure-only and does **not** qualify as a survey application test.
