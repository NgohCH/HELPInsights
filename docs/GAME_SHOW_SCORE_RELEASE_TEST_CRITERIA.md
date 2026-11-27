# ENG-015b Game Show private score release tests

- An authenticated presenter releases scores once, only after ending an eligible Game Show room, through the current optimistic revision. Unauthorized, stale, early and repeated releases change no release state. Concurrent requests yield one authorized release.
- A valid guest sees no score until release. The result includes only their own points and forbids browser caching. Missing, foreign and expired credentials disclose no result or existence. A valid guest without a recorded attempt receives no score. Presenter and guest WebSockets carry no private results. Only the presenter sees release status.
- PostgreSQL stores the release instant separately from the deadline and original scoring attempts. Policy eligibility checks remain active. PostgreSQL upgrade, archive and app restart preserve released state, with deadlines and attempt receipts unchanged.
- Chromium observes the presenter action and a separate mobile guest's own score after reconnect. Public rankings and assessment identity stay outside this slice.
