import { expect, test, type Page } from "@playwright/test";
import { liveQuizFixture } from "../fixtures/live-quiz.ts";

async function incomingSnapshot(page: Page) {
  const socket = await page.waitForEvent("websocket", {
    predicate: (candidate) =>
      /\/live-sessions\/[\da-f-]+\/socket$/.test(candidate.url()),
  });
  const frame = await socket.waitForEvent("framereceived");
  return JSON.parse(String(frame.payload));
}

test("presenter and guest reopen the durable lobby over real WebSockets", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);
  const { stack, sql, ownerToken, quizVersionId } = await liveQuizFixture();
  expect((await page.goto("/live/host"))?.status()).toBe(200);
  await page.getByLabel("Development session token").fill(ownerToken);
  await page.getByLabel("Published quiz version ID").fill(quizVersionId);
  const hostFrame = incomingSnapshot(page);
  await page.getByRole("button", { name: "Open live lobby" }).click();
  await expect(
    page.getByRole("heading", { name: "Live Poll lobby" }),
  ).toBeVisible();
  const { snapshot } = await hostFrame;
  expect(snapshot).toMatchObject({
    quizVersionId,
    mode: "live_poll",
    state: "lobby",
    revision: 1,
  });
  const pin = await page.getByLabel("Join PIN").innerText();
  expect(pin).toMatch(/^[0-9]{8}$/);

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const guest = await mobile.newPage();
    await guest.goto("/live/join");
    await guest.getByLabel("Join PIN").fill(pin);
    const participantFrame = incomingSnapshot(guest);
    await guest.getByRole("button", { name: "Join live lobby" }).click();
    await expect(
      guest.getByRole("heading", { name: "Live Poll lobby" }),
    ).toBeVisible();
    const publicState = {
      id: snapshot.id,
      mode: "live_poll",
      state: "lobby",
      revision: 1,
    };
    expect(await participantFrame).toEqual({
      type: "snapshot",
      snapshot: publicState,
    });

    stack.compose("restart", "postgres");
    stack.compose("up", "-d", "--wait", "--wait-timeout", "45", "postgres");
    await expect
      .poll(async () => {
        try {
          return (await page.request.get("/api/v1/health/ready")).status();
        } catch {
          return 0;
        }
      })
      .toBe(200);
    const hostReconnect = incomingSnapshot(page);
    await page.getByRole("button", { name: "Refresh lobby" }).click();
    expect((await hostReconnect).snapshot).toEqual(snapshot);
    const guestReconnect = incomingSnapshot(guest);
    await guest.getByRole("button", { name: "Refresh lobby" }).click();
    expect((await guestReconnect).snapshot).toEqual(publicState);
    expect(
      sql(`
      SELECT quiz_version_id, (SELECT count(*) FROM public.live_participants
       WHERE session_id = s.id)
      FROM public.live_sessions s WHERE s.id = '${snapshot.id}'
    `),
    ).toBe(quizVersionId + "|1");
  } finally {
    await mobile.close();
  }
});
