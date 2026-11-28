import { expect, test, type Page } from "@playwright/test";
import {
  choiceFollowUpTitle,
  firstLabel,
  pipingDraft,
  secondLabel,
} from "../fixtures/answer-piping.ts";
import { definition, surveyFixture } from "../fixtures/survey.ts";

const liveSocket = (page: Page, room: string) =>
  page.waitForEvent("websocket", {
    predicate: (socket) =>
      socket.url().endsWith("/live-sessions/" + room + "/socket"),
  });

test("saved survey launches its immutable public version while ordinary collection remains separate", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(75_000);
  const { sql, workspace, ownerToken, outsiderToken, retentionPolicy } =
    surveyFixture();
  sql(`
    INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id)
    SELECT 'http://oidc-simulator:3002', 'unbound', user_id
    FROM public.workspace_memberships WHERE workspace_id = '${workspace}' AND role = 'owner';
  `);
  const headers = { Authorization: "Bearer " + ownerToken };
  const [workshop, feedback] = pipingDraft.pages;
  const [improvement, attendAgain] = feedback.questions;
  const singleChoice = { ...pipingDraft, pages: [workshop] };
  const compatible = {
    ...pipingDraft,
    pages: [
      workshop,
      {
        ...feedback,
        questions: [{ ...attendAgain, titleAnswerSourceId: "session" }],
      },
    ],
  };
  const created = await page.request.post("/api/v1/surveys", {
    headers,
    data: {
      workspaceId: workspace,
      retentionPolicyId: retentionPolicy,
      title: pipingDraft.title,
      privacyMode: "anonymous",
    },
  });
  expect(created.status()).toBe(201);
  const { id: survey } = await created.json();
  const endpoint = "/api/v1/surveys/" + survey;
  const save = async (etag: string, data: object) => {
    const response = await page.request.put(endpoint + "/draft", {
      headers: { ...headers, "If-Match": etag },
      data,
    });
    expect(response.status()).toBe(200);
    return response.headers().etag;
  };
  const firstRevision = await save(created.headers().etag, singleChoice);
  const firstPublication = await page.request.post(endpoint + "/publish", {
    headers: { ...headers, "If-Match": firstRevision },
    data: { eligibilityMode: "open" },
  });
  expect(firstPublication.status()).toBe(201);
  const { id: firstVersion } = await firstPublication.json();
  const secondRevision = await save(firstRevision, compatible);

  await page.goto("/");
  await page
    .getByRole("link", { name: "Sign in with University account" })
    .click();
  await page.getByRole("button", { name: "unbound", exact: true }).click();
  const list = page.getByRole("region", { name: "Workspace surveys" });
  const openDetails = list.getByRole("button", {
    name: "Open " + pipingDraft.title,
  });
  const details = list.getByRole("region", { name: "Saved survey details" });
  const poll = details.getByRole("button", { name: "Present a Live Poll" });
  const game = details.getByRole("button", { name: "Present a Game Show" });
  const openLobby = page.getByRole("button", { name: "Open live lobby" });
  const openRoom = async (version: string) => {
    const creating = page.waitForResponse(
      (response) =>
        response.url().endsWith("/live-sessions") &&
        response.request().method() === "POST",
    );
    await openLobby.click();
    const response = await creating;
    expect(response.status()).toBe(201);
    const room = await response.json();
    expect(room).toMatchObject({ quizVersionId: version, mode: "live_poll" });
    return room.id as string;
  };

  await openDetails.click();
  await expect(poll).toBeVisible();
  await expect(game).toBeVisible();
  await game.click();
  await expect(page.getByLabel("Correct answer").locator("option")).toHaveText([
    "Choose an answer",
    firstLabel,
    secondLabel,
  ]);
  await page.getByRole("button", { name: "Return to survey" }).click();
  await expect(game).toBeFocused();
  await poll.click();
  const firstRoom = await openRoom(firstVersion);
  await expect(
    page.getByRole("heading", { name: "Live Poll lobby" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start live poll" }).click();
  await expect(
    page.getByRole("heading", { name: "Live Poll running" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Return to survey" }).click();
  await expect(poll).toBeFocused();

  await details.getByRole("button", { name: "Publish saved draft" }).click();
  const audience = details.getByRole("combobox", {
    name: "Audience",
    exact: true,
  });
  await expect(audience).toHaveValue("");
  await audience.selectOption("open");
  const publishing = page.waitForResponse(
    (response) =>
      response.url().endsWith(endpoint + "/publish") &&
      response.request().method() === "POST",
  );
  const publishedOnServer = Promise.withResolvers<void>();
  const releasePublication = Promise.withResolvers<void>();
  await page.route(endpoint + "/publish", async (route) => {
    const response = await route.fetch();
    publishedOnServer.resolve();
    await releasePublication.promise;
    await route.fulfill({ response });
  });
  try {
    await details.getByRole("button", { name: "Publish version" }).click();
    await publishedOnServer.promise;
    await expect(poll).toBeDisabled();
    await expect(game).toBeDisabled();
  } finally {
    releasePublication.resolve();
  }
  const publication = await publishing;
  expect(publication.status()).toBe(201);
  const { id: version } = await publication.json();
  const link = details.getByRole("link", { name: "Open new respondent link" });
  await expect(link).toBeVisible();
  const respondentPath = (await link.getAttribute("href"))!;

  const mobile = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const guest = await mobile.newPage();
    await guest.goto(respondentPath);
    await guest.getByRole("radio", { name: secondLabel, exact: true }).check();
    const followUp = guest.getByRole("group", {
      name: choiceFollowUpTitle + " — " + secondLabel + " Required",
      exact: true,
    });
    await followUp.getByRole("radio", { name: "Yes", exact: true }).check();
    await guest.getByRole("button", { name: "Submit response" }).click();
    await expect(guest.getByRole("status")).toHaveText("Response submitted");

    await save(secondRevision, {
      ...compatible,
      pages: [workshop, { ...feedback, questions: [improvement] }],
    });
    await details.getByRole("button", { name: "Reload saved survey" }).click();
    await expect(poll).toBeEnabled();
    await expect(game).toHaveCount(0);
    const checkedFirstRoom = page.waitForResponse(
      (response) =>
        response.url().endsWith("/live-sessions/" + firstRoom) &&
        response.request().method() === "GET",
    );
    await poll.click();
    await expect(
      page.getByRole("heading", { name: "Live Quiz Arena" }),
    ).toBeFocused();
    await expect(page.getByLabel("Published quiz version ID")).toHaveCount(0);
    await expect(page.getByLabel("Development session token")).toHaveCount(0);
    await expect(openLobby).toBeVisible();
    await page.getByRole("button", { name: "Return to survey" }).click();
    const resume = page.getByRole("button", {
      name: "Resume live presentation",
    });
    await expect(resume).toBeVisible();
    const validatedFirstRoom = await checkedFirstRoom;
    expect(validatedFirstRoom.status()).toBe(200);
    expect(await validatedFirstRoom.json()).toMatchObject({
      id: firstRoom,
      quizVersionId: firstVersion,
      state: "running",
    });
    const reopenFirst = liveSocket(page, firstRoom);
    await resume.click();
    await reopenFirst;
    await page.getByRole("button", { name: "Pause live poll" }).click();
    await expect(
      page.getByRole("heading", { name: "Live Poll paused" }),
    ).toBeVisible();
    expect(
      sql(`SELECT count(*) FROM public.live_sessions l JOIN public.survey_versions v
           ON v.id = l.quiz_version_id WHERE v.survey_id = '${survey}'`),
    ).toBe("1");
    await page.getByRole("button", { name: "Return to survey" }).click();
    await expect(resume).toBeFocused();
    await poll.click();
    const room = await openRoom(version);
    const refused = await guest.request.post("/api/v1/live-sessions", {
      headers: { Authorization: "Bearer " + outsiderToken },
      data: { quizVersionId: version, surveyId: survey, mode: "live_poll" },
    });
    expect(refused.status()).toBe(403);
    const pin = page.getByLabel("Join PIN");
    await expect(pin).toHaveText(/^[0-9]{8}$/);
    await guest.goto("/live/join");
    await guest.getByLabel("Join PIN").fill(await pin.innerText());
    const connecting = liveSocket(guest, room);
    await guest.getByRole("button", { name: "Join live lobby" }).click();
    const guestSocket = await connecting;
    await expect(
      guest.getByRole("heading", { name: "Live Poll lobby" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start live poll" }).click();
    await page.getByRole("button", { name: "Open first question" }).click();
    await guest.getByRole("radio", { name: secondLabel, exact: true }).check();
    await guest.getByRole("button", { name: "Submit vote" }).click();
    await expect(guest.getByText("Vote received")).toBeVisible();
    await page.getByRole("button", { name: "Close question" }).click();
    const nextQuestion = guestSocket.waitForEvent("framereceived", {
      predicate: ({ payload }) =>
        JSON.parse(String(payload)).snapshot?.question?.id === "attend_again",
    });
    await page.getByRole("button", { name: "Next question" }).click();
    expect(
      JSON.parse(String((await nextQuestion).payload)).snapshot.question.title,
    ).toBe(choiceFollowUpTitle);
    await expect(
      guest.getByText(choiceFollowUpTitle, { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Return to survey" }).click();
    await expect(poll).toBeFocused();
    await expect(resume).toHaveCount(0);
    expect(await page.evaluate(() => Object.values(sessionStorage))).toEqual([
      room,
    ]);
    await details
      .getByRole("button", { name: "End response collection" })
      .click();
    await details
      .getByRole("button", { name: "Confirm end of collection" })
      .click();
    await expect(details.getByRole("status")).toHaveText(
      "Response collection ended",
    );
    await expect(poll).toHaveCount(0);
    const closedLink = await mobile.newPage();
    await closedLink.goto(respondentPath);
    await expect(closedLink.getByRole("alert")).toBeVisible();
    await expect(
      closedLink.getByRole("button", { name: "Submit response" }),
    ).toHaveCount(0);

    await page.reload();
    await expect(resume).toBeVisible();
    const recovering = liveSocket(page, room);
    await resume.click();
    await recovering;
    const paused = guestSocket.waitForEvent("framereceived", {
      predicate: ({ payload }) => {
        const { snapshot } = JSON.parse(String(payload));
        return snapshot?.id === room && snapshot.state === "paused";
      },
    });
    await page.getByRole("button", { name: "Pause live poll" }).click();
    await paused;
    await expect(
      guest.getByRole("heading", { name: "Live Poll paused" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Return to survey" }).click();
    await openDetails.click();
    const reporting = page.waitForResponse(
      (response) =>
        response.url().includes(endpoint + "/analytics?") &&
        response.request().method() === "GET",
    );
    await details.getByRole("button", { name: "View results" }).click();
    expect(await (await reporting).json()).toMatchObject({
      surveyVersionId: version,
      responseCount: 1,
    });
    await expect(
      details.getByText("1 response", { exact: true }),
    ).toBeVisible();
    expect(
      sql(`SELECT s.status, l.quiz_version_id, v.version,
          (SELECT count(*) FROM public.responses r WHERE r.survey_version_id = v.id),
          (SELECT count(*) FROM public.live_poll_votes p WHERE p.session_id = l.id)
        FROM public.live_sessions l JOIN public.survey_versions v ON v.id = l.quiz_version_id
        JOIN public.surveys s ON s.id = v.survey_id WHERE l.id = '${room}'`),
    ).toBe("closed|" + version + "|2|1|1");
  } finally {
    await mobile.close();
    sql(`DELETE FROM public.institutional_principal_bindings
      WHERE issuer = 'http://oidc-simulator:3002' AND subject = 'unbound'
        AND user_id IN (SELECT user_id FROM public.workspace_memberships
                        WHERE workspace_id = '${workspace}' AND role = 'owner')`);
  }
});

test("a fast return to the original publication still offers recovery of its displaced room", async ({
  page,
}) => {
  const { sql, workspace, ownerToken, retentionPolicy } = surveyFixture();
  const subject = "unbound";
  const headers = { Authorization: "Bearer " + ownerToken };
  const titles = ["Synthetic room switch A", "Synthetic room switch B"];
  for (const title of titles) {
    const created = await page.request.post("/api/v1/surveys", {
      headers,
      data: {
        workspaceId: workspace,
        retentionPolicyId: retentionPolicy,
        title,
        privacyMode: "anonymous",
      },
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    const endpoint = "/api/v1/surveys/" + id;
    const saved = await page.request.put(endpoint + "/draft", {
      headers: { ...headers, "If-Match": created.headers().etag },
      data: { ...definition, title },
    });
    expect(saved.status()).toBe(200);
    const publication = await page.request.post(endpoint + "/publish", {
      headers: { ...headers, "If-Match": saved.headers().etag },
      data: { eligibilityMode: "open" },
    });
    expect(publication.status()).toBe(201);
  }
  sql(`
    INSERT INTO public.institutional_principal_bindings (issuer, subject, user_id)
    SELECT 'http://oidc-simulator:3002', '${subject}', user_id
    FROM public.workspace_memberships WHERE workspace_id = '${workspace}' AND role = 'owner';
  `);
  try {
    await page.goto("/");
    await page
      .getByRole("link", { name: "Sign in with University account" })
      .click();
    await page.getByRole("button", { name: subject, exact: true }).click();
    const list = page.getByRole("region", { name: "Workspace surveys" });
    const details = list.getByRole("region", { name: "Saved survey details" });
    const present = async (title: string) => {
      await list.getByRole("button", { name: "Open " + title }).click();
      await details
        .getByRole("button", { name: "Present a Live Poll" })
        .click();
    };
    const openLobby = page.getByRole("button", { name: "Open live lobby" });
    const returnToSurvey = page.getByRole("button", {
      name: "Return to survey",
    });
    await present(titles[0]);
    const creating = page.waitForResponse(
      (response) =>
        response.url().endsWith("/live-sessions") &&
        response.request().method() === "POST",
    );
    await openLobby.click();
    const created = await creating;
    expect(created.status()).toBe(201);
    const room = await created.json();
    await page.getByRole("button", { name: "Start live poll" }).click();
    await expect(
      page.getByRole("heading", { name: "Live Poll running" }),
    ).toBeVisible();
    await returnToSurvey.click();

    const responseReady = Promise.withResolvers<number>();
    const releaseSnapshot = Promise.withResolvers<void>();
    await page.route("**/api/v1/live-sessions/" + room.id, async (route) => {
      const response = await route.fetch();
      responseReady.resolve(response.status());
      await releaseSnapshot.promise;
      await route.fulfill({ response });
    });
    try {
      await present(titles[1]);
      expect(await responseReady.promise).toBe(200);
      await returnToSurvey.click();
      await present(titles[0]);
      await expect(openLobby).toBeVisible();
      await returnToSurvey.click();
    } finally {
      releaseSnapshot.resolve();
    }

    const resume = page.getByRole("button", {
      name: "Resume live presentation",
    });
    await expect(resume).toBeVisible();
    const connecting = liveSocket(page, room.id);
    await resume.click();
    await connecting;
    await page.getByRole("button", { name: "Pause live poll" }).click();
    await expect(
      page.getByRole("heading", { name: "Live Poll paused" }),
    ).toBeVisible();
    expect(
      sql(
        `SELECT id, state FROM public.live_sessions l WHERE l.quiz_version_id = '${room.quizVersionId}'`,
      ),
    ).toBe(room.id + "|paused");
  } finally {
    sql(`DELETE FROM public.institutional_principal_bindings
      WHERE issuer = 'http://oidc-simulator:3002' AND subject = '${subject}'
        AND user_id IN (SELECT user_id FROM public.workspace_memberships
                        WHERE workspace_id = '${workspace}' AND role = 'owner')`);
  }
});
