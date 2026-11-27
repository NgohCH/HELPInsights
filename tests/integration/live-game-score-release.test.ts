import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { liveQuizFixture } from "../fixtures/live-quiz.ts";

test("only an ended Game Show host can release one private score per valid guest", async () => {
  const { api, owner, outsider, quizVersionId, sql } = await liveQuizFixture();
  async function create() {
    const response = await api(
      "/live-sessions",
      "POST",
      {
        quizVersionId,
        mode: "game_show",
        scoring: { correctOptionCode: "useful", durationSeconds: 30 },
      },
      owner,
    );
    assert.equal(response.status, 201);
    return (await response.json()) as { id: string; pin: string };
  }
  async function join(pin: string) {
    const response = await api("/live-sessions/join", "POST", { pin });
    assert.equal(response.status, 200);
    return "Participant " + (await response.json()).participantToken;
  }
  const room = await create();
  const other = await create();
  const [correct, wrong, abstained, foreign] = await Promise.all([
    join(room.pin),
    join(room.pin),
    join(room.pin),
    join(other.pin),
  ]);
  const path = "/live-sessions/" + room.id;
  const command = (
    command: string,
    expectedRevision: number,
    authorization = owner,
  ) =>
    api(
      path + "/commands",
      "POST",
      { command, expectedRevision: String(expectedRevision) },
      authorization,
    );
  const result = (authorization?: string) =>
    api(path + "/results", "GET", undefined, authorization);
  const score = (authorization: string, answer: string) =>
    api(
      path + "/answers",
      "POST",
      {
        questionId: "rating",
        openedRevision: 3,
        answer,
      },
      authorization,
      { "Idempotency-Key": randomUUID() },
    );

  assert.equal((await command("release_scores", 1)).status, 409);
  assert.equal((await result()).status, 401);
  assert.equal((await result(foreign)).status, 403);
  assert.equal((await result(owner)).status, 403);
  const privateResult = await result(correct);
  assert.equal(privateResult.status, 409);
  assert.equal(privateResult.headers.get("cache-control"), "no-store");

  assert.equal((await command("start", 1)).status, 200);
  const opened = await command("next_question", 2);
  assert.equal(opened.status, 200);
  const deadline = (await opened.json()).question.closesAt;
  assert.equal((await score(correct, "useful")).status, 200);
  assert.equal((await score(wrong, "not_useful")).status, 200);
  assert.equal((await command("release_scores", 3)).status, 409);
  assert.equal((await command("end", 3)).status, 200);
  assert.equal((await result(correct)).status, 409);
  assert.equal((await command("release_scores", 4, outsider)).status, 403);
  assert.equal((await command("release_scores", 4, correct)).status, 403);
  assert.equal((await command("release_scores", 3)).status, 409);
  const releases = await Promise.all([
    command("release_scores", 4),
    command("release_scores", 4),
  ]);
  assert.deepEqual(
    releases.map((response) => response.status).sort(),
    [200, 409],
  );
  const presenter = await releases
    .find((response) => response.status === 200)!
    .json();
  assert.equal(presenter.scoresReleased, true);
  assert.equal(presenter.revision, 5);
  assert.equal(presenter.question.closesAt, deadline);
  assert.equal(presenter.results, undefined);
  assert.equal(presenter.points, undefined);
  const guest = await (await api(path, "GET", undefined, correct)).json();
  assert.equal(guest.scoresReleased, undefined);
  assert.equal(guest.points, undefined);
  assert.equal(guest.results, undefined);

  for (const [credential, points] of [
    [correct, 1000],
    [wrong, 0],
  ] as const) {
    const response = await result(credential);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { points });
  }
  assert.equal((await result(abstained)).status, 404);
  assert.equal((await result(foreign)).status, 403);
  assert.equal((await result(owner)).status, 403);
  assert.equal(
    sql(`
    SELECT (r.scores_released_at IS NOT NULL), count(a.participant_id)
    FROM public.live_game_rules r JOIN public.live_game_attempts a ON a.session_id = r.session_id
    WHERE r.session_id = '${room.id}' GROUP BY r.scores_released_at
  `),
    "t|2",
  );
  const hadConsent =
    sql(
      "SELECT to_regclass('public.research_consent_versions') IS NOT NULL",
    ) === "t";
  try {
    if (!hadConsent)
      sql(`CREATE TABLE public.research_consent_versions (
        survey_version_id uuid PRIMARY KEY, study_key text NOT NULL,
        revision integer NOT NULL, notice text NOT NULL
      )`);
    sql(`INSERT INTO public.research_consent_versions(survey_version_id, study_key, revision, notice)
       VALUES ('${quizVersionId}', 'synthetic-consent-study', 1, 'Synthetic consent fixture')`);
    assert.equal((await result(correct)).status, 403);
    assert.equal((await command("release_scores", 5)).status, 403);
  } finally {
    if (hadConsent)
      sql(
        `DELETE FROM public.research_consent_versions WHERE survey_version_id = '${quizVersionId}'`,
      );
    else sql("DROP TABLE public.research_consent_versions");
  }
  assert.equal((await command("release_scores", 5)).status, 409);
  assert.equal((await command("archive", 5)).status, 200);
  assert.deepEqual(await (await result(correct)).json(), { points: 1000 });
  sql(
    `UPDATE public.live_participants SET expires_at = clock_timestamp() WHERE session_id = '${room.id}'`,
  );
  assert.equal((await result(correct)).status, 403);

  const sealedPath = "/live-sessions/" + other.id;
  const sealedCommand = (command: string, revision: number) =>
    api(
      sealedPath + "/commands",
      "POST",
      {
        command,
        expectedRevision: String(revision),
      },
      owner,
    );
  assert.equal((await sealedCommand("start", 1)).status, 200);
  assert.equal((await sealedCommand("next_question", 2)).status, 200);
  assert.equal(
    (
      await api(
        sealedPath + "/answers",
        "POST",
        {
          questionId: "rating",
          openedRevision: 3,
          answer: "useful",
        },
        foreign,
        { "Idempotency-Key": randomUUID() },
      )
    ).status,
    200,
  );
  assert.equal((await sealedCommand("end", 3)).status, 200);
  assert.equal((await sealedCommand("archive", 4)).status, 200);
  assert.equal((await sealedCommand("release_scores", 5)).status, 409);
  assert.equal(
    (await api(sealedPath + "/results", "GET", undefined, foreign)).status,
    409,
  );
});
