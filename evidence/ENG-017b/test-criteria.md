# ENG-017b worker recovery inbox test criteria

The inbox projects existing redacted recovery episodes. Only appointed
platform operators can read or acknowledge a notice. Each operator owns
a separate immutable receipt. The scope is opt-in test recording and
in-app visibility with no delivery channel.

- A recovery event produces one fixed notice. The paired detection and a
  manually recorded recovery are excluded. GET and POST reject absent
  credentials, viewers and ordinary workspace actors.
- Acknowledging one notice twice concurrently returns the same timestamp.
  SQL shows one receipt bound to the verified operator. A second operator
  still sees an open notice, and cannot read the first operator's receipt
  under the application role. Reject unknown, detection and manual IDs.
- Chromium shows the inbox only after operator authentication. Acknowledge
  the selected recovery and verify the status survives page reload. The
  existing incident history grants no additional rights.
- The default configuration does not expose either inbox route or
  acknowledgement. All data and role membership are synthetic.

Expected baseline red is HTTP 404 for the inbox and a missing browser
notice region. Use the labeled disposable local PostgreSQL stack.
