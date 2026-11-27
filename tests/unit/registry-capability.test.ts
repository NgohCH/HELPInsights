import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  registryCapabilities,
  syntheticRegistry,
} from "../../apps/api/registry.ts";

test("capability validity is bound to a distribution, key and exact expiry", () => {
  const key = randomBytes(32);
  const scope = randomBytes(32);
  let now = Date.parse("2026-01-01T00:01:00Z");
  const capability = registryCapabilities(key, () => now);
  const first = capability.issue(scope);
  assert.deepEqual(capability.issue(scope), first);
  assert.ok(capability.verify(scope, first.capability));
  assert.equal(capability.verify(randomBytes(32), first.capability), false);
  assert.equal(
    registryCapabilities(randomBytes(32), () => now).verify(
      scope,
      first.capability,
    ),
    false,
  );
  const [expiry, signature] = first.capability.split(".");
  const changed = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  assert.equal(capability.verify(scope, expiry + "." + changed), false);
  now = Date.parse(first.expiresAt) - 1;
  assert.equal(capability.verify(scope, first.capability), true);
  now += 1;
  assert.equal(capability.verify(scope, first.capability), false);
});

test("synthetic Registry configuration is disabled outside the explicit test opt-in", () => {
  const key = randomBytes(32).toString("hex");
  assert.equal(
    syntheticRegistry({
      NODE_ENV: "production",
      HELPINSIGHTS_DEV_REGISTRY_MODE: "synthetic",
      HELPINSIGHTS_TEST_REGISTRY_KEY: key,
    }),
    null,
  );
  assert.equal(
    syntheticRegistry({
      NODE_ENV: "test",
      HELPINSIGHTS_TEST_REGISTRY_KEY: key,
    }),
    null,
  );
  assert.throws(
    () =>
      syntheticRegistry({
        NODE_ENV: "test",
        HELPINSIGHTS_DEV_REGISTRY_MODE: "synthetic",
      }),
    /per-test signing key/,
  );
});
