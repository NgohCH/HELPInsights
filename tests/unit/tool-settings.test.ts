import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { createApplication } from "../../apps/api/application.ts";
import { toolSettingsRoutes } from "../../apps/api/tool-settings.ts";

test("tool settings reject an unauthenticated request before reading policy", async (context) => {
  const pool = {
    query() {
      throw new Error("Unexpected database access");
    },
  } as unknown as Pool;
  const server = createApplication(async () => true, toolSettingsRoutes(pool));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const response = await fetch(
    "http://127.0.0.1:" + address.port + "/api/v1/admin/tools/template-copy",
  );
  assert.equal(response.status, 401);
});
