import { test, expect, type Page, type WebSocket } from "@playwright/test";
import { liveQuizFixture } from "../fixtures/live-quiz.ts";

function nextSocket(page: Page) {
  return page.waitForEvent("websocket", {
    predicate: (connection) =>
      /\/live-sessions\/[\da-f-]+\/socket$/.test(connection.url()),
  });
}

function questionOpened(socket: WebSocket) {
  return socket.waitForEvent("framereceived", {
    predicate: ({ payload }) => {
      const { snapshot } = JSON.parse(String(payload));
      return (
        snapshot?.question?.id === "rating" && snapshot.question.open === true
      );
    },
  });
}

test("Game Show presenter and mobile guest see a deadline and private receipt on real sockets", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);
  const { ownerToken, quizVersionId, sql } = await liveQuizFixture();
  expect((await page.goto("/live/game-host"))?.status()).toBe(200);
  await page.getByLabel("Development session token").fill(ownerToken);
  await page.getByLabel("Published quiz version ID").fill(quizVersionId);
  await page.getByLabel("Correct option code").fill("useful");
  await page.getByLabel("Answer time in seconds").fill("30");
  const hostSocket = nextSocket(page);
  await page.getByRole("button", { name: "Open live lobby" }).click();
  const host = await hostSocket;
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
    const guestSocket = nextSocket(guest);
    await guest.getByRole("button", { name: "Join live lobby" }).click();
    const socket = await guestSocket;
    await expect(
      guest.getByRole("heading", { name: "Game Show lobby" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start game" }).click();
    await expect(
      guest.getByRole("heading", { name: "Game Show running" }),
    ).toBeVisible();
    const hostQuestion = questionOpened(host);
    const guestQuestion = questionOpened(socket);
    await page.getByRole("button", { name: "Open first question" }).click();
    const presenter = JSON.parse(String((await hostQuestion).payload)).snapshot;
    const opened = JSON.parse(String((await guestQuestion).payload)).snapshot;
    expect(opened.question.closesAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(opened.question.closesAt).toBe(presenter.question.closesAt);
    expect(opened.question.correctOptionCode).toBeUndefined();
    expect(presenter.scoring).toBeUndefined();
    await expect(guest.getByText(/Answers close at/)).toBeVisible();
    await guest.getByRole("radio", { name: "Useful", exact: true }).check();
    const receipt = socket.waitForEvent("framereceived");
    await guest.getByRole("button", { name: "Submit answer" }).click();
    const frame = JSON.parse(String((await receipt).payload)).snapshot;
    expect(frame.hasVoted).toBe(true);
    expect(frame.points).toBeUndefined();
    await expect(guest.getByText("Answer received")).toBeVisible();
    await mobile.setOffline(true);
    await expect(guest.getByRole("status")).toHaveText(
      "Reconnecting to the lobby",
    );
    const reconnecting = nextSocket(guest);
    await mobile.setOffline(false);
    const reconnected = await reconnecting;
    const recovered = JSON.parse(
      String((await reconnected.waitForEvent("framereceived")).payload),
    ).snapshot;
    expect(recovered.question.closesAt).toBe(opened.question.closesAt);
    expect(recovered.hasVoted).toBe(true);
    expect(recovered.points).toBeUndefined();
    expect(
      sql(
        `SELECT points, rule_version FROM public.live_game_attempts WHERE session_id = '${opened.id}'`,
      ),
    ).toBe("1000|accuracy_v1");
  } finally {
    await mobile.close();
  }
});
