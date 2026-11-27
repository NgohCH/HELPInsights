import { expect, test } from "@playwright/test";
import {
  eligibleRegistryProof,
  ineligibleRegistryProof,
  registryFixture,
} from "../fixtures/registry.ts";

test("a mobile respondent verifies Registry eligibility before an anonymous submission", async ({
  page,
}) => {
  const { publish, sql } = registryFixture();
  const { publicToken, version } = await publish("registry-synthetic");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/respond/" + publicToken);
  const credential = page.getByLabel("Synthetic Registry credential");
  await expect(credential).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit response" }),
  ).toHaveCount(0);
  await credential.fill(ineligibleRegistryProof);
  await page.getByRole("button", { name: "Check eligibility" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "You are not eligible for this survey",
  );
  await credential.fill(eligibleRegistryProof);
  await page.getByRole("button", { name: "Check eligibility" }).focus();
  await page.keyboard.press("Enter");
  const answer = page.getByRole("radio", { name: "Useful", exact: true });
  await expect(answer).toBeVisible();
  const screenshot = test.info().outputPath("registry-verified-survey.png");
  await page.screenshot({ path: screenshot });
  await test.info().attach("Verified synthetic survey", {
    path: screenshot,
    contentType: "image/png",
  });
  await expect(credential).toHaveCount(0);
  await answer.focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Submit response" }).click();
  await expect(page.getByRole("status")).toHaveText("Response submitted");
  expect(
    sql(
      `SELECT answers->0->>'value' FROM public.responses WHERE survey_version_id = '${version}'`,
    ),
  ).toBe("useful");
  await page.reload();
  await expect(credential).toBeVisible();
});
