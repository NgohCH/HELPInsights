import type { PoolClient } from "pg";
import type { SurveyDefinition } from "../../packages/survey-runtime/definition.ts";
import { HttpError } from "./sessions.ts";

export async function npsAccessEnabled(client: PoolClient, workspace: string) {
  const {
    rows: [result],
  } = await client.query<{ enabled: boolean }>(
    "SELECT public.nps_access_enabled($1) AS enabled",
    [workspace],
  );
  return result.enabled;
}

export async function requireSurveyFeatureAccess(
  client: PoolClient,
  workspace: string,
  definition: SurveyDefinition,
) {
  const containsNps = definition.pages.some(({ questions }) =>
    questions.some(({ type }) => type === "nps"),
  );
  if (containsNps && !(await npsAccessEnabled(client, workspace)))
    throw new HttpError(
      403,
      "FORBIDDEN",
      "This workspace needs current approval for NPS questions",
    );
}
