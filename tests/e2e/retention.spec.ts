import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { surveyFixture } from "../fixtures/survey.ts";

function retainedSurvey() {
  const fixture = surveyFixture();
  const survey = randomUUID();
  const version = randomUUID();
  fixture.sql(`
    INSERT INTO public.surveys (id, workspace_id, title, privacy_mode, status, retention_policy_id, expiry_at)
      VALUES ('${survey}', '${fixture.workspace}', 'Synthetic retained survey', 'anonymous', 'closed', '${fixture.retentionPolicy}', now() - interval '1 day');
    INSERT INTO public.survey_versions (id, survey_id, version, definition, hash)
      VALUES ('${version}', '${survey}', 1, '{}', repeat('0', 64));
    INSERT INTO public.responses (survey_version_id, answers, retry_key_hash, payload_hash)
      VALUES ('${version}', '[{"questionId":"q","value":"synthetic"}]', decode(repeat('0', 64), 'hex'), decode(repeat('1', 64), 'hex'));
  `);
  return { ...fixture, survey, version };
}

async function lookUp(page: Page, token: string, survey: string) {
  await page.getByLabel("Development session token").fill(token);
  await page.getByRole("button", { name: "Open operations" }).click();
  const retention = page.getByRole("region", { name: "Survey retention" });
  await retention.getByLabel("Survey ID").fill(survey);
  await retention.getByRole("button", { name: "Check retention" }).click();
  return retention;
}

test("an appointed reviewer previews disposal and stores a hold without platform operations access", async ({
  page,
}) => {
  const { sql, workspace, ownerToken, survey, version } = retainedSurvey();
  const actor = sql(
    `SELECT user_id FROM public.workspace_memberships WHERE workspace_id = '${workspace}'`,
  );
  sql(
    `INSERT INTO public.retention_hold_approvers (workspace_id, user_id) VALUES ('${workspace}', '${actor}')`,
  );

  await page.goto("/admin");
  const retention = await lookUp(page, ownerToken, survey);
  await expect(
    page.getByRole("heading", { name: "Service health" }),
  ).toHaveCount(0);
  await expect(
    retention.getByText("Eligible for disposal", { exact: true }),
  ).toBeVisible();
  await expect(retention.getByText(/preview only/i)).toBeVisible();
  expect(
    sql(
      `SELECT count(*) FROM public.responses WHERE survey_version_id = '${version}'`,
    ),
  ).toBe("1");

  const evidence = randomUUID();
  const expiry = "2099-05-26T08:15:00.000Z";
  await retention.getByLabel("Hold reason").selectOption("research");
  await retention.getByLabel("Evidence reference").fill(evidence);
  await retention.getByLabel("Hold expiry (UTC)").fill("2099-05-26T08:15");
  await retention.getByRole("button", { name: "Approve hold" }).click();
  await expect(
    retention.getByText("Hold approved.", { exact: true }),
  ).toBeVisible();
  await expect(
    retention.getByText("Protected by a hold", { exact: true }),
  ).toBeVisible();
  await expect(retention.locator(`time[datetime="${expiry}"]`)).toBeVisible();
  expect(
    sql(
      `SELECT approved_by || ':' || reason || ':' || evidence_reference || ':' || (expires_at = '${expiry}'::timestamptz)::text FROM public.retention_holds WHERE survey_id = '${survey}'`,
    ),
  ).toBe(`${actor}:research:${evidence}:true`);
  expect(
    sql(
      `SELECT count(*) FROM public.responses WHERE survey_version_id = '${version}'`,
    ),
  ).toBe("1");
});

test("survey retention exposes only the actions allowed for the signed-in workspace member", async ({
  page,
}) => {
  const { ownerToken, outsiderToken, survey } = retainedSurvey();
  await page.goto("/admin");
  const retention = await lookUp(page, ownerToken, survey);
  await expect(
    retention.getByText("Retention period ended", { exact: true }),
  ).toBeVisible();
  await expect(
    retention.getByRole("button", { name: "Approve hold" }),
  ).toHaveCount(0);
  await expect(
    retention.getByText("Eligible for disposal", { exact: true }),
  ).toHaveCount(0);

  await lookUp(page, outsiderToken, survey);
  await expect(retention.getByRole("alert")).toHaveText("Survey not found");
  await expect(
    retention.getByText("Retention period ended", { exact: true }),
  ).toHaveCount(0);
  await expect(
    retention.getByRole("button", { name: "Approve hold" }),
  ).toHaveCount(0);
});
