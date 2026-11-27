import assert from "node:assert/strict";
import test from "node:test";

test("the public application sets browser protections and rejects unsupported methods", async () => {
  const base = process.env.APP_BASE_URL;
  assert.ok(base, "APP_BASE_URL is required");
  const root = await fetch(base);
  assert.equal(root.headers.get("x-content-type-options"), "nosniff");
  assert.match(
    root.headers.get("content-security-policy") ?? "",
    /frame-ancestors 'none'/,
  );
  const method = await fetch(new URL("/api/v1/health/live", base), {
    method: "POST",
  });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET");
});
