# ENG-007b PostgreSQL interruption recovery

The inherited Live Quiz PostgreSQL restart exposed an unhandled checked-out PostgreSQL client error that terminated the export worker. An independent registry run also observed a dropped connection; its cause is unconfirmed.

- Use a fresh isolated PostgreSQL test database and the application's non-superuser role. Terminate only the connection that the test deliberately checked out inside a transaction.
- Force the connection loss after one query completes and before the next query starts. The Node process must survive, the transaction promise must reject and the pool must serve a new authenticated request.
- Put application and export worker transactions through the same lifecycle. A disconnected pool client must be discarded. Ordinary rollback and commit behavior must continue.
- Run the complete Docker integration, Chromium and export recovery suite. Review ownership of the client error listener and pool release on every path.
