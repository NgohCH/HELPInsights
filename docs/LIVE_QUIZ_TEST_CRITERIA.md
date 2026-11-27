# ENG-014 Live Poll lobby test criteria

- A workspace owner can open a lobby from a published immutable choice version. Unauthenticated and cross-tenant actors cannot open it.
- Valid PIN admission returns a room-scoped capability. Invalid and expired PINs yield the same denial. SQL confirms the published version and guest were persisted without cleartext credentials.
- Presenter and participant Chromium sessions observe a live WebSocket snapshot from PostgreSQL and retrieve the same state after restarting PostgreSQL. The integration suite also restarts the app and reconnects both roles at its current loopback address.
- Remaining release gates include presenter transitions, scoring, realtime broadcast, endorsed modes, load, recovery and production approval.
