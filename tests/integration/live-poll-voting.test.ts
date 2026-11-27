import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import WebSocket from "ws";
import { livePollFixture, pollDefinition } from "../fixtures/live-poll.ts";
import { liveQuizFixture } from "../fixtures/live-quiz.ts";

test("scoped idempotent ballots target the current open immutable question", async () => {
  const { api, owner, outsider, path, id, join, command, sql, quizVersionId } =
    await livePollFixture();
  const guest = await join();
  const waiting = await join();
  const unrelated = await api(
    "/live-sessions",
    "POST",
    { quizVersionId, mode: "live_poll" },
    owner,
  );
  assert.equal(unrelated.status, 201);
  const overseasJoin = await api("/live-sessions/join", "POST", {
    pin: (await unrelated.json()).pin,
  });
  assert.equal(overseasJoin.status, 200);
  const foreignGuest =
    "Participant " + (await overseasJoin.json()).participantToken;
  const original = randomUUID();
  const ballot = (
    authorization: string,
    key: string,
    openedRevision: number,
    answer = "useful",
    questionId = "rating",
  ) =>
    api(
      path + "/answers",
      "POST",
      { questionId, answer, openedRevision },
      authorization,
      { "Idempotency-Key": key },
    );

  assert.equal((await ballot(outsider, original, 1)).status, 403);
  assert.equal((await ballot(foreignGuest, original, 1)).status, 403);
  assert.equal((await ballot(guest, original, 1)).status, 409);
  assert.equal((await command("start", 1)).status, 200);
  const opened = await command("next_question", 2);
  assert.equal(opened.status, 200);
  const open = await opened.json();
  assert.deepEqual(open.question, {
    id: "rating",
    title: "How useful was the workshop?",
    openedRevision: 3,
    open: true,
    options: [
      { code: "useful", label: "Useful" },
      { code: "not_useful", label: "Not useful" },
    ],
  });
  assert.equal(open.results, null);
  assert.equal(open.turnout, null);
  assert.equal(open.hasNextQuestion, true);
  assert.equal((await ballot(guest, original, 3, "invalid")).status, 422);
  const [accepted, retried] = await Promise.all([
    ballot(guest, original, 3),
    ballot(guest, original, 3),
  ]);
  assert.equal(accepted.status, 200);
  const receipt = await accepted.json();
  assert.equal(retried.status, 200);
  assert.deepEqual(await retried.json(), receipt);
  assert.match(receipt.acceptedAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(await (await ballot(guest, original, 3)).json(), receipt);
  assert.equal((await ballot(guest, original, 3, "not_useful")).status, 409);
  assert.equal((await ballot(guest, randomUUID(), 3)).status, 409);
  const own = await (await api(path, "GET", undefined, guest)).json();
  assert.equal(own.hasVoted, true);
  assert.equal(own.results, undefined);
  assert.equal(
    (await (await api(path, "GET", undefined, waiting)).json()).hasVoted,
    false,
  );

  assert.equal((await command("pause", 3)).status, 200);
  assert.equal((await ballot(waiting, randomUUID(), 3)).status, 409);
  assert.deepEqual(await (await ballot(guest, original, 3)).json(), receipt);
  const resumed = await command("resume", 4);
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).question.openedRevision, 5);
  assert.equal((await ballot(waiting, randomUUID(), 3)).status, 409);

  const advanced = await command("next_question", 5);
  assert.equal(advanced.status, 200);
  const next = await advanced.json();
  assert.equal(next.question.id, "venue");
  assert.equal(next.hasNextQuestion, false);
  assert.equal((await ballot(waiting, randomUUID(), 6)).status, 409);
  assert.equal(
    (await ballot(guest, original, 6, "useful", "venue")).status,
    409,
  );
  assert.equal(
    (await ballot(guest, randomUUID(), 6, "not_useful", "venue")).status,
    200,
  );
  assert.equal((await command("next_question", 6)).status, 409);
  assert.equal((await command("end", 6)).status, 200);
  assert.equal(
    (await ballot(waiting, randomUUID(), 6, "useful", "venue")).status,
    409,
  );
  assert.equal(
    sql(`
    SELECT question_id, option_code, count(*) FROM public.live_poll_votes
    WHERE session_id = '${id}' GROUP BY 1, 2 ORDER BY 1
  `),
    "rating|useful|1\nvenue|not_useful|1",
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM public.responses WHERE survey_version_id = '${quizVersionId}'`,
    ),
    "0",
  );
  assert.equal(
    sql(
      `SET ROLE helpinsights_runtime; SELECT has_table_privilege('public.live_poll_votes', 'SELECT'), has_table_privilege('public.live_poll_votes', 'UPDATE')`,
    ),
    "f|f",
  );
});

function observe(base: string, id: string, authorization: string) {
  const url = new URL("/api/v1/live-sessions/" + id + "/socket", base);
  url.protocol = "ws:";
  const socket = new WebSocket(url, { origin: base, handshakeTimeout: 5000 });
  let latest: {
    state: string;
    hasVoted?: boolean;
    results?: { total: number } | null;
    turnout?: number | null;
  };
  socket.on("error", () => socket.terminate());
  socket.once("open", () => socket.send(JSON.stringify({ authorization })));
  socket.on("message", (frame) => {
    latest = JSON.parse(frame.toString()).snapshot;
  });
  return {
    close: () => socket.terminate(),
    async until(predicate: (current: NonNullable<typeof latest>) => boolean) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && socket.readyState < WebSocket.CLOSING) {
        if (latest && predicate(latest)) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.fail("Expected WebSocket snapshot did not arrive");
    },
  };
}

test(
  "50 concurrent guest capabilities persist one poll vote each and converge over real WebSockets",
  { timeout: 60_000 },
  async () => {
    const { api, id, path, owner, join, command, stack, sql } =
      await livePollFixture();
    const credentials = await Promise.all(
      Array.from({ length: 50 }, () => join()),
    );
    assert.equal(new Set(credentials).size, 50);
    const base = stack.baseUrl();
    const host = observe(base, id, owner);
    const guests = credentials.map((auth) => observe(base, id, auth));
    try {
      await Promise.all(
        [host, ...guests].map((socket) =>
          socket.until((current) => current.state === "lobby"),
        ),
      );
      assert.equal((await command("start", 1)).status, 200);
      assert.equal((await command("next_question", 2)).status, 200);
      const started = performance.now();
      const results = await Promise.all(
        credentials.map((authorization, index) =>
          api(
            path + "/answers",
            "POST",
            {
              questionId: "rating",
              answer: index % 2 === 0 ? "useful" : "not_useful",
              openedRevision: 3,
            },
            authorization,
            { "Idempotency-Key": randomUUID() },
          ),
        ),
      );
      assert.ok(results.every((response) => response.status === 200));
      const httpMs = Math.round(performance.now() - started);
      await Promise.all([
        host.until(
          (current) => current.turnout === 50 && current.results === null,
        ),
        ...guests.map((socket) =>
          socket.until(
            (current) =>
              current.hasVoted === true && current.results === undefined,
          ),
        ),
      ]);
      const convergenceMs = Math.round(performance.now() - started);
      assert.equal((await command("close_question", 3)).status, 200);
      await host.until((current) => current.results?.total === 50);
      console.log(
        "50 synthetic ballots HTTP " +
          httpMs +
          " ms, HTTP+WebSocket convergence " +
          convergenceMs +
          " ms",
      );
      assert.equal(
        sql(`
      SELECT option_code, count(*), count(DISTINCT participant_id)
      FROM public.live_poll_votes WHERE session_id = '${id}' GROUP BY 1 ORDER BY 1
    `),
        "not_useful|25|25\nuseful|25|25",
      );
      assert.equal((await command("next_question", 4)).status, 200);
      await Promise.all(
        credentials.slice(0, 6).map(async (authorization, index) => {
          const ballot = await api(
            path + "/answers",
            "POST",
            {
              questionId: "venue",
              answer: index === 0 ? "not_useful" : "useful",
              openedRevision: 5,
            },
            authorization,
            { "Idempotency-Key": randomUUID() },
          );
          assert.equal(ballot.status, 200);
        }),
      );
      const suppressed = await command("close_question", 5);
      assert.equal(suppressed.status, 200);
      const privateResults = await suppressed.json();
      assert.equal(privateResults.turnout, 5);
      assert.equal(privateResults.results, null);
      assert.equal(
        (
          await api(
            path + "/answers",
            "POST",
            {
              questionId: "venue",
              answer: "useful",
              openedRevision: 5,
            },
            credentials[6],
            { "Idempotency-Key": randomUUID() },
          )
        ).status,
        409,
      );
      const proof = createHash("sha256")
        .update(credentials[0].slice("Participant ".length))
        .digest("hex");
      assert.equal(
        sql(`
      SET ROLE helpinsights_runtime;
      SELECT public.read_live_poll_question('${id}', decode('${proof}', 'hex'), NULL) IS NULL
    `),
        "t",
      );
    } finally {
      host.close();
      guests.forEach((socket) => socket.close());
    }
  },
);

test("closed counts with a single nonvoter remain private", async () => {
  const { api, path, join, command } = await livePollFixture();
  const guests = await Promise.all(Array.from({ length: 6 }, () => join()));
  assert.equal((await command("start", 1)).status, 200);
  assert.equal((await command("next_question", 2)).status, 200);
  await Promise.all(
    guests.slice(0, 5).map(async (auth) => {
      const result = await api(
        path + "/answers",
        "POST",
        {
          questionId: "rating",
          answer: "useful",
          openedRevision: 3,
        },
        auth,
        { "Idempotency-Key": randomUUID() },
      );
      assert.equal(result.status, 200);
    }),
  );
  const closed = await command("close_question", 3);
  assert.equal(closed.status, 200);
  const snapshot = await closed.json();
  assert.equal(snapshot.question.open, false);
  assert.equal(snapshot.turnout, 5);
  assert.equal(snapshot.results, null);
});

test("published conditional survey questions cannot enter Live Poll", async () => {
  const { api, owner, quizVersionId, sql } =
    await liveQuizFixture(pollDefinition);
  // Seed the published shape expected from the conditional survey publisher.
  sql(`
    UPDATE public.survey_versions
    SET definition = jsonb_set(
      definition, '{pages,0,questions,1,visibleWhen}',
      '{"questionId":"rating","optionCode":"useful"}'::jsonb
    )
    WHERE id = '${quizVersionId}'
  `);
  const result = await api(
    "/live-sessions",
    "POST",
    {
      quizVersionId,
      mode: "live_poll",
    },
    owner,
  );
  assert.equal(result.status, 400);
  assert.equal(
    (await result.json()).message,
    "Live Poll requires questions without conditional visibility",
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM public.live_sessions WHERE quiz_version_id = '${quizVersionId}'`,
    ),
    "0",
  );
});
