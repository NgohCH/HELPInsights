import assert from "node:assert/strict";
import test from "node:test";

test("workspace and profile endpoints require an authenticated session", async () => {
  const base = process.env.APP_BASE_URL;
  assert.ok(base, "APP_BASE_URL is required");
  for (const path of ["/api/v1/me", "/api/v1/workspaces"]) {
    const response: Response = await fetch(new URL(path, base), {
      headers: { "X-Workspace-Id": "742b2f53-5458-49f7-9db4-ea5b0341822e" },
    });
    assert.equal(response.status, 401, path);
    assert.equal((await response.json()).code, "UNAUTHORISED");
  }
});
