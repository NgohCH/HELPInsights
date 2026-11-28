import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { createApplication } from "../../apps/api/application.ts";
import { respondentRoutes } from "../../apps/api/respond.ts";

test("a University distribution hides its definition before sign-in", async (context) => {
  const pool = {
    async query() {
      return {
        rows: [
          {
            surveyVersionId: "fixture-version",
            definition: { title: "Restricted" },
            eligibilityMode: "university",
            researchConsent: null,
          },
        ],
      };
    },
  } as unknown as Pool;
  const server = createApplication(
    async () => true,
    respondentRoutes(pool, null, false, true),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const response = await fetch(
    "http://127.0.0.1:" + address.port + "/api/v1/public/s/" + "A".repeat(43),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    eligibilityRequired: true,
    eligibilityMode: "university",
  });
});

test("an ineligible browser cannot learn from restricted answer validation", async (context) => {
  const priorMode = process.env.NODE_ENV;
  const priorOrigin = process.env.HELPINSIGHTS_ENTRA_ORIGIN;
  process.env.NODE_ENV = "test";
  process.env.HELPINSIGHTS_ENTRA_ORIGIN = "loopback-test";
  context.after(() => {
    if (priorMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorMode;
    if (priorOrigin === undefined) delete process.env.HELPINSIGHTS_ENTRA_ORIGIN;
    else process.env.HELPINSIGHTS_ENTRA_ORIGIN = priorOrigin;
  });
  const pool = {
    async query(sql: string) {
      return {
        rows: sql.includes("resolve_collection_distribution")
          ? [
              {
                surveyVersionId: "fixture-version",
                eligibilityMode: "university",
                researchConsent: null,
              },
            ]
          : [],
      };
    },
  } as unknown as Pool;
  const server = createApplication(
    async () => true,
    respondentRoutes(pool, null, false, true),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = "http://127.0.0.1:" + address.port;
  const response = await fetch(
    origin + "/api/v1/public/s/" + "A".repeat(43) + "/responses",
    {
      method: "POST",
      headers: {
        Cookie: "__Host-helpinsights-session=" + "B".repeat(43),
        Origin: origin,
      },
      body: "malformed",
    },
  );
  assert.equal(response.status, 403);
});
