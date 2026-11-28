import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { surveyFixture } from "../fixtures/survey.ts";

const seminarDefinition = (title: string) => ({
  schemaVersion: "1",
  title,
  pages: [
    {
      id: "seminar",
      title: "Seminar",
      questions: [
        {
          id: "pace",
          code: "seminar_pace",
          type: "single_choice",
          title: "Was the pace right?",
          required: true,
          options: [
            { code: "yes", label: "Yes" },
            { code: "no", label: "No" },
          ],
        },
      ],
    },
  ],
});

test("a reopened draft can publish and close collection after an explicit audience decision", async ({
  page,
  browser,
  baseURL,
}) => {
  const { workspace, ownerToken, retentionPolicy, sql } = surveyFixture();
  const title = "Synthetic seminar " + randomUUID();
  const headers = { Authorization: "Bearer " + ownerToken };
  const created = await page.request.post("/api/v1/surveys", {
    headers,
    data: {
      workspaceId: workspace,
      retentionPolicyId: retentionPolicy,
      title,
      privacyMode: "anonymous",
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const endpoint = "/api/v1/surveys/" + id;
  const definition = seminarDefinition(title);
  const saved = await page.request.put(endpoint + "/draft", {
    headers: { ...headers, "If-Match": created.headers().etag },
    data: definition,
  });
  expect(saved.status()).toBe(200);

  await page.goto("/");
  await page.getByLabel("Development session token").fill(ownerToken);
  await page.getByRole("button", { name: "Open workspace" }).click();
  const list = page.getByRole("region", { name: "Workspace surveys" });
  await list.getByRole("button", { name: "Open " + title }).click();
  const details = list.getByRole("region", { name: "Saved survey details" });
  const publish = details.getByRole("button", { name: "Publish saved draft" });
  await publish.click();

  const audience = details.getByRole("combobox", {
    name: "Audience",
    exact: true,
  });
  const publishVersion = details.getByRole("button", {
    name: "Publish version",
  });
  await expect(audience).toHaveValue("");
  await expect(publishVersion).toBeDisabled();
  await audience.selectOption("open");
  const responseReady = Promise.withResolvers<void>();
  const releaseResponse = Promise.withResolvers<void>();
  await page.route(endpoint + "/publish", async (route) => {
    const response = await route.fetch();
    responseReady.resolve();
    await releaseResponse.promise;
    await route.fulfill({ response });
  });
  try {
    await publishVersion.click();
    await responseReady.promise;
    await expect(
      list.getByRole("button", { name: "Open " + title }),
    ).toBeDisabled();
    await expect(
      page.getByRole("combobox", { name: "Workspace", exact: true }),
    ).toBeDisabled();
    const navigation = page.getByRole("navigation", {
      name: "Workspace navigation",
    });
    const retention = navigation.getByRole("link", {
      name: "Survey retention",
    });
    const join = navigation.getByRole("link", { name: "Join a live session" });
    await expect(retention).toBeDisabled();
    await expect(join).toBeDisabled();
    expect(await retention.getAttribute("href")).toBeNull();
    expect(await join.getAttribute("href")).toBeNull();
  } finally {
    releaseResponse.resolve();
  }
  const link = details.getByRole("link", { name: "Open new respondent link" });
  await expect(link).toBeVisible();
  await expect(details.getByText("Version 1")).toBeVisible();
  expect(sql("SELECT status FROM public.surveys WHERE id = '" + id + "'")).toBe(
    "published",
  );

  const respondentPath = (await link.getAttribute("href"))!;
  const respondent = await browser.newPage({ baseURL });
  try {
    await respondent.goto(respondentPath);
    await expect(
      respondent.getByRole("heading", { name: title }),
    ).toBeVisible();
    await respondent.getByRole("radio", { name: "Yes" }).check();
    await respondent.getByRole("button", { name: "Submit response" }).click();
    await expect(respondent.getByRole("status")).toHaveText(
      "Response submitted",
    );

    const close = details.getByRole("button", {
      name: "End response collection",
    });
    await close.click();
    await expect(
      details.getByRole("heading", { name: "End response collection" }),
    ).toBeFocused();
    await details.getByRole("button", { name: "Keep collecting" }).click();
    await expect(close).toBeFocused();
    expect(
      sql("SELECT status FROM public.surveys WHERE id = '" + id + "'"),
    ).toBe("published");
    await close.click();
    await details
      .getByRole("button", { name: "Confirm end of collection" })
      .click();
    await expect(details.getByRole("status")).toHaveText(
      "Response collection ended",
    );
    expect(
      sql("SELECT status FROM public.surveys WHERE id = '" + id + "'"),
    ).toBe("closed");
    await expect(publish).toHaveCount(0);
    await expect(details.getByText("Version 1")).toBeVisible();
    expect(
      sql(
        "SELECT count(*) FROM public.responses r JOIN public.survey_versions v ON v.id = r.survey_version_id WHERE v.survey_id = '" +
          id +
          "'",
      ),
    ).toBe("1");
    await respondent.goto(respondentPath);
    await expect(
      respondent.getByRole("button", { name: "Submit response" }),
    ).toHaveCount(0);
    await expect(respondent.getByRole("alert")).toBeVisible();
  } finally {
    await respondent.close();
  }
});

test("a stale saved draft cannot replace a University-only publication", async ({
  page,
}) => {
  const { workspace, ownerToken, retentionPolicy, sql } = surveyFixture();
  const policyId = randomUUID();
  sql(
    "INSERT INTO public.university_eligibility_policies (id, workspace_id, code, version, approved_at) VALUES ('" +
      policyId +
      "', '" +
      workspace +
      "', 'seminar-only', 1, now())",
  );
  const title = "University seminar " + randomUUID();
  const headers = { Authorization: "Bearer " + ownerToken };
  const created = await page.request.post("/api/v1/surveys", {
    headers,
    data: {
      workspaceId: workspace,
      retentionPolicyId: retentionPolicy,
      title,
      privacyMode: "anonymous",
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const endpoint = "/api/v1/surveys/" + id;
  const saved = await page.request.put(endpoint + "/draft", {
    headers: { ...headers, "If-Match": created.headers().etag },
    data: seminarDefinition(title),
  });
  expect(saved.status()).toBe(200);
  const first = await page.request.post(endpoint + "/publish", {
    headers: { ...headers, "If-Match": saved.headers().etag },
    data: { eligibilityMode: "university", universityPolicyId: policyId },
  });
  expect(first.status()).toBe(201);

  await page.goto("/");
  await page.getByLabel("Development session token").fill(ownerToken);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page
    .getByRole("region", { name: "Workspace surveys" })
    .getByRole("button", { name: "Open " + title })
    .click();
  const details = page.getByRole("region", { name: "Saved survey details" });
  await details.getByRole("button", { name: "Publish saved draft" }).click();
  const audience = details.getByRole("combobox", {
    name: "Audience",
    exact: true,
  });
  await expect(audience).toHaveValue("");
  const publish = details.getByRole("button", { name: "Publish version" });
  await audience.selectOption("university");
  await expect(publish).toBeDisabled();
  await details
    .getByLabel("University eligibility policy")
    .selectOption(policyId);
  const olderDraft = await page.request.get(endpoint, { headers });
  const concurrent = await page.request.put(endpoint + "/draft", {
    headers: { ...headers, "If-Match": olderDraft.headers().etag },
    data: seminarDefinition(title + " revised"),
  });
  expect(concurrent.status()).toBe(200);
  const rejected = page.waitForResponse(
    (response) =>
      response.url().endsWith(endpoint + "/publish") &&
      response.request().method() === "POST",
  );
  await publish.click();
  expect((await rejected).status()).toBe(409);
  await expect(details.getByRole("alert")).toBeVisible();
  await expect(audience).toHaveValue("university");
  expect(
    sql(
      "SELECT string_agg(d.eligibility_mode, ',' ORDER BY v.version) FROM public.distributions d JOIN public.survey_versions v ON v.id = d.survey_version_id WHERE v.survey_id = '" +
        id +
        "'",
    ),
  ).toBe("university");

  await details.getByRole("button", { name: "Reload saved survey" }).click();
  await details.getByRole("button", { name: "Publish saved draft" }).click();
  await audience.selectOption("university");
  await details
    .getByLabel("University eligibility policy")
    .selectOption(policyId);
  await publish.click();
  await expect(details.getByText("Version 2")).toBeVisible();
  expect(
    sql(
      "SELECT string_agg(d.eligibility_mode, ',' ORDER BY v.version) FROM public.distributions d JOIN public.survey_versions v ON v.id = d.survey_version_id WHERE v.survey_id = '" +
        id +
        "'",
    ),
  ).toBe("university,university");
});
