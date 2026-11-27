# ENG-012a synthetic case handoff test criteria

This is a manually approved, synthetic outbox slice on the verified survey
and operations baseline. It has no sender, provider credentials or automatic
ticket creation.

- A scoped reviewer explicitly approves an allowlisted category and priority.
  An active synthetic basis must match the workspace and exact published
  survey version in PostgreSQL. Missing, expired, future, revoked, mismatched
  and out-of-scope requests fail without queueing. A workspace owner alone
  cannot act as reviewer.
- Reject arbitrary text, response identifiers, unsupported fields and a
  missing approval. Store a generated standard summary and a verified actor
  audit field. Event output contains no actor or respondent identifier,
  token, answer or free text.
- Two concurrent requests with the same key and payload yield one committed
  event and the same receipt. Reusing the key with different fields yields
  a conflict. Verify durable attribution from a separate SQL connection.
- Chromium opens test-only triage, makes approval explicit and shows the
  redacted event receipt without raw feedback. A normal-mode runtime must
  reject the page and endpoint.

Expected red is the missing route and page. Use only synthetic data in
uniquely labelled disposable local Docker/PostgreSQL.
