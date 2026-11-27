import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { liveQuizFixture } from "../fixtures/live-quiz.ts";

test("Game Show uses a private version-pinned rule and PostgreSQL time to score one attempt", async () => {
  const { api, owner, outsider, quizVersionId, sql } = await liveQuizFixture();
  const malformed = await api(
    "/live-sessions",
    "POST",
    {
      quizVersionId,
      mode: "game_show",
      scoring: { correctOptionCode: "unknown", durationSeconds: 30 },
    },
    owner,
  );
  assert.equal(malformed.status, 400);
  assert.equal(
    sql(
      `SELECT count(*) FROM public.live_sessions WHERE quiz_version_id = '${quizVersionId}'`,
    ),
    "0",
  );
  const created = await api(
    "/live-sessions",
    "POST",
    {
      quizVersionId,
      mode: "game_show",
      scoring: { correctOptionCode: "useful", durationSeconds: 30 },
    },
    owner,
  );
  assert.equal(created.status, 201);
  const lobby = await created.json();
  const { id, pin } = lobby;
  assert.equal(lobby.mode, "game_show");
  assert.equal(lobby.scoring, undefined);
  const path = "/live-sessions/" + id;
  const addGuest = async () => {
    const response = await api("/live-sessions/join", "POST", { pin });
    assert.equal(response.status, 200);
    return "Participant " + (await response.json()).participantToken;
  };
  const [correct, incorrect, late] = await Promise.all([
    addGuest(),
    addGuest(),
    addGuest(),
  ]);
  const command = (command: string, expectedRevision: number) =>
    api(
      path + "/commands",
      "POST",
      { command, expectedRevision: String(expectedRevision) },
      owner,
    );
  const answer = (
    authorization: string,
    key: string,
    openedRevision: number,
    answer = "useful",
    extra = {},
  ) =>
    api(
      path + "/answers",
      "POST",
      {
        questionId: "rating",
        answer,
        openedRevision,
        ...extra,
      },
      authorization,
      { "Idempotency-Key": key },
    );

  assert.equal((await command("start", 1)).status, 200);
  const opened = await command("next_question", 2);
  assert.equal(opened.status, 200);
  const openedState = await opened.json();
  const deadline = openedState.question.closesAt;
  assert.match(deadline, /^\d{4}-\d\d-\d\dT/);
  assert.equal(openedState.question.open, true);
  assert.equal(openedState.results, undefined);
  assert.equal(openedState.scoring, undefined);
  assert.equal(
    (
      await answer(correct, randomUUID(), 3, "useful", {
        clientTimestamp: deadline,
      })
    ).status,
    400,
  );
  assert.equal(
    (await answer(correct, randomUUID(), 3, "useful", { points: 99999 }))
      .status,
    400,
  );
  assert.equal((await answer(outsider, randomUUID(), 3)).status, 403);
  assert.equal((await command("pause", 3)).status, 200);
  assert.equal((await answer(correct, randomUUID(), 3)).status, 409);
  const resumed = await command("resume", 4);
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).question.closesAt, deadline);
  assert.equal((await answer(correct, randomUUID(), 3)).status, 409);

  const key = randomUUID();
  const [first, repeat] = await Promise.all([
    answer(correct, key, 5),
    answer(correct, key, 5),
  ]);
  assert.equal(first.status, 200);
  assert.equal(repeat.status, 200);
  const receipt = await first.json();
  assert.deepEqual(await repeat.json(), receipt);
  assert.deepEqual(Object.keys(receipt).sort(), ["acceptedAt", "questionId"]);
  assert.equal((await answer(correct, key, 5, "not_useful")).status, 409);
  assert.equal((await answer(correct, randomUUID(), 5)).status, 409);
  assert.equal(
    (await answer(incorrect, randomUUID(), 5, "not_useful")).status,
    200,
  );

  assert.equal(
    sql(`
    SELECT option_code, points, rule_version, quiz_version_id
    FROM public.live_game_attempts WHERE session_id = '${id}' ORDER BY points DESC
  `),
    "useful|1000|accuracy_v1|" +
      quizVersionId +
      "\nnot_useful|0|accuracy_v1|" +
      quizVersionId,
  );
  assert.equal(
    sql(`
    SELECT bool_and(a.accepted_at >= r.opened_at AND a.accepted_at < r.deadline_at),
      extract(epoch FROM (max(r.deadline_at) - min(r.opened_at)))::integer
    FROM public.live_game_attempts a JOIN public.live_game_rules r ON r.session_id = a.session_id
    WHERE a.session_id = '${id}'
  `),
    "t|30",
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM public.live_poll_votes WHERE session_id = '${id}'`,
    ),
    "0",
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM public.responses WHERE survey_version_id = '${quizVersionId}'`,
    ),
    "0",
  );
  assert.equal(
    sql(`
    SET ROLE helpinsights_runtime;
    SELECT has_table_privilege('public.live_game_attempts', 'SELECT'),
      has_table_privilege('public.live_game_rules', 'SELECT')
  `),
    "f|f",
  );

  sql(
    `UPDATE public.live_game_rules SET opened_at = clock_timestamp() - interval '31 seconds', deadline_at = clock_timestamp() - interval '1 second' WHERE session_id = '${id}'`,
  );
  assert.equal((await answer(late, randomUUID(), 5)).status, 409);
  const current = await (await api(path, "GET", undefined, correct)).json();
  assert.equal(current.hasVoted, true);
  assert.equal(current.question.open, false);
  assert.equal(current.question.correctOptionCode, undefined);
  assert.equal(current.points, undefined);
  assert.equal((await command("end", 5)).status, 200);
  assert.deepEqual(await (await answer(correct, key, 5)).json(), receipt);
});

