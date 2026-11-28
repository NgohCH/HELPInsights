import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { researchFixture } from "../fixtures/research-consent.ts";
import { definition } from "../fixtures/survey.ts";

const answers = [{ questionId: "rating", value: "useful" }];
const submitTo = (
  version: { endpoint: string; id: string },
  consent?: object,
  key: string = randomUUID(),
) =>
  fetch(version.endpoint + "/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify({
      surveyVersionId: version.id,
      answers,
      ...(consent ? { consent } : {}),
    }),
  });

test("only affirmative consent to the exact immutable notice creates an anonymous response and a separate opt-in", async () => {
  const { prepare, publish, sql, workspace } = researchFixture();
  const { request } = await prepare();
  const oldOpen = await publish(request, false);
  const first = await publish(request);
  const firstPublic = await (await fetch(first.endpoint)).json();
  const firstNotice = firstPublic.researchConsent;
  assert.equal(firstNotice?.studyKey, "synthetic-consent-study");
  assert.equal(firstNotice.revision, 2);
  assert.match(firstNotice.notice, /voluntary/i);
  const second = await publish(request);
  const secondNotice = (await (await fetch(second.endpoint)).json())
    .researchConsent;
  assert.equal(secondNotice.revision, 3);
  assert.notEqual(secondNotice.id, firstNotice.id);
  assert.deepEqual(
    (await (await fetch(first.endpoint)).json()).researchConsent,
    firstNotice,
  );
  assert.equal(
    (await (await fetch(oldOpen.endpoint)).json()).researchConsent,
    undefined,
  );
  assert.equal((await submitTo(oldOpen)).status, 201);
  const actor = sql(
    `SELECT user_id FROM public.workspace_memberships WHERE workspace_id = '${workspace}' AND role = 'owner'`,
  );
  sql(`
    SET ROLE helpinsights_runtime;
    SELECT set_config('helpinsights.actor_id', '${actor}', false);
    DO $probe$
    BEGIN
      INSERT INTO public.research_consent_versions (survey_version_id, study_key, revision, notice)
      VALUES ('${oldOpen.id}', 'synthetic-consent-study', 1, 'Synthetic post-publication notice');
      RAISE EXCEPTION 'Retroactive consent was accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END $probe$;
  `);
  assert.equal(
    (await (await fetch(oldOpen.endpoint)).json()).researchConsent,
    undefined,
  );

  const countAccepted = () =>
    sql(`
    SELECT
      (SELECT count(*) FROM public.responses WHERE survey_version_id = '${first.id}'),
      (SELECT count(*) FROM public.research_consent_opt_ins WHERE consent_version_id = '${firstNotice.id}')
  `);
  assert.equal((await submitTo(first)).status, 403);
  assert.equal(
    (await submitTo(first, { versionId: firstNotice.id, accepted: false }))
      .status,
    403,
  );
  assert.equal(
    (await submitTo(first, { versionId: secondNotice.id, accepted: true }))
      .status,
    403,
  );
  assert.equal(
    (
      await submitTo(first, {
        versionId: firstNotice.id,
        accepted: true,
        participantId: randomUUID(),
      })
    ).status,
    400,
  );
  assert.equal(countAccepted(), "0|0");
  const hash = createHash("sha256").update(first.publicToken).digest("hex");
  sql(`
    SET ROLE helpinsights_runtime;
    DO $probe$
    BEGIN
      PERFORM public.accept_response(
        decode('${hash}', 'hex'), '${first.id}', decode(repeat('e', 64), 'hex'),
        decode(repeat('f', 64), 'hex'), '[]'::jsonb
      );
      RAISE EXCEPTION 'Unconsented write was accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END $probe$;
  `);
  assert.equal(countAccepted(), "0|0");

  const consent = { versionId: firstNotice.id, accepted: true };
  const key = randomUUID();
  const repeated = await Promise.all([
    submitTo(first, consent, key),
    submitTo(first, consent, key),
  ]);
  assert.deepEqual(
    repeated.map((response) => response.status).sort(),
    [200, 201],
  );
  const [one, two] = await Promise.all(
    repeated.map((response) => response.json()),
  );
  assert.deepEqual(one, two);
  assert.equal(countAccepted(), "1|1");
  assert.equal(
    sql("SELECT count(*) FROM public.research_consent_transactions"),
    "0",
  );
  const optIn = JSON.parse(
    sql(
      `SELECT to_jsonb(o)::text FROM public.research_consent_opt_ins o WHERE consent_version_id = '${firstNotice.id}'`,
    ),
  );
  assert.deepEqual(Object.keys(optIn).sort(), ["consent_version_id", "id"]);
  assert.equal(optIn.consent_version_id, firstNotice.id);
  assert.notEqual(optIn.id, one.receiptId);
  assert.equal(
    sql(
      "SELECT has_table_privilege('helpinsights_runtime','public.research_consent_opt_ins','SELECT'), has_any_column_privilege('helpinsights_runtime','public.research_consent_versions','UPDATE')",
    ),
    "f|f",
  );
});

test("a consent event write fault rolls back the response and the same submission can recover", async () => {
  const { prepare, publish, sql } = researchFixture();
  const { request } = await prepare();
  const version = await publish(request);
  const publicSurvey = await (await fetch(version.endpoint)).json();
  const consent = {
    versionId: publicSurvey.researchConsent?.id,
    accepted: true,
  };
  assert.ok(consent.versionId);
  sql(`
    CREATE FUNCTION public.fail_synthetic_consent_event() RETURNS trigger LANGUAGE plpgsql AS $fault$
    BEGIN RAISE EXCEPTION 'synthetic consent ledger fault'; END $fault$;
    CREATE TRIGGER fail_synthetic_consent_event BEFORE INSERT ON public.research_consent_opt_ins
      FOR EACH ROW WHEN (NEW.consent_version_id = '${consent.versionId}')
      EXECUTE FUNCTION public.fail_synthetic_consent_event();
  `);
  const key = randomUUID();
  const counts = () =>
    sql(`
    SELECT
      (SELECT count(*) FROM public.responses WHERE survey_version_id = '${version.id}'),
      (SELECT count(*) FROM public.research_consent_opt_ins WHERE consent_version_id = '${consent.versionId}')
  `);
  try {
    assert.equal((await submitTo(version, consent, key)).status, 503);
    assert.equal(counts(), "0|0");
  } finally {
    sql(
      "DROP TRIGGER fail_synthetic_consent_event ON public.research_consent_opt_ins; DROP FUNCTION public.fail_synthetic_consent_event();",
    );
  }
  assert.equal((await submitTo(version, consent, key)).status, 201);
  assert.equal(counts(), "1|1");
});

test("the synthetic publication path rejects invalid options and non-choice data collection", async () => {
  const { prepare, sql } = researchFixture();
  const plain = await prepare();
  assert.equal((await plain.request({ researchConsent: null })).status, 400);
  const shortText = await prepare({
    ...definition,
    pages: [
      {
        id: "first",
        questions: [
          {
            id: "notes",
            code: "notes",
            title: "Synthetic note",
            type: "short_text",
            required: false,
          },
        ],
      },
    ],
  });
  assert.equal(
    (await shortText.request({ researchConsent: "synthetic" }, true)).status,
    400,
  );
  assert.equal(
    sql(
      `SELECT string_agg(status, ',' ORDER BY status) FROM public.surveys WHERE id IN ('${plain.id}', '${shortText.id}')`,
    ),
    "draft,draft",
  );
});
