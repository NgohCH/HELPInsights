import { expect, test } from "@playwright/test";
import { surveyFixture } from "../fixtures/survey.ts";

test("creators can search the user guide and open contextual preview help", async ({
  page,
}) => {
  const { ownerToken } = surveyFixture();
  await page.goto("/");
  const open = page.getByRole("button", { name: "Open user guide" });
  await expect(open).toBeVisible();
  await open.click();
  const guide = page.getByRole("region", { name: "User guide" });
  const search = guide.getByRole("searchbox", { name: "Search help topics" });
  await expect(search).toBeFocused();
  await search.fill("JASP");
  const exportTopic = guide.getByRole("button", { name: "Export for JASP" });
  await expect(exportTopic).toBeVisible();
  await expect(
    guide.getByRole("button", { name: "Preview a saved draft" }),
  ).toHaveCount(0);
  await exportTopic.click();
  await expect(
    guide.getByText(/download includes responses.csv/i),
  ).toBeVisible();
  await guide.getByRole("button", { name: "Close user guide" }).click();
  await expect(open).toBeFocused();

  await page.getByLabel("Development session token").fill(ownerToken);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByLabel("Survey title").fill("Creator help fixture");
  await page.getByLabel("Question").fill("Was this useful?");
  await page.getByLabel("Option 1").fill("Yes");
  await page.getByLabel("Option 2").fill("No");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Preview draft" }).click();
  const preview = page.getByRole("region", { name: "Draft preview" });
  const help = preview.getByRole("button", { name: "Help with preview" });
  await help.click();
  await expect(
    guide.getByRole("heading", { name: "Preview a saved draft" }),
  ).toBeVisible();
  await expect(
    guide.getByText(/preview answers stay in your browser/i),
  ).toBeVisible();
  await guide.getByRole("button", { name: "Close user guide" }).click();
  await expect(help).toBeFocused();
  await help.click();
  await preview.getByRole("button", { name: "Close preview" }).click();
  await guide.getByRole("button", { name: "Close user guide" }).click();
  await expect(open).toBeFocused();
});

test("an unavailable help topic asset leaves the creator entry screen usable", async ({
  page,
}) => {
  await page.route("**/assets/creator-help.en.json", (route) =>
    route.fulfill({
      json: { version: 1, audience: "creator", topics: [null] },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Open user guide" }).click();
  const guide = page.getByRole("region", { name: "User guide" });
  await expect(guide.getByRole("alert")).toHaveText(
    "Guide content could not be loaded. Close the guide and try again.",
  );
  await guide.getByRole("button", { name: "Close user guide" }).click();
  await expect(
    page.getByRole("button", { name: "Open workspace" }),
  ).toBeVisible();
});
