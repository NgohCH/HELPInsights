import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApplication } from "../../apps/api/application.ts";

test("liveness remains available when a dependency is down", async (context) => {
  const server = createApplication(async () => false).listen(0, "127.0.0.1");
  context.after(() => server.close());
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = "http://127.0.0.1:" + address.port;
  const live = await fetch(base + "/api/v1/health/live");
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { status: "ok" });
  const ready = await fetch(base + "/api/v1/health/ready");
  assert.equal(ready.status, 503);
  assert.match((await ready.json()).requestId, /^[0-9a-f-]{36}$/);
});
