import { expect, test, type Page } from "@playwright/test";
import { liveQuizFixture } from "../fixtures/live-quiz.ts";

function nextRoomSocket(page: Page) {
  return page.waitForEvent("websocket", {
    predicate: (socket) =>
      /\/live-sessions\/[\da-f-]+\/socket$/.test(socket.url()),
  });
}

test("presenter commands reach the existing mobile guest socket and an offline guest resumes", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);
  const { ownerToken, quizVersionId, sql } = await liveQuizFixture();
  await page.goto("/live/host");
  await page.getByLabel("Development session token").fill(ownerToken);
  await page.getByLabel("Published quiz version ID").fill(quizVersionId);
  const hostConnecting = nextRoomSocket(page);
  await page.getByRole("button", { name: "Open live lobby" }).click();
  const hostSocket = await hostConnecting;
  await expect(
    page.getByRole("heading", { name: "Live Poll lobby" }),
  ).toBeVisible();
  const pin = await page.getByLabel("Join PIN").innerText();

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const guest = await mobile.newPage();
    await guest.goto("/live/join");
    await guest.getByLabel("Join PIN").fill(pin);
    const guestConnecting = nextRoomSocket(guest);
    await guest.getByRole("button", { name: "Join live lobby" }).click();
    const guestSocket = await guestConnecting;
    await expect(
      guest.getByRole("heading", { name: "Live Poll lobby" }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Start live poll" }),
    ).toBeVisible({ timeout: 5000 });
    const hostPush = hostSocket.waitForEvent("framereceived");
    const guestPush = guestSocket.waitForEvent("framereceived");
    await page.getByRole("button", { name: "Start live poll" }).click();
    const { snapshot: host } = JSON.parse(String((await hostPush).payload));
    const { snapshot: participant } = JSON.parse(
      String((await guestPush).payload),
    );
    expect(host).toMatchObject({
      state: "running",
      revision: 2,
      quizVersionId,
    });
    expect(participant).toEqual({
      id: host.id,
      state: "running",
      revision: 2,
      mode: "live_poll",
    });
    await expect(
      guest.getByRole("heading", { name: "Live Poll running" }),
    ).toBeVisible();

    await mobile.setOffline(true);
    await expect(guest.getByRole("status")).toHaveText(
      "Reconnecting to the lobby",
    );
    await page.getByRole("button", { name: "Pause live poll" }).click();
    await expect(
      page.getByRole("heading", { name: "Live Poll paused" }),
    ).toBeVisible();
    const reconnected = nextRoomSocket(guest);
    await mobile.setOffline(false);
    const replacement = await reconnected;
    const frame = await replacement.waitForEvent("framereceived");
    expect(JSON.parse(String(frame.payload))).toEqual({
      type: "snapshot",
      snapshot: { ...participant, state: "paused", revision: 3 },
    });
    await expect(
      guest.getByRole("heading", { name: "Live Poll paused" }),
    ).toBeVisible();
    expect(
      sql(`
      SELECT state, revision, quiz_version_id,
        (SELECT count(*) FROM public.live_participants WHERE session_id = s.id)
      FROM public.live_sessions s WHERE id = '${host.id}'
    `),
    ).toBe("paused|3|" + quizVersionId + "|1");
  } finally {
    await mobile.close();
  }
});
