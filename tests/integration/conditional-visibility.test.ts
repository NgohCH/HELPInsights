import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  visibilityDefinition,
  visibilityFixture,
} from "../fixtures/visibility.ts";

test("a conditional draft rejects invalid selectors and collection stores only visible answers", async () => {
  const { save, publish, sql } = await visibilityFixture();
  for (const visibleWhen of [
    { questionId: "missing", optionCode: "not_useful" },
    { questionId: "detail", optionCode: "not_useful" },
    { questionId: "rating", optionCode: "missing" },
  ]) {
    const [base, followUp] = visibilityDefinition.pages;
    const changed = {
      ...followUp,
      questions: [{ ...followUp.questions[0], visibleWhen }],
    };
    assert.equal(
      (await save({ ...visibilityDefinition, pages: [base, changed] })).status,
      400,
    );
  }
  assert.equal(
    (
      await save({
        ...visibilityDefinition,
        pages: [...visibilityDefinition.pages].reverse(),
      })
    ).status,
    400,
  );
  const [base, followUp] = visibilityDefinition.pages;
  const [controller] = base.questions;
  const [dependent] = followUp.questions;
  const invalidController = async (questions: unknown[]) =>
    save({
      ...visibilityDefinition,
      pages: [{ ...base, questions }, followUp],
    });
  const { options: _, ...numberController } = controller;
  assert.equal(
    (await invalidController([{ ...numberController, type: "number" }])).status,
    400,
  );
  const nested = {
    ...controller,
    visibleWhen: { questionId: "other", optionCode: "not_useful" },
  };
  const earlier = { ...controller, id: "other", code: "earlier_example" };
  assert.equal((await invalidController([earlier, nested])).status, 400);
  assert.equal(
    (
      await save({
        ...visibilityDefinition,
        pages: [
          base,
          { ...followUp, questions: [{ ...dependent, visibleWhen: null }] },
        ],
      })
    ).status,
    400,
  );
  assert.equal((await save(visibilityDefinition)).status, 200);
  const { endpoint, id } = await publish();
  const publicSurvey = await fetch(endpoint);
  assert.equal(publicSurvey.status, 200);
  assert.deepEqual(
    (await publicSurvey.json()).definition.pages[1].questions[0].visibleWhen,
    { questionId: "rating", optionCode: "not_useful" },
  );

  const submit = (answers: unknown) =>
    fetch(endpoint + "/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({ surveyVersionId: id, answers }),
    });

  const useful = { questionId: "rating", value: "useful" };
  const notUseful = { questionId: "rating", value: "not_useful" };
  const detail = { questionId: "detail", value: "More examples" };
  assert.equal((await submit([useful, detail])).status, 400);
  assert.equal((await submit([notUseful])).status, 400);
  assert.equal((await submit([useful])).status, 201);
  assert.equal((await submit([detail, notUseful])).status, 201);
  assert.equal(
    sql(
      "SELECT jsonb_array_length(answers) FROM public.responses WHERE survey_version_id = '" +
        id +
        "' ORDER BY jsonb_array_length(answers)",
    ),
    "1\n2",
  );
  assert.equal(
    sql(
      "SELECT count(*) FROM public.responses WHERE survey_version_id = '" +
        id +
        '\' AND answers @> \'[{"questionId":"detail"}]\'',
    ),
    "1",
  );
});
