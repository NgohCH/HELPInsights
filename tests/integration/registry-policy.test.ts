import assert from "node:assert/strict";
import test from "node:test";
import { registryFixture } from "../fixtures/registry.ts";

test("invalid Registry publication options leave the survey private", async () => {
  const { request, createDraft, sql, stack } = registryFixture();
  const { id, headers } = await createDraft();
  const path = "/surveys/" + id + "/publish";
  const invalid = await request(path, "POST", {
    headers,
    body: { eligibilityMode: null },
  });
  assert.equal(invalid.status, 400);
  const noMediaType = await fetch(stack.baseUrl() + "/api/v1" + path, {
    method: "POST",
    headers,
    body: Buffer.from(
      JSON.stringify({ eligibilityMode: "registry-synthetic" }),
    ),
  });
  assert.equal(noMediaType.status, 415);
  assert.equal(
    sql(`
    SELECT status, (SELECT count(*) FROM public.survey_versions v WHERE v.survey_id = s.id)
    FROM public.surveys s WHERE id = '${id}'
  `),
    "draft|0",
  );
});
