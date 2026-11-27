# ENG-009a test criteria

ENG-002 and ENG-003 provide the disposable stack and scoped session behavior.
This slice owns a separate platform operations role, the operations routes and
a read-only browser view. The role carries no workspace permissions.

1. A valid ordinary workspace session receives 403 on all operations routes.
   An absent session receives 401. An operations viewer can read health/history
   and receives 403 on incident writes. An operator without a workspace sees
   an empty workspace list and cannot access an existing author's survey.
2. Recording an event accepts only fixed component, state and severity codes.
   An extra answer field or arbitrary category receives 400 without writing a
   row. The API returns an identifier, the fixed codes and server time only.
   SQL checks the authenticated actor recorded in the same append-only row.
3. With the application database role, a viewer's direct write fails and an
   operator cannot update or delete an event. Restart PostgreSQL and the app
   and verify the same persisted incident via SQL and the authenticated API.
4. Chromium opens the operations UI against the real stack, checks a denied
   user and verifies an operator can read redacted health and history.

Expected initial failures are missing routes and a missing operations page.
Verify API contract, direct database assertions and Chromium in the same
disposable stack. Include a review of RLS, actor attribution and output fields.
