import { createHash, randomBytes, randomUUID } from "node:crypto";
import { surveyFixture } from "./survey.ts";

export function featureFixture() {
  const fixture = surveyFixture();
  const reviewer = randomUUID();
  const reviewerToken = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(reviewerToken).digest("hex");
  fixture.sql(`
    INSERT INTO public.users (id, display_name) VALUES ('${reviewer}', 'Synthetic reviewer');
    INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
      VALUES ('${fixture.workspace}', '${reviewer}', 'viewer');
    INSERT INTO public.sessions (token_hash, user_id, expires_at)
      VALUES (decode('${hash}', 'hex'), '${reviewer}', now() + interval '1 hour');
  `);
  const delegate = () =>
    fixture.sql(`
    INSERT INTO public.feature_reviewers (workspace_id, user_id)
      VALUES ('${fixture.workspace}', '${reviewer}');
  `);
  return { ...fixture, reviewer, reviewerToken, delegate };
}
