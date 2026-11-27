# ENG-014b Live Poll host control tests

- Only the host of a room can change its state. A foreign creator and a guest receive 403. A missing credential receives 401. Wrong state and stale revision receive 409 without changing the persisted revision.
- Starting a lobby twice concurrently at the same revision yields one success. The states start, pause, resume, end and archive create a monotonic revision sequence. Fresh PIN joins are limited to the lobby while admitted guests can resume with their existing capability.
- A presenter and mobile guest see start on the same WebSocket connections that delivered their lobby snapshots. While the guest is offline, the presenter pauses. The guest reconnects automatically and receives the current durable snapshot. SQL checks state, revision, original version and guest count.
- Upgrade and restore preserve existing lobby data. Scoring, question progression, load acceptance for 50 simultaneous respondents, multi-instance fan-out and release approval remain open.
