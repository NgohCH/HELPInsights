import assert from "node:assert/strict";
import test from "node:test";
import { liveQuizFixture } from "../fixtures/live-quiz.ts";

test("the host owns a durable revision-checked transition sequence", async () => {
  const { api, owner, outsider, quizVersionId, sql } = await liveQuizFixture();
  const opened = await api(
    "/live-sessions",
    "POST",
    { quizVersionId, mode: "live_poll" },
    owner,
  );
  assert.equal(opened.status, 201);
  const { id, pin } = await opened.json();
  const path = "/live-sessions/" + id;
  const command = (name: string, revision: number, authorization?: string) =>
    api(
      path + "/commands",
      "POST",
      { command: name, expectedRevision: String(revision) },
      authorization,
    );

  assert.equal((await command("start", 1)).status, 401);
  assert.equal((await command("start", 1, outsider)).status, 403);
  const joined = await api("/live-sessions/join", "POST", { pin });
  assert.equal(joined.status, 200);
  const guest = "Participant " + (await joined.json()).participantToken;
  assert.equal((await command("start", 1, guest)).status, 403);
  assert.equal((await command("pause", 1, owner)).status, 409);

  const race = await Promise.all([
    command("start", 1, owner),
    command("start", 1, owner),
  ]);
  assert.deepEqual(race.map((response) => response.status).sort(), [200, 409]);
  assert.equal(
    sql(`SELECT state, revision FROM public.live_sessions WHERE id = '${id}'`),
    "running|2",
  );
  assert.equal((await api("/live-sessions/join", "POST", { pin })).status, 403);
  assert.equal((await command("pause", 1, owner)).status, 409);
  for (const [action, state, revision] of [
    ["pause", "paused", 2],
    ["resume", "running", 3],
    ["end", "ended", 4],
    ["archive", "archived", 5],
  ] as const) {
    const response = await command(action, revision, owner);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      id,
      state,
      revision: revision + 1,
      mode: "live_poll",
      quizVersionId,
    });
  }
  assert.equal((await command("start", 6, owner)).status, 409);
  assert.deepEqual(await (await api(path, "GET", undefined, guest)).json(), {
    id,
    state: "archived",
    revision: 6,
    mode: "live_poll",
  });
  assert.equal(
    sql(`
    SELECT state, revision, quiz_version_id,
      (SELECT count(*) FROM public.live_participants WHERE session_id = '${id}')
    FROM public.live_sessions WHERE id = '${id}'
  `),
    "archived|6|" + quizVersionId + "|1",
  );
});
