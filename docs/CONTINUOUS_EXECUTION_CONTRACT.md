# No-deferral continuous validation contract

- Unit tests and static checks after each meaningful code change.
- Relevant integration tests against live ephemeral PostgreSQL before ticket closure.
- Relevant browser tests on a running stack, including owner/admin/respondent paths.
- Negative tests for tenant isolation, permissions, anonymous identity leakage, malformed input, file upload, deduplication and retention when affected.
- Runtime CI on every PR; branch protection requires exact named checks. A scheduled broader suite is supplementary, never a reason to defer relevant PR tests.
- Self-healing scenarios record detection, automated action, verification, incident entry and notice routing; restart alone is not proof of recovery.
- API contracts and generated types change atomically; schema migrations are forward-tested on seeded data and rollback limitations documented.
- Failure must BLOCK merging the changed scope; agents can repair within authorised local windows but cannot weaken, skip or delete checks.
- Status taxonomy: NOT_STARTED, IMPLEMENTED_UNVERIFIED, VERIFIED_LOCAL, VERIFIED_INTEGRATION, REVIEWED, RELEASE_APPROVED, BLOCKED.
- Evidence names exact SHA, versions, commands and results. Claims like 'all tests passed' without evidence are rejected.