test("Registry-restricted versions cannot be launched as anonymous Live Quiz rooms", async () => {
  const { api, owner, sql, quizVersionId } = await liveQuizFixture();
  const hadEligibility =
    sql(`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'distributions' AND column_name = 'eligibility_mode')
  `) === "t";
  try {
    if (!hadEligibility)
      sql(
        "ALTER TABLE public.distributions ADD COLUMN eligibility_mode text NOT NULL DEFAULT 'open'",
      );
    sql(
      `UPDATE public.distributions SET eligibility_mode = 'registry-synthetic' WHERE survey_version_id = '${quizVersionId}'`,
    );
    const result = await api(
      "/live-sessions",
      "POST",
      { quizVersionId, mode: "live_poll" },
      owner,
    );
    assert.equal(result.status, 403);
    const proof = createHash("sha256")
      .update(owner.slice("Bearer ".length))
      .digest("hex");
    const actor = sql(
      `SELECT user_id FROM public.sessions WHERE token_hash = decode('${proof}', 'hex')`,
    );
    sql(`
      SET ROLE helpinsights_runtime;
      SELECT set_config('helpinsights.actor_id', '${actor}', false);
      DO $$
      BEGIN
        INSERT INTO public.live_sessions(quiz_version_id, host_id, mode, pin_hash)
        VALUES ('${quizVersionId}', '${actor}', 'live_poll', decode(repeat('03', 32), 'hex'));
        RAISE EXCEPTION 'The runtime role bypassed restricted eligibility';
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END
      $$;
    `);
    assert.equal(
      sql(
        `SELECT count(*) FROM public.live_sessions WHERE quiz_version_id = '${quizVersionId}'`,
      ),
      "0",
    );
  } finally {
    if (!hadEligibility)
      sql("ALTER TABLE public.distributions DROP COLUMN eligibility_mode");
  }
});

test("a consent-required published version cannot bypass consent through either live mode", async () => {
  const { api, owner, sql, quizVersionId } = await liveQuizFixture();
  const hadConsent =
    sql(
      "SELECT to_regclass('public.research_consent_versions') IS NOT NULL",
    ) === "t";
  try {
    if (!hadConsent)
      sql(`
        CREATE TABLE public.research_consent_versions (
          survey_version_id uuid PRIMARY KEY REFERENCES public.distributions(survey_version_id),
          study_key text NOT NULL, revision integer NOT NULL, notice text NOT NULL
        )
      `);
    sql(`
      INSERT INTO public.research_consent_versions (survey_version_id, study_key, revision, notice)
      VALUES ('${quizVersionId}', 'synthetic-consent-study', 1, 'Synthetic consent fixture')
    `);
    assert.equal(
      (
        await api(
          "/live-sessions",
          "POST",
          { quizVersionId, mode: "live_poll" },
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
          {
            quizVersionId,
            mode: "game_show",
            scoring: { correctOptionCode: "useful", durationSeconds: 30 },
          },
          owner,
        )
      ).status,
      403,
    );
    assert.equal(
      sql(
        `SELECT count(*) FROM public.live_sessions WHERE quiz_version_id = '${quizVersionId}'`,
      ),
      "0",
    );
  } finally {
    if (!hadConsent) sql("DROP TABLE public.research_consent_versions");
  }
});
