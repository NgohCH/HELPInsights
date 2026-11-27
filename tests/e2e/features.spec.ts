import { expect, test } from "@playwright/test";
import { featureFixture } from "../fixtures/features.ts";

test("a separate reviewer enables NPS questions and the creator can publish one", async ({
  page,
  browser,
}) => {
  const { workspace, ownerToken, reviewerToken, delegate, sql } =
    featureFixture();
  await page.goto("/");
  await page.getByLabel("Development session token").fill(ownerToken);
  await page.getByRole("button", { name: "Open workspace" }).click();
  const catalogue = page.getByRole("region", { name: "Feature catalogue" });
  await catalogue
    .getByRole("button", { name: "View feature catalogue" })
    .click();
  await expect(
    catalogue.getByText("NPS questions", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Question type")).toHaveCount(0);
  await catalogue.getByLabel("Purpose").fill("Review a synthetic event");
  await catalogue.getByRole("button", { name: "Request NPS access" }).click();
  await expect(catalogue.getByText("Pending review")).toBeVisible();

  delegate();
  const reviewer = await browser.newPage();
  try {
    await reviewer.goto(page.url());
    await reviewer.getByLabel("Development session token").fill(reviewerToken);
    await reviewer.getByRole("button", { name: "Open workspace" }).click();
    const reviewCatalogue = reviewer.getByRole("region", {
      name: "Feature catalogue",
    });
    await reviewCatalogue
      .getByRole("button", { name: "View feature catalogue" })
      .click();
    await reviewCatalogue
      .getByLabel("Decision rationale")
      .fill("Synthetic approval");
    await reviewCatalogue.getByLabel("Access days").fill("7");
    await reviewCatalogue
      .getByRole("button", { name: "Approve access" })
      .focus();
    await reviewer.keyboard.press("Enter");
    await expect(
      reviewCatalogue.getByText("Approved", { exact: true }),
    ).toBeVisible();
  } finally {
    await reviewer.close();
  }

  await catalogue
    .getByRole("button", { name: "Refresh feature catalogue" })
    .click();
  await expect(
    catalogue.getByText("NPS authoring is available."),
  ).toBeVisible();
  const screenshot = test.info().outputPath("nps-approval.png");
  await catalogue.screenshot({ path: screenshot });
  await test.info().attach("Synthetic NPS approval", {
    path: screenshot,
    contentType: "image/png",
  });
  await page.getByLabel("Question type").selectOption("nps");
  await page.getByLabel("Survey title").fill("Synthetic event recommendations");
  await page
    .getByLabel("Question", { exact: true })
    .fill("Would you recommend this event?");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  await page.getByRole("button", { name: "Publish survey" }).click();
  const link = page.getByRole("link", { name: "Open respondent link" });
  await expect(link).toBeVisible();
  const respondent = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  try {
    await respondent.goto(
      new URL((await link.getAttribute("href"))!, page.url()).href,
    );
    const rating = respondent.getByRole("spinbutton", {
      name: "Would you recommend this event?",
    });
    await expect(rating).toHaveAttribute("min", "0");
    await expect(rating).toHaveAttribute("max", "10");
    await rating.fill("9");
    await respondent.getByRole("button", { name: "Submit response" }).click();
    await expect(respondent.getByRole("status")).toHaveText(
      "Response submitted",
    );
  } finally {
    await respondent.close();
  }
  expect(
    sql(`
    SELECT v.definition->'pages'->0->'questions'->0->>'type', r.answers->0->>'value'
    FROM public.responses r JOIN public.survey_versions v ON r.survey_version_id = v.id
    JOIN public.surveys s ON v.survey_id = s.id WHERE s.workspace_id = '${workspace}'
  `),
  ).toBe("nps|9");
});
