# ENG-003b interactive University sign-in

A browser initiates a tenant-specific OpenID Connect authorization code flow with state, nonce and S256 PKCE. After identity verification an explicitly bound local account receives a short-lived HTTP-only session. Existing workspace memberships decide authorization. No automatic provisioning or role assignment from identity claims.

- Test the start and callback at the HTTP boundary. A different browser, mismatched state, provider failure, expired attempt or a reused attempt must receive no new session.
- Verify the signed identity token for the configured issuer, tenant, browser client audience and nonce, and reject an unbound principal.
- Run a Chromium journey with a synthetic identity provider and disposable PostgreSQL. A bound workspace owner can create and publish. A bound viewer in the same workspace is denied both operations. An anonymous browser can still respond to the public survey.
- Verify that sign-out revokes the application session and that deleting a local binding disables its sessions.
- Validate live conditional access and MFA later using an approved University test application and test accounts. The synthetic provider cannot evidence those policies.
