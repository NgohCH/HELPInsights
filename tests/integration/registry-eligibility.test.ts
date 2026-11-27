import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  eligibleRegistryProof,
  ineligibleRegistryProof,
  registryFixture,
} from "../fixtures/registry.ts";

test("Registry verification gates its exact distribution without changing open collection or persisting proof", async () => {
  const { request, publish, sql, stack } = registryFixture();
  const restricted = await publish("registry-synthetic");
  const other = await publish("registry-synthetic");
  const open = await publish();
  assert.deepEqual(await (await request(restricted.path)).json(), {
    eligibilityRequired: true,
  });
  assert.equal(
    (await (await request(open.path)).json()).surveyVersionId,
    open.version,
  );
  const check = (proof: string) =>
    request(restricted.path + "/eligibility", "POST", { body: { proof } });
  assert.equal((await check(ineligibleRegistryProof)).status, 403);
  assert.equal((await check("registry_fixture_unknown")).status, 403);
  const allowed = await check(eligibleRegistryProof);
  assert.equal(allowed.status, 200);
  const verification = await allowed.json();
  assert.deepEqual(Object.keys(verification).sort(), [
    "capability",
    "expiresAt",
  ]);
  assert.ok(Date.parse(verification.expiresAt) > Date.now());
  const capability = verification.capability;
  assert.equal(typeof capability, "string");

  const withCapability = { "X-Survey-Capability": capability };
  assert.equal(
    (
      await (
        await request(restricted.path, "GET", { headers: withCapability })
      ).json()
    ).surveyVersionId,
    restricted.version,
  );
  assert.deepEqual(
    await (
      await request(other.path, "GET", { headers: withCapability })
    ).json(),
    { eligibilityRequired: true },
  );

  const submit = (
    { path, version }: typeof restricted,
    key = randomUUID(),
    headers?: Record<string, string>,
  ) =>
    request(path + "/responses", "POST", {
      headers: { "Idempotency-Key": key, ...headers },
      body: {
        surveyVersionId: version,
        answers: [{ questionId: "rating", value: "useful" }],
      },
    });
  assert.equal((await submit(restricted)).status, 403);
  assert.equal((await submit(other, randomUUID(), withCapability)).status, 403);
  assert.equal(
    (
      await submit(restricted, randomUUID(), {
        "X-Survey-Capability": "invalid",
      })
    ).status,
    403,
  );
  assert.equal((await submit(open)).status, 201);
  const retryKey = randomUUID();
  const first = await submit(restricted, retryKey, withCapability);
  assert.equal(first.status, 201);
  const storedReceipt = await first.json();
  const retry = await submit(restricted, retryKey, withCapability);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), storedReceipt);
  assert.equal(
    (await submit(restricted, randomUUID(), withCapability)).status,
    201,
  );

  const tokenHash = createHash("sha256")
    .update(restricted.publicToken)
    .digest("hex");
  assert.equal(
    sql(`SET ROLE helpinsights_runtime;
      SELECT outcome FROM public.accept_response(
        decode('${tokenHash}', 'hex'), '${restricted.version}', decode(repeat('e', 64), 'hex'),
        decode(repeat('f', 64), 'hex'), '[]'::jsonb
      )`),
    "closed",
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM public.responses WHERE survey_version_id = '${restricted.version}'`,
    ),
    "2",
  );
  const stored = sql(
    `SELECT to_jsonb(r)::text FROM public.responses r WHERE survey_version_id = '${restricted.version}'`,
  );
  for (const value of [
    eligibleRegistryProof,
    ineligibleRegistryProof,
    capability,
  ]) {
    assert.ok(
      !stored.includes(value),
      "No eligibility material is stored with responses",
    );
    assert.ok(
      !stack
        .compose("logs", "--no-color", "app", "registry-simulator")
        .includes(value),
      "Application and fixture provider do not log eligibility material",
    );
  }
});

test("a stopped Registry simulator issues no capabilities and eligibility recovers after restart", async () => {
  const { request, publish, stack } = registryFixture();
  const survey = await publish("registry-synthetic");
  const check = () =>
    request(survey.path + "/eligibility", "POST", {
      body: { proof: eligibleRegistryProof },
    });
  assert.equal((await check()).status, 200);
  stack.compose("stop", "registry-simulator");
  try {
    const response = await check();
    assert.equal(response.status, 503);
    const failure = await response.json();
    assert.equal(failure.code, "UNAVAILABLE");
    assert.ok(!("capability" in failure));
    assert.equal((await request("/health/ready")).status, 200);
  } finally {
    stack.compose(
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "30",
      "registry-simulator",
    );
  }
  assert.equal((await check()).status, 200);
});
