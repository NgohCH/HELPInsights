import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { registryFixture } from "../fixtures/registry.ts";

test("publishers list only approved policy versions from their own workspace", async () => {
  const { request, sql, workspace, outside, ownerToken, outsiderToken } =
    registryFixture();
  const first = randomUUID();
  const second = randomUUID();
  sql(`
    INSERT INTO public.university_eligibility_policies (id, workspace_id, code, version, approved_at, withdrawn_at) VALUES
      ('${first}', '${workspace}', 'teaching-cohort', 1, now(), NULL),
      ('${second}', '${workspace}', 'teaching-cohort', 2, now(), NULL),
      (gen_random_uuid(), '${outside}', 'outside-cohort', 1, now(), NULL),
      (gen_random_uuid(), '${workspace}', 'awaiting-approval', 1, NULL, NULL),
      (gen_random_uuid(), '${workspace}', 'future-cohort', 1, now() + interval '1 hour', NULL),
      (gen_random_uuid(), '${workspace}', 'withdrawn-cohort', 1, now(), now());
  `);
  const path = `/workspaces/${workspace}/university-eligibility-policies`;
  const auth = (token: string) => ({ Authorization: "Bearer " + token });
  const listed = await request(path, "GET", { headers: auth(ownerToken) });
  expect(listed.status).toBe(200);
  expect(await listed.json()).toEqual({
    enabled: true,
    items: [
      { id: second, code: "teaching-cohort", version: 2 },
      { id: first, code: "teaching-cohort", version: 1 },
    ],
  });
  expect((await request(path)).status).toBe(401);
  expect(
    (await request(path, "GET", { headers: auth(outsiderToken) })).status,
  ).toBe(403);
  sql(
    `UPDATE public.workspace_memberships SET role = 'editor' WHERE workspace_id = '${workspace}'`,
  );
  expect(
    (await request(path, "GET", { headers: auth(ownerToken) })).status,
  ).toBe(200);
  sql(
    `UPDATE public.workspace_memberships SET role = 'viewer' WHERE workspace_id = '${workspace}'`,
  );
  expect(
    (await request(path, "GET", { headers: auth(ownerToken) })).status,
  ).toBe(403);
});

test("restricted publishing stays blocked without a current policy and recovers with an approved version", async ({
  page,
  browser,
  baseURL,
}) => {
  const { sql, workspace } = registryFixture();
  const creator = sql(
    `SELECT user_id FROM public.workspace_memberships WHERE workspace_id = '${workspace}' AND role = 'owner'`,
  );
  const eligible = randomUUID();
  const withdrawn = randomUUID();
  const approved = randomUUID();
  const title = "Restricted audience " + randomUUID();
  sql(`
    INSERT INTO public.users (id, display_name) VALUES ('${eligible}', 'Synthetic eligible respondent');
    INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id) VALUES
      ('http://oidc-simulator:3002', 'publish-creator', '${creator}'),
      ('http://oidc-simulator:3002', 'publish-eligible', '${eligible}');
  `);
  const versionCount = () =>
    sql(`SELECT count(*) FROM public.survey_versions v JOIN public.surveys s ON s.id = v.survey_id
      WHERE s.workspace_id = '${workspace}' AND s.title = '${title}'`);

  await page.goto("/");
  await page
    .getByRole("link", { name: "Sign in with University account" })
    .click();
  await page
    .getByRole("button", { name: "publish-creator", exact: true })
    .click();
  await page.getByLabel("Survey title").fill(title);
  await page.getByLabel("Question", { exact: true }).fill("Ready to start?");
  await page.getByLabel("Option 1", { exact: true }).fill("Ready");
  await page.getByLabel("Option 2", { exact: true }).fill("Wait");
  const save = page.getByRole("button", { name: "Save draft" });
  await save.click();
  const audience = page.getByRole("combobox", {
    name: "Audience",
    exact: true,
  });
  const policy = page.getByRole("combobox", {
    name: "University eligibility policy",
  });
  const publish = page.getByRole("button", { name: "Publish survey" });
  await expect(audience).toHaveValue("open");
  await audience.selectOption("university");
  await expect(
    page.getByText(
      "No approved University eligibility policies are available for this workspace.",
    ),
  ).toBeVisible();
  await expect(publish).toBeDisabled();
  expect(versionCount()).toBe("0");

  sql(`INSERT INTO public.university_eligibility_policies (id, workspace_id, code, version, approved_at)
    VALUES ('${withdrawn}', '${workspace}', 'seminar-cohort', 1, now()),
           ('${approved}', '${workspace}', 'seminar-cohort', 2, now());
    INSERT INTO public.university_eligibility_grants (policy_id, user_id, expires_at)
    VALUES ('${approved}', '${eligible}', now() + interval '1 hour');`);
  await page
    .getByRole("button", { name: "Refresh eligibility policies" })
    .click();
  await policy.selectOption(withdrawn);
  await expect(publish).toBeEnabled();
  sql(
    `UPDATE public.university_eligibility_policies SET withdrawn_at = now() WHERE id = '${withdrawn}'`,
  );
  await publish.click();
  await expect(page.getByRole("alert")).toContainText(
    "Choose an approved eligibility policy",
  );
  await expect(audience).toHaveValue("university");
  await expect(publish).toBeDisabled();
  expect(versionCount()).toBe("0");

  await policy.selectOption(approved);
  await publish.click();
  const link = page.getByRole("link", { name: "Open respondent link" });
  await expect(link).toBeVisible();
  expect(
    sql(`SELECT d.eligibility_mode || ':' || d.university_policy_id::text
    FROM public.distributions d JOIN public.survey_versions v ON v.id = d.survey_version_id
    JOIN public.surveys s ON s.id = v.survey_id WHERE s.workspace_id = '${workspace}' AND s.title = '${title}'`),
  ).toBe("university:" + approved);
  const respondentPath = (await link.getAttribute("href"))!;
  await link.click();
  await expect(page.getByRole("alert")).toHaveText(
    "University eligibility could not be confirmed for this survey",
  );
  await expect(page.getByRole("heading", { name: title })).toHaveCount(0);

  const respondent = await browser.newPage({ baseURL });
  try {
    await respondent.goto(respondentPath);
    await expect(respondent.getByRole("heading", { name: title })).toHaveCount(
      0,
    );
    await respondent
      .getByRole("link", { name: "Sign in with University account" })
      .click();
    await respondent
      .getByRole("button", { name: "publish-eligible", exact: true })
      .click();
    await expect(
      respondent.getByRole("heading", { name: title }),
    ).toBeVisible();
    await respondent.getByRole("radio", { name: "Ready", exact: true }).check();
    await respondent.getByRole("button", { name: "Submit response" }).click();
    await expect(respondent.getByRole("status")).toHaveText(
      "Response submitted",
    );
  } finally {
    await respondent.close();
  }
  const response = sql(`SELECT jsonb_agg(to_jsonb(r))::text
    FROM public.responses r JOIN public.survey_versions v ON v.id = r.survey_version_id
    JOIN public.surveys s ON s.id = v.survey_id WHERE s.workspace_id = '${workspace}' AND s.title = '${title}'`);
  expect(JSON.parse(response)).toHaveLength(1);
  expect(response).toContain("option_1");
  expect(response).not.toContain(eligible);
  expect(response).not.toContain("publish-eligible");
  expect(response).not.toContain(approved);
});
