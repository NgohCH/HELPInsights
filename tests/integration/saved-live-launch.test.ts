import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { liveQuizFixture } from "../fixtures/live-quiz.ts";
import { pollDefinition } from "../fixtures/live-poll.ts";
import { researchFixture } from "../fixtures/research-consent.ts";
import { definition } from "../fixtures/survey.ts";

test("saved live launch requires current editor authority and never falls back to an older open version", async () => {
  const { api, owner, outsider, quizVersionId, sql, workspace, outside } =
    await liveQuizFixture();
  const surveyId = sql(
    `SELECT survey_id FROM public.survey_versions WHERE id = '${quizVersionId}'`,
  );
  const endpoint = "/surveys/" + surveyId;
  const read = (authorization?: string) =>
    api(endpoint + "/live-launch", "GET", undefined, authorization);
  const create = (version: string, authorization: string) =>
    api(
      "/live-sessions",
      "POST",
      { surveyId, quizVersionId: version, mode: "live_poll" },
      authorization,
    );

  const permitted = await read(owner);
  assert.equal(permitted.status, 200);
  assert.deepEqual(await permitted.json(), {
    publication: {
      id: quizVersionId,
      title: "Workshop feedback",
      gameShowOptions: [
        { code: "useful", label: "Useful" },
        { code: "not_useful", label: "Not useful" },
      ],
    },
  });
  assert.equal((await read()).status, 401);
  assert.equal((await read(outsider)).status, 403);
  sql(`
    INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
    SELECT '${workspace}', user_id, 'analyst'
    FROM public.workspace_memberships WHERE workspace_id = '${outside}';
  `);
  assert.equal((await read(outsider)).status, 403);
  assert.equal((await create(quizVersionId, outsider)).status, 403);
  sql(`UPDATE public.workspace_memberships SET role = 'editor'
       WHERE workspace_id = '${workspace}' AND role = 'analyst'`);
  assert.equal((await read(outsider)).status, 200);

  const second = await api(
    endpoint + "/publish",
    "POST",
    { eligibilityMode: "open" },
    owner,
  );
  assert.equal(second.status, 201);
  const { id: latest } = await second.json();
  assert.equal((await (await read(owner)).json()).publication.id, latest);
  assert.equal((await create(quizVersionId, owner)).status, 409);
  assert.equal((await create(latest, outsider)).status, 201);

  const universityPolicyId = randomUUID();
  sql(`INSERT INTO public.university_eligibility_policies (id, workspace_id, code, version, approved_at)
       VALUES ('${universityPolicyId}', '${workspace}', 'workshop-only', 1, now())`);
  const restricted = await api(
    endpoint + "/publish",
    "POST",
    { eligibilityMode: "university", universityPolicyId },
    owner,
  );
  assert.equal(restricted.status, 201);
  const { id: withheld } = await restricted.json();
  assert.deepEqual(await (await read(owner)).json(), { publication: null });
  assert.equal((await create(withheld, owner)).status, 403);
  assert.equal((await create(latest, owner)).status, 409);

  const fresh = await api(
    endpoint + "/publish",
    "POST",
    { eligibilityMode: "open" },
    owner,
  );
  const { id: beforeClose } = await fresh.json();
  assert.equal(fresh.status, 201);
  assert.equal(
    (await api(endpoint + "/close", "POST", undefined, owner)).status,
    200,
  );
  assert.deepEqual(await (await read(owner)).json(), { publication: null });
  assert.equal((await create(beforeClose, owner)).status, 403);
  assert.equal(
    sql(`SELECT count(*) FROM public.live_sessions l JOIN public.survey_versions v
         ON v.id = l.quiz_version_id WHERE v.survey_id = '${surveyId}'`),
    "1",
  );
});

test("saved launch withholds consent-bound, conditional and text publications", async () => {
  const { prepare, publish, stack, ownerToken } = researchFixture();
  const base = stack.baseUrl() + "/api/v1";
  const headers = { Authorization: "Bearer " + ownerToken };
  const assertWithheld = async (id: string) => {
    const launch = await fetch(base + "/surveys/" + id + "/live-launch", {
      headers,
    });
    assert.equal(launch.status, 200);
    assert.deepEqual(await launch.json(), { publication: null });
  };

  const consent = await prepare();
  await publish(consent.request);
  await assertWithheld(consent.id);

  const conditional = await prepare({
    ...pollDefinition,
    pages: pollDefinition.pages.map((page) => ({
      ...page,
      questions: page.questions.map((question) =>
        question.id === "venue"
          ? {
              ...question,
              visibleWhen: { questionId: "rating", optionCode: "useful" },
            }
          : question,
      ),
    })),
  });
  await publish(conditional.request, false);
  await assertWithheld(conditional.id);

  const text = await prepare({
    ...definition,
    pages: [
      {
        id: "comment",
        questions: [
          {
            id: "comment",
            code: "comment",
            title: "What helped?",
            type: "short_text",
            required: true,
          },
        ],
      },
    ],
  });
  await publish(text.request, false);
  await assertWithheld(text.id);
});
