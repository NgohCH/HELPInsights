# ENG-014c Live Poll voting tests

- A presenter advances through immutable published questions in order. Guests only see the active question. A ballot requires the open question ID and its opening revision. Paused, ended and stale ballots are rejected.
- A room-scoped guest casts one vote per question. Same-key same-payload retries receive the original receipt. Answer/key conflicts, foreign membership and invalid choices add no row. Live votes never enter survey responses.
- The presenter sees live turnout in five-vote cohorts. Closing the question can release exact totals if category and non-voter complements meet the minimum cell size. A guest sees only their own voted flag. Chromium must observe the question and vote receipt changes through the existing WebSocket connections.
- Fifty distinct synthetic guest capabilities connect to the same real local WebSocket room, cast concurrent ballots and converge with SQL totals and one presenter stream. Record the test limits. Scoring and question deadlines remain open.
