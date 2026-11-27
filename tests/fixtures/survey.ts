import { createHash, randomBytes, randomUUID } from "node:crypto";
import { runningTestStack } from "../../scripts/test-docker.ts";

export function surveyFixture() {
  const stack = runningTestStack();
  const sql = (statement: string) =>
    stack
      .compose(
        "exec",
        "-T",
        "postgres",
        "psql",
        "-XAtq",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "helpinsights",
        "-d",
        "helpinsights",
        "-c",
        statement,
      )
      .trim();
  const workspace = randomUUID();
  const outside = randomUUID();
  const retentionPolicy = randomUUID();
  const owner = randomUUID();
  const visitor = randomUUID();
  const organisation = randomUUID();
  const otherOrganisation = randomUUID();
  const ownerToken = randomBytes(32).toString("base64url");
  const outsiderToken = randomBytes(32).toString("base64url");
  const hash = (token: string) =>
    createHash("sha256").update(token).digest("hex");
  sql(`
    INSERT INTO public.organisations (id, name) VALUES
      ('${organisation}', 'Synthetic survey organisation'), ('${otherOrganisation}', 'Other organisation');
    INSERT INTO public.workspaces (id, organisation_id, name) VALUES
      ('${workspace}', '${organisation}', 'Survey workshop'), ('${outside}', '${otherOrganisation}', 'Outside workspace');
    INSERT INTO public.users (id, display_name) VALUES
      ('${owner}', 'Workshop creator'), ('${visitor}', 'Outside creator');
    INSERT INTO public.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${workspace}', '${owner}', 'owner'), ('${outside}', '${visitor}', 'owner');
    INSERT INTO public.sessions (token_hash, user_id, expires_at) VALUES
      (decode('${hash(ownerToken)}', 'hex'), '${owner}', now() + interval '1 hour'),
      (decode('${hash(outsiderToken)}', 'hex'), '${visitor}', now() + interval '1 hour');
    INSERT INTO public.retention_policies (id, workspace_id, days_after_close)
    VALUES ('${retentionPolicy}', '${workspace}', 90);
  `);
  return {
    stack,
    sql,
    workspace,
    outside,
    retentionPolicy,
    ownerToken,
    outsiderToken,
  };
}

export const definition = {
  schemaVersion: "1",
  title: "Workshop feedback",
  pages: [
    {
      id: "first",
      questions: [
        {
          id: "rating",
          code: "workshop_rating",
          title: "How useful was the workshop?",
          type: "single_choice",
          required: true,
          options: [
            { code: "useful", label: "Useful" },
            { code: "not_useful", label: "Not useful" },
          ],
        },
      ],
    },
  ],
};
