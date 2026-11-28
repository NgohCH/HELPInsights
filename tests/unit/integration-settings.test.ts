import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { createApplication } from "../../apps/api/application.ts";
import { integrationSettingsRoutes } from "../../apps/api/integration-settings.ts";

test("integration management and workload reads require the appropriate credential", async (context) => {
  const pool = {
    query() {
      throw new Error("Unexpected database access");
    },
  } as unknown as Pool;
  const server = createApplication(
    async () => true,
    integrationSettingsRoutes(pool, "test"),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = "http://127.0.0.1:" + address.port + "/api/v1";
  const admin = await fetch(base + "/admin/integrations");
  assert.equal(admin.status, 401);

  const workspace =
    base + "/integrations/workspaces/00000000-0000-0000-0000-000000000001";
  const cookie = "__Host-helpinsights-session=" + "a".repeat(43);
  assert.equal(
    (await fetch(workspace, { headers: { Cookie: cookie } })).status,
    401,
  );
  const method = await fetch(workspace, { method: "POST" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET");
});

test("renewal requires an expected credential version", async (context) => {
  const savedOrigin = process.env.HELPINSIGHTS_ENTRA_ORIGIN;
  const origin = "https://integration-admin.example";
  process.env.HELPINSIGHTS_ENTRA_ORIGIN = origin;
  context.after(() => {
    if (savedOrigin === undefined) delete process.env.HELPINSIGHTS_ENTRA_ORIGIN;
    else process.env.HELPINSIGHTS_ENTRA_ORIGIN = savedOrigin;
  });
  const pool = {
    query(sql: string) {
      if (sql.includes("integration_admin_allowed"))
        return { rows: [{ allowed: true }] };
      throw new Error("The renewal must be rejected before it reaches storage");
    },
  } as unknown as Pool;
  const server = createApplication(
    async () => true,
    integrationSettingsRoutes(pool, "test"),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const response = await fetch(
    "http://127.0.0.1:" + address.port + "/api/v1/admin/integrations",
    {
      method: "POST",
      headers: {
        Cookie: "__Host-helpinsights-session=" + "a".repeat(43),
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "renew",
        clientId: "00000000-0000-0000-0000-000000000001",
      }),
    },
  );
  assert.equal(response.status, 400);
});
