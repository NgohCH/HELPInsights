# Creator policy and integration acceptance

The scope is the research consent tool available in the disposable runtime, system-administrator integration management and Entra-backed tool grants. University research clearance and institutional acceptance remain external.

| Workflow | Expected result and failure signal |
| --- | --- |
| Creator policy and research publication | A public author gets 403 even with a user grant. A University owner or editor can publish when the tool policy allows it. Disabled, missing and revoked permissions deny new research publications while ordinary publication remains available. |
| Research browser and persistence | The available single-choice tool shows a consent control. An incompatible edit cannot silently publish open collection. An already published link retains its consent notice after grant revocation. PostgreSQL retains the separate opt-in without a response pointer. |
| Group-backed access | A signed claim for a mapped issuer and group applies only to the configured workspace. No claim, overage, expiry, stale or conflicting token timestamps and mapping removal deny or narrow scope. Fresh removal revokes authorization in prior sessions. |
| Client lifecycle | Only a University system administrator in the deployment may register, enable, change scope, renew or revoke. Pending, expired, replaced and revoked credentials fail. Scoped workload reads reveal only approved workspace and survey status fields. |
| Concurrent client updates | Registration retry with the same UUID creates one client and audit event. Concurrent renewal at the same credential version issues one real replacement. |
| Database upgrade and recovery | Upgrade a database seeded at 019. Current settings and the compatibility entry point return the same existing grants. Prior consent and audit persist. Archive and restore include tool and integration state. |
