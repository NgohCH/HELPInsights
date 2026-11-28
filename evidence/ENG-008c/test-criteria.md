# ENG-008c administrator tool approvals

Use template copying as the first controlled tool. A University session with an explicit system-administrator assignment can choose off, all eligible creators, University creators, or named approval. In named mode, scope individual and group grants to a workspace. Use existing workspace edit authority and trusted memberships. Template preview remains a separate read operation.

- Direct settings API calls require a live University session and explicit system administrator authority. Operations access and creator authority alone are insufficient.
- The settings page updates the mode and adds or revokes individual and group approval. Record the actor and change in PostgreSQL.
- Template cloning checks the mode at the API, plus workspace authority. A grant only applies to its workspace. Removing the grant or group membership blocks future cloning. Existing drafts and normal public collection are unaffected.
- Verify the allowed and denied browser journeys against disposable PostgreSQL and the synthetic identity provider. Live group import, additional tool gates, and integration management are separate work.
