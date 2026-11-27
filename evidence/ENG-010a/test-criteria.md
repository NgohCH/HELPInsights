# ENG-010a test criteria

Use the verified survey and operations base. The scope is close-based
workspace expiry, authorised workspace hold approval, and a database guard for
core survey records. A scheduled disposal worker and tombstone replay are
remaining retention acceptance scope.

- Close a published survey with a workspace policy and confirm it receives
  a persisted expiry and the existing close response. Check the exact
  clock boundary and the ordinary hold-free expiry state.
- Workspace members can see the deadline and disposition without audit data.
  A creator alone and an operations-only actor cannot place a hold. An actor
  in a different workspace cannot enumerate the survey. An explicitly
  appointed workspace approver can approve a time-limited hold, including
  a reason code and an opaque evidence reference. Reject malformed/past time
  and duplicate evidence. Confirm SQL stores the verified approver.
- In a labelled, uniquely owned disposable Compose database only, attempt
  deletion before expiry and during an active hold. Expect PostgreSQL to
  reject core survey, version and response deletes and retain the actual
  response. Observe clock boundaries using a database-only query. Run any
  destructive SQL as a transaction that ends in rollback.
- Prove that a pending disposal transaction with an older repeatable-read
  snapshot waits for a concurrent hold and fails closed after approval commits.
- Exercise concurrent modifications to workspace membership and delegated
  authority while approval is uncommitted. Both follow a clear lock order.
- Upgrade prior schema with seeded closed surveys and confirm existing
  deadlines are preserved and missing deadlines block disposal.
- Restore an isolated PostgreSQL archive to a unique database. Confirm the
  active hold and underlying response are still present and still protected.
- Run the existing browser survey regression. This API slice adds no UI.

The initial red signal is HTTP 404 for the unimplemented retention read
and approval paths.
