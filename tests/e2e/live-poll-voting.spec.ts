import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { pollDefinition } from "../fixtures/live-poll.ts";
import { liveQuizFixture } from "../fixtures/live-quiz.ts";

const nextSocket = (page: Page) =>
  page.waitForEvent("websocket", {
    predicate: (socket) =>
      /\/live-sessions\/[\da-f-]+\/socket$/.test(socket.url()),
  });

test("presenter and mobile guest vote using existing WebSocket connections", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);
  const { api, ownerToken, quizVersionId, sql } =
    await liveQuizFixture(pollDefinition);
  await page.goto("/live/host");
  await page.getByLabel("Development session token").fill(ownerToken);
  await page.getByLabel("Published quiz version ID").fill(quizVersionId);
  const hostOpening = nextSocket(page);
  await page.getByRole("button", { name: "Open live lobby" }).click();
  const host = await hostOpening;
  const pin = await page.getByLabel("Join PIN").innerText();
  const synthetic = await Promise.all(
    Array.from({ length: 4 }, async () => {
      const result = await api("/live-sessions/join", "POST", { pin });
      expect(result.status).toBe(200);
      return "Participant " + (await result.json()).participantToken;
    }),
  );

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const guest = await mobile.newPage();
    await guest.goto("/live/join");
    await guest.getByLabel("Join PIN").fill(pin);
    const guestOpening = nextSocket(guest);
    await guest.getByRole("button", { name: "Join live lobby" }).click();
    const socket = await guestOpening;
    await expect(
      guest.getByRole("heading", { name: "Live Poll lobby" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start live poll" }).click();
    await expect(
      guest.getByRole("heading", { name: "Live Poll running" }),
    ).toBeVisible();
    const questionFrame = socket.waitForEvent("framereceived");
    await expect(
      page.getByRole("button", { name: "Open first question" }),
    ).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: "Open first question" }).click();
    const { snapshot } = JSON.parse(String((await questionFrame).payload));
    expect(snapshot.question.id).toBe("rating");
    expect(snapshot.hasVoted).toBe(false);
    await guest.getByRole("radio", { name: "Useful", exact: true }).check();
    const guestVote = socket.waitForEvent("framereceived");
    await guest.getByRole("button", { name: "Submit vote" }).click();
    const guestState = JSON.parse(String((await guestVote).payload)).snapshot;
    expect(guestState.hasVoted).toBe(true);
    expect(guestState.results).toBeUndefined();
    await expect(guest.getByText("Vote received")).toBeVisible();

    const results = host.waitForEvent("framereceived");
    await Promise.all(
      synthetic.map(async (token) => {
        const voted = await api(
          "/live-sessions/" + snapshot.id + "/answers",
          "POST",
          {
            questionId: "rating",
            answer: "useful",
            openedRevision: snapshot.question.openedRevision,
          },
          token,
          { "Idempotency-Key": randomUUID() },
        );
        expect(voted.status).toBe(200);
      }),
    );
    const turnout = JSON.parse(String((await results).payload)).snapshot;
    expect(turnout.turnout).toBe(5);
    expect(turnout.results).toBeNull();
    const closed = host.waitForEvent("framereceived");
    await page.getByRole("button", { name: "Close question" }).click();
    const presenter = JSON.parse(String((await closed).payload)).snapshot;
    expect(presenter.question.open).toBe(false);
    expect(presenter.results).toEqual({
      total: 5,
      counts: [
        { code: "useful", count: 5 },
        { code: "not_useful", count: 0 },
      ],
    });
    await expect(page.getByText("5 votes")).toBeVisible();
    await expect(guest.getByText("5 votes")).toHaveCount(0);
    expect(
      sql(
        `SELECT count(*) FROM public.live_poll_votes WHERE session_id = '${snapshot.id}'`,
      ),
    ).toBe("5");
  } finally {
    await mobile.close();
  }
});
