import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { surveyFixture } from "../fixtures/survey.ts";

test("a survey survives PostgreSQL restart and its browser results match the downloaded JASP CSV", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);
  const { stack, sql, ownerToken } = surveyFixture();
  await page.goto("/");
  await page.getByLabel("Development session token").fill(ownerToken);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Create survey" }),
  ).toBeVisible();
  await page.getByLabel("Survey title").fill("Campus workshop pulse");
  await page.getByLabel("Question").fill("How useful was the workshop?");
  await page.getByLabel("Option 1").fill("Useful");
  await page.getByLabel("Option 2").fill("Not useful");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  await page.getByRole("button", { name: "Publish survey" }).click();
  const respondentLink = page.getByRole("link", {
    name: "Open respondent link",
  });
  await expect(respondentLink).toBeVisible();
  const href = await respondentLink.getAttribute("href");
  expect(href).toMatch(/^\/respond\/[A-Za-z0-9_-]{43}$/);

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const respondent = await mobile.newPage();
    await respondent.goto(new URL(href!, page.url()).href);
    await expect(
      respondent.getByRole("heading", { name: "Campus workshop pulse" }),
    ).toBeVisible();
    const answer = respondent.getByRole("radio", {
      name: "Useful",
      exact: true,
    });
    await answer.focus();
    await respondent.keyboard.press("Space");
    await expect(answer).toBeChecked();
    await respondent.getByRole("button", { name: "Submit response" }).click();
    await expect(respondent.getByRole("status")).toHaveText(
      "Response submitted",
    );

    const token = href!.split("/").at(-1);
    const endpoint = new URL("/api/v1/public/s/" + token, page.url()).href;
    const published = await mobile.request.get(endpoint);
    expect(published.ok()).toBeTruthy();
    const { surveyVersionId } = await published.json();
    for (let index = 0; index < 4; index++) {
      const response = await mobile.request.post(endpoint + "/responses", {
        headers: { "Idempotency-Key": randomUUID() },
        data: {
          surveyVersionId,
          answers: [{ questionId: "question", value: "option_1" }],
        },
      });
      expect(response.status()).toBe(201);
    }
  } finally {
    await mobile.close();
  }

  stack.compose("restart", "postgres");
  stack.compose("up", "-d", "--wait", "--wait-timeout", "45", "postgres");
  await expect
    .poll(async () => (await page.request.get("/api/v1/health/ready")).status())
    .toBe(200);
  expect(
    sql(`
    SELECT r.answers->0->>'value' || ':' || count(*)
    FROM public.responses r JOIN public.survey_versions v ON v.id = r.survey_version_id
    JOIN public.surveys s ON s.id = v.survey_id
    WHERE s.title = 'Campus workshop pulse' GROUP BY r.answers->0->>'value'
  `),
  ).toBe("option_1:5");

  await page.getByRole("button", { name: "View results" }).click();
  await expect(
    page.getByRole("heading", { name: "Survey results" }),
  ).toBeVisible();
  await expect(page.getByText("5 responses", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Useful", exact: true }),
  ).toHaveAttribute("value", "5");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JASP CSV" }).click();
  const download = await downloadEvent;
  const exportPath = test.info().outputPath("helpinsights-data.zip");
  await download.saveAs(exportPath);
  const archive = unzipSync(new Uint8Array(await readFile(exportPath)));
  const csv = new TextDecoder().decode(archive["responses.csv"]);
  expect(csv.split("\r\n")).toEqual([
    "workshop_question",
    ...Array(5).fill("option_1"),
    "",
  ]);
  const screenshot = test.info().outputPath("survey-results.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await test.info().attach("Synthetic survey results", {
    path: screenshot,
    contentType: "image/png",
  });
  await test.info().attach("Synthetic JASP CSV bundle", {
    path: exportPath,
    contentType: "application/zip",
  });
});
