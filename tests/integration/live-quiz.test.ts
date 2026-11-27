import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import WebSocket from "ws";
import { liveQuizFixture } from "../fixtures/live-quiz.ts";

test("live poll admission binds host, quiz version and participant capability to a persisted room", async () => {
  const { api, sql, owner, outsider, quizVersionId } = await liveQuizFixture();
  const body = { quizVersionId, mode: "live_poll" };
  assert.equal((await api("/live-sessions", "POST", body)).status, 401);
  assert.equal(
    (await api("/live-sessions", "POST", body, outsider)).status,
    403,
  );
  assert.equal(
    (
      await api(
        "/live-sessions",
        "POST",
        { ...body, quizVersionId: randomUUID() },
        owner,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await api(
        "/live-sessions",
        "POST",
        { ...body, mode: "formal_assessment" },
        owner,
      )
    ).status,
    400,
  );
  const created = await api("/live-sessions", "POST", body, owner);
  assert.equal(created.status, 201);
  const { id, pin, revision, state } = await created.json();
  assert.match(pin, /^[0-9]{8}$/);
  assert.equal(revision, 1);
  assert.equal(state, "lobby");

  const wrong = await api("/live-sessions/join", "POST", {
    pin: pin === "00000000" ? "11111111" : "00000000",
  });
  assert.equal(wrong.status, 403);
  const joined = await api("/live-sessions/join", "POST", { pin });
  assert.equal(joined.status, 200);
  const { snapshot, participantToken } = await joined.json();
  assert.deepEqual(snapshot, {
    id,
    state: "lobby",
    mode: "live_poll",
    revision: 1,
  });
  assert.match(participantToken, /^[A-Za-z0-9_-]{43}$/);
  const proof = "Participant " + participantToken;
  const other = await api("/live-sessions", "POST", body, owner);
  assert.equal(other.status, 201);
  const { id: otherId } = await other.json();
  assert.equal(
    (await api("/live-sessions/" + otherId, "GET", undefined, proof)).status,
    403,
  );
  assert.equal(
    (await api("/live-sessions/" + id, "GET", undefined, outsider)).status,
    403,
  );
  const available = await api("/live-sessions/" + id, "GET", undefined, proof);
  assert.equal(available.status, 200);
  assert.deepEqual(await available.json(), snapshot);

  assert.equal(
    sql(`
    SELECT quiz_version_id, octet_length(pin_hash),
           (SELECT count(*) FROM public.live_participants
            WHERE session_id = '${id}' AND octet_length(token_hash) = 32)
    FROM public.live_sessions WHERE id = '${id}'
  `),
    quizVersionId + "|32|1",
  );
  assert.equal(
    sql(`
    SET ROLE helpinsights_runtime;
    SELECT has_table_privilege('public.live_participants', 'SELECT'),
           has_table_privilege('public.live_sessions', 'UPDATE')
  `),
    "f|f",
  );
  sql(
    `UPDATE public.live_sessions SET pin_expires_at = now() - interval '1 second' WHERE id = '${id}'`,
  );
  sql("UPDATE public.live_join_budget SET started_at = now(), attempts = 120");
  const limited = await api("/live-sessions/join", "POST", { pin });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  sql(
    "UPDATE public.live_join_budget SET started_at = now() - interval '1 minute'",
  );
  const expired = await api("/live-sessions/join", "POST", { pin });
  assert.equal(expired.status, 403);
  assert.equal((await expired.json()).code, (await wrong.json()).code);
  assert.equal(
    (await api("/live-sessions/" + id, "GET", undefined, proof)).status,
    200,
  );
});

function socketSnapshot(
  base: string,
  room: string,
  authorization: string,
  origin = base,
) {
  const url = new URL("/api/v1/live-sessions/" + room + "/socket", base);
  url.protocol = "ws:";
  return new Promise<{ code: number; frame: unknown }>((resolve, reject) => {
    let frame: unknown;
    const socket = new WebSocket(url, { origin, handshakeTimeout: 5000 });
    socket.once("open", () => socket.send(JSON.stringify({ authorization })));
    socket.once("error", reject);
    socket.once("message", (message) => {
      try {
        frame = JSON.parse(message.toString());
      } catch (error) {
        reject(error);
      }
    });
    socket.once("close", (code) => resolve({ code, frame }));
  });
}

test(
  "presenter and participant WebSocket credentials recover the same lobby after the app restarts",
  { timeout: 45_000 },
  async () => {
    const { api, stack, owner, outsider, quizVersionId } =
      await liveQuizFixture();
    const opened = await api(
      "/live-sessions",
      "POST",
      { quizVersionId, mode: "live_poll" },
      owner,
    );
    assert.equal(opened.status, 201);
    const { id, pin } = await opened.json();
    const joined = await api("/live-sessions/join", "POST", { pin });
    assert.equal(joined.status, 200);
    const { participantToken, snapshot } = await joined.json();

    const before = stack.baseUrl();
    const guest = "Participant " + participantToken;
    const expectedHost = {
      code: 1000,
      frame: { type: "snapshot", snapshot: { ...snapshot, quizVersionId } },
    };
    const expectedGuest = { code: 1000, frame: { type: "snapshot", snapshot } };
    assert.deepEqual(await socketSnapshot(before, id, owner), expectedHost);
    assert.deepEqual(await socketSnapshot(before, id, guest), expectedGuest);
    assert.deepEqual(await socketSnapshot(before, id, outsider), {
      code: 1008,
      frame: undefined,
    });
    await assert.rejects(
      socketSnapshot(before, id, owner, "http://127.0.0.1:1"),
      /Unexpected server response: 403/,
    );

    stack.compose("restart", "app");
    stack.compose("up", "-d", "--wait", "--wait-timeout", "25", "app");
    // Docker can allocate a new ephemeral host port when restarting the app.
    const after = stack.baseUrl();
    assert.deepEqual(await socketSnapshot(after, id, owner), expectedHost);
    assert.deepEqual(await socketSnapshot(after, id, guest), expectedGuest);
  },
);
