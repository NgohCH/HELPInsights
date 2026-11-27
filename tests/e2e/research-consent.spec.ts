import { expect, test } from "@playwright/test";
import { researchFixture } from "../fixtures/research-consent.ts";

test("a mobile respondent can decline, then explicitly consent before entering a synthetic response", async ({
  page,
}) => {
  const { prepare, publish, sql } = researchFixture();
  const { request } = await prepare();
  const version = await publish(request);
  const countAccepted = () =>
    sql(`
    SELECT
      (SELECT count(*) FROM public.responses WHERE survey_version_id = '${version.id}'),
      (SELECT count(*) FROM public.research_consent_opt_ins o JOIN public.research_consent_versions c
        ON c.id = o.consent_version_id WHERE c.survey_version_id = '${version.id}')
  `);
  let submitAttempts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/responses"))
      submitAttempts += 1;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/respond/" + version.publicToken);
  const notice = page.getByRole("region", { name: "Synthetic study consent" });
  await expect(notice.getByText(/Participation is voluntary/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit response" }),
  ).toHaveCount(0);
  await notice.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "You declined. No answer was sent.",
  );
  expect(submitAttempts).toBe(0);
  expect(countAccepted()).toBe("0|0");

  await page.reload();
  const screenshot = test.info().outputPath("synthetic-study-consent.png");
  await notice.screenshot({ path: screenshot });
  await test.info().attach("Synthetic study consent notice", {
    path: screenshot,
    contentType: "image/png",
  });
  await notice.getByRole("button", { name: "I agree to participate" }).focus();
  await page.keyboard.press("Enter");
  const choice = page.getByRole("radio", { name: "Useful", exact: true });
  await choice.focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Submit response" }).click();
  await expect(page.getByRole("status")).toHaveText("Response submitted");
  expect(countAccepted()).toBe("1|1");
  expect(submitAttempts).toBe(1);
});
