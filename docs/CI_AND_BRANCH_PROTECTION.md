# CI, branch protection and trusted runners

Two workflow types are intentionally separate:
- `.github/workflows/docs-contract.yml` **runs now** against this documentation package and validates links, specification presence, YAML and manifest consistency. Passing means only that *documentation* is structurally healthy.
- `.github/workflows/runtime-required.yml` is an intentionally **fail-closed application gate** until a genuine runtime contract exists: root `package.json`, scripts `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `test:security`, root `compose.yaml`, and `scripts/ci-runtime.sh`. The gate runs the runtime script and must fail if it is absent. Build these in ENG-001–ENG-005; never replace this with an echo/placeholder pass.

In GitHub repository settings enable branch protection/rulesets on `main`: require pull requests, independent review for sensitive changes, up-to-date required checks `docs-contract` and `runtime-required`; disallow force pushes and direct pushes; require code-owner approval for contracts, auth, data, deployment and CI; do not allow admins to bypass without authorised emergency procedure. Branch rules must be configured in GitHub by an authorised maintainer: having workflow YAML does not itself turn them on.

Every PR runs tests against isolated temporary services and a disposable Postgres database; root runtime script must construct/teardown the stack, run migrations, execute API/browser/security/SQL assertions and persist logs on failure. No GitHub secrets, production credentials or privileged Docker socket to untrusted PRs. Use GitHub-hosted runner initially; privileged self-hosted Docker runner only for trusted branches with restricted access. External services (Person Registry/Ticketing/SMS) use local simulators in CI and separate authorised provider probes.

Never mark `runtime-required` optional or rewrite its exit status to green. Document actual observations in `docs/EVIDENCE_LEDGER.md`. PR status must distinguish SKIPPED, BLOCKED and PASS. Reject `continue-on-error` on required checks. Retain coverage and artifact output but do not mistake a high percentage for security proof.
