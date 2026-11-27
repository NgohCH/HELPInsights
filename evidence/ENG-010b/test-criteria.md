# ENG-010b test criteria

Start from the verified ENG-010a retention baseline. Develop a read-only
preview and a redacted tombstone schema. Destructive execution and replay
remain inside the disposable test fixtures and are absent from runtime images.

- An explicitly appointed workspace retention reviewer can preview eligible,
  held, scheduled and pending-export states. The preview has no write method,
  no response content and no public or cross-workspace access. An ordinary
  owner without the appointment cannot preview disposal.
- The test-only executor accepts an exact Compose project, random fixture
  database, marker and bound survey. Deny a wrong target or marker. The
  test harness verifies local Docker labels and creates its own databases.
- The executor leaves held, not-yet-expired and queued-export records intact.
  For an eligible survey, erase the response, version, distribution, export
  job and download audit in one transaction. Inject a failure after derivative
  deletion and verify all rows and the absence of a tombstone after rollback.
- Record one redacted tombstone with stable scope and time. Repeated execution
  returns the same record. Verify app and worker roles have no write grant.
- Restore the preceding snapshot to a separately named fixture database.
  Replay the tombstone before connecting any application. Reject workspace
  mismatch and confirm the old content and archive are gone.

Expected baseline red is a missing preview endpoint and tombstone table.
Run existing Chromium operations and survey journeys against the real stack.
