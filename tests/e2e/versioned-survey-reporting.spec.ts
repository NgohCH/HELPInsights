import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { definition, surveyFixture } from "../fixtures/survey.ts";

test("authorized authors can inspect and export the older publication after closing the survey", async ({
  page,
}) => {
  const {
    workspace,
    outside,
    retentionPolicy,
    ownerToken,
    outsiderToken,
    sql,
  } = surveyFixture();
  const title = "Versioned synthetic workshop " + randomUUID();
  const headers = { Authorization: "Bearer " + ownerToken };
  const created = await page.request.post("/api/v1/surveys", {
    headers,
    data: {
      workspaceId: workspace,
      title,
      retentionPolicyId: retentionPolicy,
      privacyMode: "anonymous",
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const endpoint = "/api/v1/surveys/" + id;
  let revision = created.headers().etag;
  async function publish(option: "useful" | "not_useful", count: number) {
    const saved = await page.request.put(endpoint + "/draft", {
      headers: { ...headers, "If-Match": revision },
      data: {
        ...definition,
        title,
        pages:
          option === "useful"
            ? definition.pages
            : definition.pages.map((entry) => ({
                ...entry,
                questions: entry.questions.map((question) => ({
                  ...question,
                  code: "repeat_workshop",
                  title: "Would you repeat the workshop?",
                })),
              })),
      },
    });
    expect(saved.status()).toBe(200);
    revision = saved.headers().etag;
    const published = await page.request.post(endpoint + "/publish", {
      headers: { ...headers, "If-Match": revision },
    });
    expect(published.status()).toBe(201);
    const version = (await published.json()) as {
      id: string;
      publicToken: string;
    };
    for (let index = 0; index < count; index++) {
      const response = await page.request.post(
        "/api/v1/public/s/" + version.publicToken + "/responses",
        {
          headers: { "Idempotency-Key": randomUUID() },
          data: {
            surveyVersionId: version.id,
            answers: [{ questionId: "rating", value: option }],
          },
        },
      );
      expect(response.status()).toBe(201);
    }
    return version.id;
  }

  const firstVersion = await publish("useful", 5);
  const secondVersion = await publish("not_useful", 1);
  expect(
    (await page.request.post(endpoint + "/close", { headers })).status(),
  ).toBe(200);
  expect(
    sql(
      "SELECT string_agg(response_total::text, ',' ORDER BY version) FROM (SELECT v.version, count(r.id) AS response_total FROM public.survey_versions v LEFT JOIN public.responses r ON r.survey_version_id = v.id WHERE v.survey_id = '" +
        id +
        "' GROUP BY v.version) AS totals",
    ),
  ).toBe("5,1");

  const analytics = endpoint + "/analytics";
  const selected = await page.request.get(
    analytics + "?surveyVersionId=" + firstVersion,
    { headers },
  );
  expect(selected.status()).toBe(200);
  expect(await selected.json()).toMatchObject({
    surveyVersionId: firstVersion,
    responseCount: 5,
  });
  const repeated = await page.request.get(
    analytics +
      "?surveyVersionId=" +
      firstVersion +
      "&surveyVersionId=" +
      secondVersion,
    { headers },
  );
  expect(repeated.status()).toBe(400);
  const defaultVersion = await page.request.get(analytics, { headers });
  expect(await defaultVersion.json()).toMatchObject({
    surveyVersionId: secondVersion,
    responseCount: 1,
  });
  expect(
    (
      await page.request.get(analytics + "?surveyVersionId=" + randomUUID(), {
        headers,
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.get(analytics + "?surveyVersionId=invalid", {
        headers,
      })
    ).status(),
  ).toBe(400);
  const outsider = await page.request.get(
    analytics + "?surveyVersionId=" + firstVersion,
    { headers: { Authorization: "Bearer " + outsiderToken } },
  );
  expect(outsider.status()).toBe(404);
  const unrelated = await page.request.post("/api/v1/surveys", {
    headers,
    data: {
      workspaceId: workspace,
      title: "Unrelated synthetic survey",
      retentionPolicyId: retentionPolicy,
      privacyMode: "anonymous",
    },
  });
  expect(unrelated.status()).toBe(201);
  const unrelatedSurvey = await unrelated.json();
  expect(
    (
      await page.request.get(
        "/api/v1/surveys/" +
          unrelatedSurvey.id +
          "/analytics?surveyVersionId=" +
          firstVersion,
        { headers },
      )
    ).status(),
  ).toBe(404);

  const member = { Authorization: "Bearer " + outsiderToken };
  sql(`INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
    SELECT '${workspace}', user_id, 'analyst'
    FROM public.workspace_memberships WHERE workspace_id = '${outside}'`);
  const analyst = await page.request.get(
    analytics + "?surveyVersionId=" + firstVersion,
    { headers: member },
  );
  expect(analyst.status()).toBe(200);
  expect(await analyst.json()).toMatchObject({
    surveyVersionId: firstVersion,
    responseCount: 5,
  });
  sql(
    `UPDATE public.workspace_memberships SET role = 'viewer' WHERE workspace_id = '${workspace}' AND role = 'analyst'`,
  );
  expect(
    (
      await page.request.get(analytics + "?surveyVersionId=" + firstVersion, {
        headers: member,
      })
    ).status(),
  ).toBe(403);

  await page.goto("/");
  await page.getByLabel("Development session token").fill(ownerToken);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page
    .getByRole("region", { name: "Workspace surveys" })
    .getByRole("button", { name: "Open " + title })
    .click();
  const details = page.getByRole("region", { name: "Saved survey details" });
  const version = details.getByRole("combobox", {
    name: "Reporting publication",
  });
  await expect(version).toHaveValue(secondVersion);
  await details.getByRole("button", { name: "View results" }).click();
  await expect(details.getByText("1 response", { exact: true })).toBeVisible();
  await expect(
    details.getByRole("heading", { name: "Would you repeat the workshop?" }),
  ).toBeVisible();
  await expect(
    details.getByText("Breakdown hidden until enough responses are available."),
  ).toBeVisible();
  await version.selectOption(firstVersion);
  await expect(
    details.getByRole("button", { name: "Export JASP CSV" }),
  ).toHaveCount(0);
  await details.getByRole("button", { name: "View results" }).click();
  await expect(details.getByText("5 responses", { exact: true })).toBeVisible();
  await expect(
    details.getByRole("heading", { name: "How useful was the workshop?" }),
  ).toBeVisible();
  await expect(
    details.getByRole("progressbar", { name: "Useful", exact: true }),
  ).toHaveAttribute("value", "5");

  const exported = page.waitForEvent("download");
  await details.getByRole("button", { name: "Export JASP CSV" }).click();
  const destination = test.info().outputPath("version-one.zip");
  await (await exported).saveAs(destination);
  const archive = unzipSync(await readFile(destination));
  expect(
    new TextDecoder().decode(archive["responses.csv"]).split("\r\n"),
  ).toEqual(["workshop_rating", ...Array(5).fill("useful"), ""]);
});

test("an in-flight export stays on its publication when the creator publishes a new version", async ({
  page,
}) => {
  const { workspace, retentionPolicy, ownerToken } = surveyFixture();
  const title = "Concurrent synthetic export " + randomUUID();
  const headers = { Authorization: "Bearer " + ownerToken };
  const created = await page.request.post("/api/v1/surveys", {
    headers,
    data: {
      workspaceId: workspace,
      title,
      retentionPolicyId: retentionPolicy,
      privacyMode: "anonymous",
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const endpoint = "/api/v1/surveys/" + id;
  const saved = await page.request.put(endpoint + "/draft", {
    headers: { ...headers, "If-Match": created.headers().etag },
    data: { ...definition, title },
  });
  expect(saved.status()).toBe(200);
  let newest = "";
  for (const expected of [1, 2]) {
    const published = await page.request.post(endpoint + "/publish", {
      headers: { ...headers, "If-Match": saved.headers().etag },
    });
    expect(published.status()).toBe(201);
    const version = await published.json();
    expect(version.version).toBe(expected);
    newest = version.id;
  }

  await page.goto("/");
  await page.getByLabel("Development session token").fill(ownerToken);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page
    .getByRole("region", { name: "Workspace surveys" })
    .getByRole("button", { name: "Open " + title })
    .click();
  const details = page.getByRole("region", { name: "Saved survey details" });
  const version = details.getByRole("combobox", {
    name: "Reporting publication",
  });
  await expect(version).toHaveValue(newest);
  await details.getByRole("button", { name: "View results" }).click();
  const downloadReady = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route(/\/api\/v1\/exports\/[^/]+\/download$/, async (route) => {
    const response = await route.fetch();
    downloadReady.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  const exported = page.waitForEvent("download");
  try {
    await details.getByRole("button", { name: "Export JASP CSV" }).click();
    await downloadReady.promise;
    await details.getByRole("button", { name: "Publish saved draft" }).click();
    await details
      .getByRole("combobox", { name: "Audience", exact: true })
      .selectOption("open");
    await details.getByRole("button", { name: "Publish version" }).click();
    await expect(
      version.getByRole("option", { name: "Version 3" }),
    ).toHaveCount(1);
    await expect(version).toHaveValue(newest);
  } finally {
    release.resolve();
  }
  await exported;
  await expect(details.getByText("Export ready")).toBeVisible();
  await expect(version).toHaveValue(newest);
});
