# Report by survey publication

ENG-007c depends on the authorized reporting and immutable versions implemented by ENG-004 and ENG-007. Reopened survey details reuse the report and export controls. The analytics route and OpenAPI contract gain an optional publication UUID. No migration is necessary.

- An owner or analyst can choose an earlier publication, view privacy-filtered results and export the exact version through the existing worker.
- Changing selection clears the stale report and download action. The newest publication remains selected on opening.
- A request without a publication UUID retains the existing newest-version contract. Invalid UUIDs return 400. Valid UUIDs outside the selected survey return 404. Unauthorized requests cannot see the data.
- The real runtime test publishes two immutable versions, persists different synthetic answers and closes the survey. SQL confirms exact counts. Chromium checks the reported versions, small-cell suppression and the downloaded older-version CSV. Independent review challenges version scoping and concurrent UI behavior.
