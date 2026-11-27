# ENG-018a local install and doctor criteria

The scope is a first-run development demonstration from the verified survey and PostgreSQL baseline. The first workspace owner and session are synthetic fixtures in a disposable environment.

- The local doctor reports deterministic toolchain, local Docker, Compose and Chromium checks. Unsafe Docker endpoints or missing prerequisites return a nonzero status without disclosing endpoint values, credentials or environment contents.
- The install demo checks the host before making changes, installs the locked dependencies and Chromium, then invokes the repository's existing disposable Docker verification runner. A failed stage returns nonzero and emits no success receipt.
- The existing Chromium survey journey uses a synthetic workspace owner and development session, then creates, publishes and responds to a survey. PostgreSQL assertions survive restart and the browser verifies the JASP export. The existing cleanup confirms removal of the unique test volume.
- A successful command emits a redacted receipt with exact checkout revision and verified runtime versions. The receipt distinguishes the disposable demonstration from an installed service. Ordinary test and CI entry points retain their behavior.
- No live administrator, production credentials, DNS/TLS provisioning, release signing, bootstrap MFA or SSO, production planning, or deployment state changes are in scope.
