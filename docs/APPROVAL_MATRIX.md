# Autonomous permissions and human gates

| Action | Unattended allowed? | Requirements |
|---|---|---|
| Read/modify isolated local code | Yes | Assigned task/branch, no overlap |
| Run unit/integration/E2E tests on synthetic data | Yes | Isolated environment; bound resource use |
| Pull public approved Docker images | Yes after environment approval | Pin digest in production builds; scan images |
| Create/drop uniquely named disposable test Compose volumes | Yes after environment approval | Never touch pre-existing volumes |
| Push feature branch / draft PR | Yes if authorised | No secrets, evidence included |
| Merge protected branch | No | Human decision, required checks/review |
| GitHub repository creation, permissions or branch rules | No | Explicit human authority |
| Production/staging migration or restore | No | Explicit change approval and recovery plan |
| Real Person Registry/Ticketing/Entra/SMS/email write | No | Explicit permission, privacy review and credentials |
| Security scanning against systems outside isolated test scope | No | System owner approval |
| Release application/enable research modes | No | Release owner and governance sign-off |
| AI-generated production code patch deployment | No | Independent verification and release approval |

Never treat silence, previous approval for a different project, or a successful mock as permission for new external actions.
