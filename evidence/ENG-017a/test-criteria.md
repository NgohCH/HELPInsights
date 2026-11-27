# ENG-017a export-worker incident test criteria

Use the verified operations baseline and locally integrate the reviewed
checked-out PostgreSQL reconnect fix. Inject a fault only in an owned
labelled Compose test stack. No worker restart or external notification is
part of the handling.

- Seed an actual synthetic export job. Hold the export table long enough to
  observe the checked-out worker waiting in PostgreSQL. End only that worker
  database connection, then release the fixture lock.
- The same worker process completes the queued export. An operations
  operator sees one detected and one recovered event with an identical
  episode ID, fixed source and allowlisted values. SQL confirms a completed
  archive, observed timestamps and the absence of actor or response data.
- Record retries using the same episode ID are idempotent. The worker gets
  only the dedicated recording function, while the application role cannot
  call it or forge worker attribution in the manual incident route.
- Chromium opens the existing operations page and displays both events.
  An unauthorised workspace session receives no incident data.

Initial red is successful worker recovery with no worker incident visible
in the operations history. The feature is disabled in the default runtime.
