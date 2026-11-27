import { createHash, randomBytes, randomUUID } from "node:crypto";
import { surveyFixture } from "./survey.ts";

export function caseFixture(fixture = surveyFixture()) {
  const reviewer = randomUUID();
  const version = randomUUID();
  const otherVersion = randomUUID();
  const survey = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const rawFixture =
    "Synthetic confidential response must never leave collection";
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { sql, workspace, retentionPolicy } = fixture;
  sql(`
    INSERT INTO public.users (id, display_name) VALUES ('${reviewer}', 'Synthetic case reviewer');
    INSERT INTO public.sessions (token_hash, user_id, expires_at)
      VALUES (decode('${tokenHash}', 'hex'), '${reviewer}', now() + interval '1 hour');
    INSERT INTO public.workspace_memberships (workspace_id, user_id, role) VALUES ('${workspace}', '${reviewer}', 'viewer');
    INSERT INTO public.case_handoff_reviewers (workspace_id, user_id) VALUES ('${workspace}', '${reviewer}');
    INSERT INTO public.surveys (id, workspace_id, title, privacy_mode, status, retention_policy_id)
      VALUES ('${survey}', '${workspace}', 'Synthetic case triage', 'anonymous', 'published', '${retentionPolicy}');
    INSERT INTO public.survey_versions (id, survey_id, version, definition, hash) VALUES
      ('${version}', '${survey}', 1, '{}', repeat('0', 64)), ('${otherVersion}', '${survey}', 2, '{}', repeat('1', 64));
    INSERT INTO public.responses (survey_version_id, answers, retry_key_hash, payload_hash)
      VALUES ('${version}', '[{"questionId":"q","value":"${rawFixture}"}]', decode(repeat('0', 64), 'hex'), decode(repeat('1', 64), 'hex'));
  `);
  function basis(
    policy: "valid" | "expired" | "future" | "revoked" | "wrong_version",
  ) {
    const id = randomUUID();
    const cases = {
      valid: [
        "now() - interval '1 hour'",
        "now() + interval '1 hour'",
        "NULL",
        version,
      ],
      expired: [
        "now() - interval '2 hours'",
        "now() - interval '1 hour'",
        "NULL",
        version,
      ],
      future: [
        "now() + interval '1 hour'",
        "now() + interval '2 hours'",
        "NULL",
        version,
      ],
      revoked: [
        "now() - interval '1 hour'",
        "now() + interval '1 hour'",
        "now()",
        version,
      ],
      wrong_version: [
        "now() - interval '1 hour'",
        "now() + interval '1 hour'",
        "NULL",
        otherVersion,
      ],
    };
    const [approvedAt, expiresAt, revokedAt, scope] = cases[policy];
    sql(`
      INSERT INTO public.case_handoff_basis (id, workspace_id, survey_version_id, kind, approved_at, expires_at, revoked_at)
      VALUES ('${id}', '${workspace}', '${scope}', 'synthetic_fixture', ${approvedAt}, ${expiresAt}, ${revokedAt})
    `);
    return id;
  }
  const basisRef = basis("valid");
  const path =
    "/api/v1/surveys/" + survey + "/versions/" + version + "/case-handoffs";
  const approval = {
    reviewDecision: "approved",
    category: "campus_facilities",
    priority: "normal",
    consentOrLawfulBasisRef: basisRef,
  };
  return {
    ...fixture,
    reviewer,
    token,
    survey,
    version,
    otherVersion,
    rawFixture,
    basis,
    basisRef,
    path,
    approval,
  };
}
