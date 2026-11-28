import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { createLiveQuiz } from "../../apps/api/live-quiz.ts";

test("University presenters require a common HTTPS origin for HTTP and WebSockets", () => {
  const pool = {} as Pool;
  const fixtureKey = "synthetic-disposable-session-pin-key";
  const origin = "https://university.example.test";
  assert.throws(
    () =>
      createLiveQuiz(
        pool,
        fixtureKey,
        "https://different.example.test",
        false,
        origin,
      ),
    /must match the University browser origin/,
  );
  assert.doesNotThrow(() =>
    createLiveQuiz(pool, fixtureKey, undefined, false, origin),
  );
});
