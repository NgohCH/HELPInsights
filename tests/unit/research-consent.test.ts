import assert from "node:assert/strict";
import test from "node:test";
import { syntheticConsentEnabled } from "../../apps/api/research-consent.ts";

test("synthetic consent requires an explicit switch and a test runtime", () => {
  assert.equal(syntheticConsentEnabled({}), false);
  assert.equal(syntheticConsentEnabled({ NODE_ENV: "test" }), false);
  assert.equal(
    syntheticConsentEnabled({
      NODE_ENV: "production",
      HELPINSIGHTS_DEV_RESEARCH_CONSENT: "synthetic",
    }),
    false,
  );
  assert.equal(
    syntheticConsentEnabled({
      NODE_ENV: "test",
      HELPINSIGHTS_DEV_RESEARCH_CONSENT: "synthetic",
    }),
    true,
  );
});
