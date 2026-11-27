import assert from "node:assert/strict";
import test from "node:test";
import { runningTestStack } from "../../scripts/test-docker.ts";
import { surveyFixture } from "../fixtures/survey.ts";

test("PostgreSQL ending an idle checked-out transaction rejects it without killing the Node process", () => {
  const { ownerToken } = surveyFixture();
  const previous = process.env.HELPINSIGHTS_TEST_SESSION;
  process.env.HELPINSIGHTS_TEST_SESSION = ownerToken;
  try {
    const stack = runningTestStack();
    const result = stack.compose(
      "exec",
      "-T",
      "--env",
      "HELPINSIGHTS_TEST_SESSION",
      "app",
      "node",
      "--input-type=module",
      "-e",
      `
      import assert from "node:assert/strict";
      import { createHash } from "node:crypto";
      import pg from "pg";
      import { withActor } from "./apps/api/sessions.ts";
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
      pool.on("error", () => {});
      const proof = createHash("sha256").update(process.env.HELPINSIGHTS_TEST_SESSION).digest();
      let disconnected = false;
      try {
        await assert.rejects(withActor(pool, proof, async (client) => {
          const { rows: [{ pid }] } = await client.query("SELECT pg_backend_pid() AS pid");
          const ended = new Promise((resolve) => client.once("end", resolve));
          const { rows: [{ stopped }] } = await pool.query(
            "SELECT pg_terminate_backend($1) AS stopped", [pid]
          );
          if (!stopped) throw new Error("Did not terminate the fixture backend");
          const deadline = AbortSignal.timeout(5_000);
          await Promise.race([
            ended,
            new Promise((_, reject) => deadline.addEventListener(
              "abort", () => reject(new Error("Fixture backend did not disconnect")), { once: true }
            )),
          ]);
          disconnected = true;
        }));
        assert.equal(disconnected, true);
        const displayName = await withActor(pool, proof, (_client, actor) => Promise.resolve(actor.displayName));
        assert.equal(displayName, "Workshop creator");
        console.log("Disconnected transaction rejected and pool recovered");
      } finally {
        await pool.end();
      }
    `,
    );
    assert.match(
      result,
      /Disconnected transaction rejected and pool recovered/,
    );
  } finally {
    if (previous === undefined) delete process.env.HELPINSIGHTS_TEST_SESSION;
    else process.env.HELPINSIGHTS_TEST_SESSION = previous;
  }
});
