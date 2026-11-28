# ENG-003c University sign-in for administration

Reuse the University browser session and PostgreSQL platform operations memberships. The admin sign-in round trip returns to a fixed local `/admin` destination. The server remains the authorisation boundary for the read-only console and for incident writes.

- An operations viewer can sign in at `/admin` and read service health and redacted incidents without entering a development token.
- A bound University account with a workspace authoring role alone receives 403 from the operations API and sees no operations data. An operations viewer cannot write incidents.
- Sign-out clears the visible console and revokes the cookie session. The guest view exposes the sign-in entry point when enabled and the existing development form where enabled.
- The callback keeps the destination selected at sign-in. External or unsupported destinations fall back to the creator home page.
- Verify the HTTP contract, real PostgreSQL authorization, Chromium, the full regression suite and independent review. Live Entra MFA remains a University acceptance gate.
