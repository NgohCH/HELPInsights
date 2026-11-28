# ENG-011b department eligibility

An authorised creator can publish to a University audience by selecting one approved policy version in the survey's workspace. The first slice uses centrally issued, time-limited institutional eligibility grants. A department can own multiple policy versions and membership populations. Live source ingestion, policy administration UI and authoring selection UI are separate work.

- Unauthenticated callers see only a University sign-in prompt. Sign-in returns to the same fixed-format survey path. A valid browser session without the selected grant receives a denial. Public surveys do not require sign-in.
- A restricted distribution binds exactly one policy version. Reject unapproved, withdrawn, missing or out-of-workspace policies. PostgreSQL rejects restricted submissions through the legacy public and synthetic Registry write path.
- A valid, time-limited grant opens and submits to its distribution. Expiry, revocation, binding loss or a different approved policy prevents collection. Anonymous responses omit user and eligibility identifiers.
- Exercise the publishing API, disposable PostgreSQL and Chromium with synthetic institutional identities, and preserve public, Registry, research and Live Quiz regressions.
