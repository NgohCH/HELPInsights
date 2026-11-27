import assert from "node:assert/strict";
import test from "node:test";
import { runningTestStack } from "../../scripts/test-docker.ts";
import { registryFixture } from "../fixtures/registry.ts";

test("invalid mixed publication is rejected even with both optional services disabled", async () => {
  const { id, headers } = await registryFixture().createDraft();
  const previous = process.env.HELPINSIGHTS_TEST_SESSION;
  process.env.HELPINSIGHTS_TEST_SESSION = headers.Authorization.slice(
    "Bearer ".length,
  );
  try {
    const result = runningTestStack().compose(
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
      import { once } from "node:events";
      import pg from "pg";
      import { createApplication } from "./apps/api/application.ts";
      import { surveyRoutes } from "./apps/api/surveys.ts";
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      const server = createApplication(async () => true, surveyRoutes(pool));
      try {
        const listening = once(server, "listening");
        server.listen(0, "127.0.0.1");
        await listening;
        const url = "http://127.0.0.1:" + server.address().port +
          "/api/v1/surveys/" + process.argv[1] + "/publish";
        const publish = (body) => fetch(url, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + process.env.HELPINSIGHTS_TEST_SESSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5_000),
        });
        const mixed = await publish({
          eligibilityMode: "registry-synthetic",
          researchConsent: "synthetic",
        });
        assert.equal(mixed.status, 400);
        assert.equal((await mixed.json()).message, "Choose one synthetic survey restriction");
        assert.equal((await publish({ eligibilityMode: "registry-synthetic" })).status, 503);
        assert.equal((await publish({ researchConsent: "synthetic" })).status, 503);
        assert.equal((await publish({})).status, 201);
        console.log("Default survey route rejected mixed restrictions and published an open survey");
      } finally {
        server.close();
        await pool.end();
      }
      `,
      id,
    );
    assert.match(result, /Default survey route rejected mixed restrictions/);
  } finally {
    if (previous === undefined) delete process.env.HELPINSIGHTS_TEST_SESSION;
    else process.env.HELPINSIGHTS_TEST_SESSION = previous;
  }
});
