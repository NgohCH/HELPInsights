# Live Poll retention and disposal boundary

The cumulative branch combines read-only retention disposal preview with Live Poll rooms pinned to published versions. Until live derivatives have an approved deletion policy, a survey linked to any Live Poll room must remain protected.

- Use a labeled disposable PostgreSQL project and owned archive fixture databases. Seed an expired closed survey without a hold and with a version referenced by a real live-session row.
- The appointed reviewer receives a redacted `live_session_present` disposition. Other roles receive the existing scope denials.
- The fixture-only disposal transaction returns the same protection outcome before deleting derivatives. Survey, version, response, export and live session remain. No tombstone is created.
- An expired closed survey with no live room still passes the existing owned-fixture disposal and stale-restoration replay scenarios. Existing hold, future, active export, rollback and duplicate safeguards stay in the required suite.
- Keep runtime preview read-only. The safe-fixture SQL remains outside runtime images.
