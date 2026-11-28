# Connected creator workspace acceptance

| Workflow | Acceptance evidence |
| --- | --- |
| Live delivery | University owner signs in through the synthetic provider, publishes an unconditional single-choice survey and opens both presenter modes without supplying raw credentials or an ID. A guest joins over WebSocket and submits a vote by HTTP. The host receives live room state over WebSocket. PostgreSQL confirms the room is bound to the published version. A cross-origin creation request returns 403. |
| University publication | A workspace owner selects the exact approved policy version. Other workspace policies are absent. Withdrawal cannot create an unrestricted link. An eligible synthetic identity can sign in and respond, and an ineligible identity cannot read or submit. |
| Retention | Any permitted workspace member can read the summary. Only an appointed approver can preview disposal and add a hold. A foreign workspace is denied. PostgreSQL confirms attribution, expiry and preservation of the anonymous response. |
| Saved surveys | A creator can find an existing survey in the workspace list, preview a saved draft, and see published history and results where entitled. Saved updates use the observed ETag and preserve the full question structure and stable identifiers. |
