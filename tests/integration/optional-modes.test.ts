import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { registryFixture } from "../fixtures/registry.ts";
import { definition } from "../fixtures/survey.ts";

test("one publication cannot mix synthetic Registry eligibility and research consent", async () => {
  const { createDraft, request, sql } = registryFixture();
  const { id, headers } = await createDraft();
  const url = "/surveys/" + id + "/publish";
  const mixed = await request(url, "POST", {
    headers,
    body: {
      eligibilityMode: "registry-synthetic",
      researchConsent: "synthetic",
    },
  });
  assert.equal(mixed.status, 400);
  assert.equal(
    (await mixed.json()).message,
    "Choose one synthetic survey restriction",
  );
  assert.equal(
    sql(
      "SELECT status, (SELECT count(*) FROM public.survey_versions WHERE survey_id = '" +
        id +
        "') FROM public.surveys WHERE id = '" +
        id +
        "'",
    ),
    "draft|0",
  );
  const consent = await request(url, "POST", {
    headers,
    body: { eligibilityMode: "open", researchConsent: "synthetic" },
  });
  assert.equal(consent.status, 201);
  const { id: version, publicToken } = await consent.json();
  const survey = await request("/public/s/" + publicToken);
  assert.equal(survey.status, 200);
  const view = await survey.json();
  assert.equal(view.eligibilityRequired, undefined);
  assert.equal(view.researchConsent.studyKey, "synthetic-consent-study");

  const setMode = (mode: "open" | "registry-synthetic") =>
    sql(
      "UPDATE public.distributions SET eligibility_mode = '" +
        mode +
        "' WHERE survey_version_id = '" +
        version +
        "'",
    );
  setMode("registry-synthetic");
  try {
    const inconsistent = await request("/public/s/" + publicToken);
    assert.equal(inconsistent.status, 503);
    assert.deepEqual(Object.keys(await inconsistent.json()).sort(), [
      "code",
      "message",
      "requestId",
    ]);
  } finally {
    setMode("open");
  }
});

async function checkConsentInsertion(
  eligibilityMode: "registry-synthetic" | "open",
  definition: unknown,
) {
  const { ownerToken, sql, createDraft } = registryFixture();
  const { id: survey } = await createDraft();
  const actorHash = createHash("sha256").update(ownerToken).digest("hex");
  const distribution = randomBytes(32).toString("hex");
  const definitionJson = JSON.stringify(definition);
  assert.equal(
    sql(`
    BEGIN;
    DO $context$
    BEGIN
      PERFORM set_config('helpinsights.actor_id', (
        SELECT user_id::text FROM public.sessions WHERE token_hash = decode('${actorHash}', 'hex')
      ), true);
    END
    $context$;
    SET LOCAL ROLE helpinsights_app;
    INSERT INTO public.survey_versions (survey_id, version, definition, hash)
      VALUES ('${survey}', 1, $definition$${definitionJson}$definition$::jsonb, repeat('0', 64));
    INSERT INTO public.distributions (token_hash, survey_version_id, eligibility_mode)
      SELECT decode('${distribution}', 'hex'), id, '${eligibilityMode}' FROM public.survey_versions WHERE survey_id = '${survey}';
    DO $test$
    BEGIN
      INSERT INTO public.research_consent_versions (survey_version_id, study_key, revision, notice)
      SELECT id, 'synthetic-consent-study', 1, 'Synthetic notice' FROM public.survey_versions WHERE survey_id = '${survey}';
      RAISE EXCEPTION 'Expected consent policy database restriction';
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END
    $test$;
    SELECT 'consent policy denied';
    ROLLBACK;
  `),
    "consent policy denied",
  );
}

test("the application database role cannot attach consent to a Registry distribution", async () => {
  await checkConsentInsertion("registry-synthetic", definition);
});

test("the application database role can publish open text questions without attaching consent", async () => {
  const [page] = definition.pages;
  const [{ id, code, title, required }] = page.questions;
  await checkConsentInsertion("open", {
    ...definition,
    pages: [
      {
        ...page,
        questions: [{ id, code, title, required, type: "short_text" }],
      },
    ],
  });
});
