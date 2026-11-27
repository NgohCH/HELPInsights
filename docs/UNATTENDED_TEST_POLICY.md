# Unattended testing and escalation

Codex may continuously implement and test on a **trusted isolated workstation/runner** with disposable data. It must not claim background execution from a chat session; configure actual local automation or GitHub Actions for recurring work.

Cycle: select unblocked ticket -> prewrite tests -> implement -> run focused tests -> run entire relevant suite -> Docker+Postgres E2E -> independent challenge -> collect evidence -> PR. Agent can attempt bounded safe fixes; after three unsuccessful review/fix cycles stop the affected PR and escalate with logs and diagnosis. No bypass on security and persistence tests. Continue only disjoint independent tasks.

Notify admins on CI failure, recurring test flakiness, DB migration conflict, vulnerability, failed backup, anomalous traffic and recovery action. Logs must be redacted and avoid student/research content and access tokens. Notify with issue severity, revision, environment, exact failed check, impact, attempted recovery, current state and proposed action. Do not send credentials through notification channels.

Protected changes requiring human approval: production merges/releases, live registry/ticketing writes, credentials, cost, destructive or production migrations, emergency firewall policy and disabling mandatory security controls.

Completion report: modules implemented vs design-only, level L0 specified / L1 implemented / L2 real-DB integrated / L3 resilient / L4 release-ready / L5 production verified, exact evidence and risk-aware release decision. A passing test at L1 never silently becomes L4.
