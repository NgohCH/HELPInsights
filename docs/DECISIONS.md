# Architecture decisions / decision register

| ADR | Decision | Status |
|---|---|---|
| ADR-001 | Modular monolith, documented boundaries and independent adapters | Proposed baseline |
| ADR-002 | PostgreSQL with tenant context, RLS and direct isolation tests | Proposed baseline |
| ADR-003 | Immutable published questionnaire versions | Proposed baseline |
| ADR-004 | Client/server-shared safe logic AST; no dynamic eval | Proposed baseline |
| ADR-005 | Privacy modes + separate eligibility and answer data stores | Proposed baseline |
| ADR-006 | Transactional outbox, idempotency and eventual consistency | Proposed baseline |
| ADR-007 | Realtime quiz server authoritative, deterministic state machine | Proposed baseline |
| ADR-008 | Retention, holds, audit minimisation and backup tombstones | Proposed baseline |
| ADR-009 | Bounded recovery with incident reports; no uncontrolled self-patching | Proposed baseline |
| ADR-010 | GitHub + Docker/Postgres runtime verification, never source-only | Proposed baseline |

For each accepted ADR create `docs/adr/ADR-NNN-title.md` recording context, alternatives, reasons, failure modes, migration effects, owner and date. No guessed owners or approvals. Review architectural changes before altering shared contracts.
