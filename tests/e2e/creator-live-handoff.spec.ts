import { expect, test } from "@playwright/test";
import { surveyFixture } from "../fixtures/survey.ts";

test("a University creator presents a published survey without pasting a credential or version ID", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const { sql, workspace, outside } = surveyFixture();
  sql(`
    INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id)
    SELECT 'http://oidc-simulator:3002', 'live-creator', user_id
    FROM public.workspace_memberships WHERE workspace_id = '${workspace}' AND role = 'owner';
    INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
    SELECT '${workspace}', user_id, 'owner'
    FROM public.workspace_memberships WHERE workspace_id = '${outside}' AND role = 'owner';
  `);
  await page.goto("/");
  await page
    .getByRole("link", { name: "Sign in with University account" })
    .click();
  await page.getByRole("button", { name: "live-creator", exact: true }).click();
  await page.getByLabel("Survey title").fill("Workshop icebreaker");
  await page
    .getByLabel("Question", { exact: true })
    .fill("Which activity comes next?");
  await page.getByLabel("Option 1", { exact: true }).fill("Discussion");
  await page.getByLabel("Option 2", { exact: true }).fill("Practice");
  await page.getByRole("button", { name: "Save draft" }).click();
  const published = page.waitForResponse(
    (response) =>
      response.url().endsWith("/publish") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Publish survey" }).click();
  const publication = await published;
  expect(publication.status()).toBe(201);
  const version = (await publication.json()).id;
  await page.getByRole("button", { name: "Present a Live Poll" }).click();
  await expect(page.getByLabel("Development session token")).toHaveCount(0);
  await expect(page.getByLabel("Published quiz version ID")).toHaveCount(0);
  await page.getByRole("button", { name: "Open live lobby" }).click();
  const wrongOrigin = await page.request.post("/api/v1/live-sessions", {
    headers: { Origin: "https://other.example.test" },
    data: {},
  });
  expect(wrongOrigin.status()).toBe(403);
  const pin = page.getByLabel("Join PIN");
  await expect(pin).toHaveText(/^[0-9]{8}$/);

  const guestContext = await browser.newContext({ baseURL });
  try {
    const guest = await guestContext.newPage();
    await guest.goto("/live/join");
    await guest.getByLabel("Join PIN").fill((await pin.innerText()).trim());
    await guest.getByRole("button", { name: "Join live lobby" }).click();
    await expect(
      guest.getByRole("heading", { name: "Live Poll lobby" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start live poll" }).click();
    await page.getByRole("button", { name: "Open first question" }).click();
    await guest.getByRole("radio", { name: "Discussion", exact: true }).check();
    await guest.getByRole("button", { name: "Submit vote" }).click();
    await expect(guest.getByText("Vote received")).toBeVisible();
    expect(
      sql(`
      SELECT count(*) FROM public.live_sessions r
      JOIN public.survey_versions v ON v.id = r.quiz_version_id
      JOIN public.surveys s ON s.id = v.survey_id
      WHERE s.workspace_id = '${workspace}'
    `),
    ).toBe("1");
  } finally {
    await guestContext.close();
  }
  await page.getByRole("button", { name: "Return to survey" }).click();
  await expect(
    page.getByRole("link", { name: "Open respondent link" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Present a Live Poll" }).click();
  await expect(
    page.getByRole("heading", { name: "Live Poll running" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "End live poll" }).click();
  await expect(
    page.getByRole("heading", { name: "Live Poll ended" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Return to survey" }).click();
  const retentionHref = await page
    .getByRole("link", { name: "Survey retention" })
    .getAttribute("href");
  if (!retentionHref) throw new Error("Survey retention link missing");
  await page.getByRole("button", { name: "Present a Game Show" }).click();
  await page.getByLabel("Correct answer").selectOption({ label: "Discussion" });
  await page.getByLabel("Answer time in seconds").fill("120");
  const createdRoom = page.waitForResponse(
    (response) =>
      response.url().endsWith("/live-sessions") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Open live lobby" }).click();
  const creation = await createdRoom;
  expect(creation.status()).toBe(201);
  const { id: room } = await creation.json();
  await expect(
    page.getByRole("heading", { name: "Game Show lobby" }),
  ).toBeVisible();
  await expect(page.getByLabel("Join PIN")).toHaveText(/^[0-9]{8}$/);
  expect(
    sql(`SELECT string_agg(mode, ',' ORDER BY mode)
    FROM public.live_sessions WHERE quiz_version_id = '${version}'`),
  ).toBe("game_show,live_poll");
  const gameGuestContext = await browser.newContext({ baseURL });
  try {
    const guest = await gameGuestContext.newPage();
    await guest.goto("/live/join");
    await guest.getByLabel("Join PIN").fill(await pin.innerText());
    const guestConnecting = guest.waitForEvent("websocket", {
      predicate: (socket) =>
        socket.url().endsWith("/live-sessions/" + room + "/socket"),
    });
    await guest.getByRole("button", { name: "Join live lobby" }).click();
    const guestSocket = await guestConnecting;
    await expect(
      guest.getByRole("heading", { name: "Game Show lobby" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start game" }).click();
    await page.getByRole("button", { name: "Open first question" }).click();
    await expect(
      guest.getByRole("radio", { name: "Discussion", exact: true }),
    ).toBeVisible();

    const checkedRoom = page.waitForResponse(
      (response) =>
        response.url().endsWith("/live-sessions/" + room) &&
        response.request().method() === "GET",
    );
    await page.reload();
    const resume = page.getByRole("button", {
      name: "Resume live presentation",
    });
    await expect(resume).toBeVisible();
    const verified = await checkedRoom;
    expect(verified.status()).toBe(200);
    expect(await verified.json()).toMatchObject({
      id: room,
      state: "running",
      revision: 3,
      quizVersionId: version,
    });
    const stored = await page.evaluate(() => Object.entries(sessionStorage));
    expect(stored).toEqual([[expect.any(String), room]]);

    const hostConnecting = page.waitForEvent("websocket", {
      predicate: (socket) =>
        socket.url().endsWith("/live-sessions/" + room + "/socket"),
    });
    await resume.click();
    const hostSocket = await hostConnecting;
    await expect(
      page.getByRole("heading", { name: "Game Show running" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Close question" }),
    ).toBeEnabled();
    await expect(page.getByText("Which activity comes next?")).toBeVisible();

    const paused = guestSocket.waitForEvent("framereceived", {
      predicate: ({ payload }) => {
        const { snapshot } = JSON.parse(String(payload));
        return snapshot?.id === room && snapshot.state === "paused";
      },
    });
    await page.getByRole("button", { name: "Pause game" }).click();
    await paused;
    expect(hostSocket.isClosed()).toBe(false);
    expect(guestSocket.isClosed()).toBe(false);
    await expect(
      guest.getByRole("heading", { name: "Game Show paused" }),
    ).toBeVisible();
    expect(
      sql(`
        SELECT state, revision, quiz_version_id,
          (SELECT count(*) FROM public.live_participants WHERE session_id = s.id)
        FROM public.live_sessions s WHERE id = '${room}'
      `),
    ).toBe("paused|4|" + version + "|1");
    expect(
      sql(`
        SELECT count(*) FROM public.live_sessions
        WHERE mode = 'game_show' AND quiz_version_id = '${version}'
      `),
    ).toBe("1");

    sql(`
      INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id)
      SELECT 'http://oidc-simulator:3002', 'unbound', user_id
      FROM public.workspace_memberships WHERE workspace_id = '${outside}' AND role = 'owner';
    `);
    const other = await gameGuestContext.newPage();
    await other.goto("/");
    const [entry] = stored;
    await other.evaluate(([key, id]) => sessionStorage.setItem(key, id), entry);
    await other.reload();
    const otherResume = other.getByRole("button", {
      name: "Resume live presentation",
    });
    expect(
      (await other.request.get("/api/v1/live-sessions/" + room)).status(),
    ).toBe(401);
    await expect(otherResume).toHaveCount(0);
    await other
      .getByRole("link", { name: "Sign in with University account" })
      .click();
    const denied = other.waitForResponse(
      (response) =>
        response.url().endsWith("/live-sessions/" + room) &&
        response.request().method() === "GET",
    );
    await other.getByRole("button", { name: "unbound", exact: true }).click();
    expect((await denied).status()).toBe(403);
    expect(
      await other.evaluate(async (roomId) => {
        const response = await fetch(
          "/api/v1/live-sessions/" + roomId + "/commands",
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command: "resume", expectedRevision: "4" }),
          },
        );
        return response.status;
      }, room),
    ).toBe(403);
    await expect(otherResume).toHaveCount(0);
    await expect(
      other.getByRole("button", { name: "Resume game" }),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        other.evaluate((key) => sessionStorage.getItem(key), entry[0]),
      )
      .toBeNull();

    await page.getByRole("button", { name: "End game" }).click();
    await expect(
      page.getByRole("heading", { name: "Game Show ended" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Return to survey" }).click();
    await expect(
      page.getByRole("heading", { name: "HELPInsights" }),
    ).toBeFocused();
    await expect(resume).toHaveCount(0);
    expect(await page.evaluate(() => Object.entries(sessionStorage))).toEqual(
      [],
    );
  } finally {
    await gameGuestContext.close();
    sql(`
      DELETE FROM public.institutional_principal_bindings
      WHERE issuer = 'http://oidc-simulator:3002' AND subject = 'unbound'
        AND user_id IN (SELECT user_id FROM public.workspace_memberships
                        WHERE workspace_id = '${outside}' AND role = 'owner');
    `);
  }
  await page.goto(retentionHref);
  const survey = sql(
    `SELECT id FROM public.surveys WHERE workspace_id = '${workspace}'`,
  );
  await expect(page.getByLabel("Survey ID")).toHaveValue(survey);
  await page.getByRole("button", { name: "Check retention" }).click();
  await expect(page.getByText("Survey is still open")).toBeVisible();
  const retentionUrl = page.url();
  await page.getByRole("link", { name: "Operations dashboard" }).click();
  await expect(page).toHaveURL("/admin");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("link", { name: "Sign in with University account" }),
  ).toBeVisible();
  await page.goto(retentionUrl);
  await page
    .getByRole("link", { name: "Sign in with University account" })
    .click();
  await page.getByRole("button", { name: "live-creator", exact: true }).click();
  await expect(page).toHaveURL(retentionUrl);
  await expect(page.getByLabel("Survey ID")).toHaveValue(survey);
});
