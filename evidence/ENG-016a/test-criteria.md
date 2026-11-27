# ENG-016a synthetic consent acceptance

This slice depends on the verified authoring and anonymous response journey at `58d8fc7`. It covers one fixed synthetic study notice on deliberately opted-in, published, anonymous single-choice surveys. The feature is disabled outside the isolated test runtime. No real identities, sensitive answers, or research assignment are used.

- A permitted workspace author can publish an opted-in test survey. Each published distribution retains its own immutable notice ID and revision. Older open links keep their existing behavior.
- A respondent sees the exact notice before the questions. Declining leaves neither answers nor an opt-in event. Omitted, declined and mismatched consent are rejected by the server before accepting any answers.
- A valid affirmative submission and its same-key retry create one anonymous response and one separate positive consent row. The row carries no response pointer, answer, account, credential, or per-person identifier. A write failure to the consent ledger rolls back the response.
- The existing database submission helper also rejects new writes on consent-gated distributions when it lacks the guarded consent context. No application role can update a published notice or read the consent ledger.
- Chromium exercises decline and explicit keyboard opt-in in a mobile viewport. Real PostgreSQL checks verify the published versions, rejection, concurrent retry, event/response separation and rollback. Ordinary survey tests remain green.
- Study authoring, approved academic governance and retention, assignment and randomisation, withdrawal, longitudinal linking, research scoring and exports, and production activation remain open.
