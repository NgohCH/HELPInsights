# ENG-004b institutional OAuth API foundation

- With explicit issuer, one exact API audience, delegated scope and approved RSA public keys configured, verify signed JWT claims before resolving an issuer and subject to an existing local principal.
- Reject configuration drift, invalid issuer or audience type, invalid signature, invalid lifetimes, absent delegated scope and unknown or revoked bindings. Claims about groups and roles confer no local membership.
- Restrict the credential to GET /api/v1/me and /workspaces. Preserve opaque sessions and anonymous respondent or existing authoring routes.
- Verify the local binding and PostgreSQL workspace isolation from Chromium using only generated synthetic credentials and disposable test data. Keep broader sign-in and MFA assurance, Entra onboarding and production key rotation open.
