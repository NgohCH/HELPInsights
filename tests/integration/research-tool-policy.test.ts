import assert from "node:assert/strict";
import test from "node:test";
import { researchFixture } from "../fixtures/research-consent.ts";

test("public creators cannot publish synthetic research but can publish ordinary surveys", async () => {
  const { prepare, sql } = researchFixture();
  const { id, request } = await prepare();
  assert.equal((await request({ researchConsent: "synthetic" })).status, 403);
  assert.equal(
    sql(
      `SELECT count(*) FROM public.survey_versions WHERE survey_id = '${id}'`,
    ),
    "0",
  );
  assert.equal((await request()).status, 201);
});
