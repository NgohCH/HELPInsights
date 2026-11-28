import assert from "node:assert/strict";
import test from "node:test";
import * as runtime from "../../packages/survey-runtime/definition.ts";
import { strFromU8, unzipSync } from "fflate";
import { createExport } from "../../packages/survey-runtime/export.ts";
import { editSurveyStructure } from "../../packages/survey-runtime/survey-structure.ts";
import {
  firstLabel,
  followUpTitle,
  pipingDraft,
  secondLabel,
  withPiping,
} from "../fixtures/answer-piping.ts";

test("canonical piping preserves stable question metadata and existing drafts", () => {
  const definition = runtime.parseDefinition(withPiping());
  assert.deepEqual(definition, withPiping());
  assert.deepEqual(runtime.parseDefinition(pipingDraft), pipingDraft);
  const now = new Date("2026-01-01T00:00:00Z");
  const readCodebook = (definition: runtime.SurveyDefinition) =>
    strFromU8(
      unzipSync(
        createExport(
          {
            version_id: "version-id",
            survey_id: "survey-id",
            version: 1,
            definition,
            requested_at: now,
            format: "jasp_csv_bundle",
            over_limit: false,
            answers: [],
          },
          now,
        ),
      )["codebook.csv"],
    );
  const codebook = readCodebook(definition);
  assert.equal(codebook, readCodebook(pipingDraft));
  assert.ok(
    codebook.includes(
      "workshop_improvement,improvement,Which part should we improve?",
    ),
  );
});

test("canonical piping accepts a predecessor on the same page", () => {
  const [workshop, feedback] = withPiping().pages;
  const samePage = {
    ...pipingDraft,
    pages: [
      {
        ...workshop,
        questions: [...workshop.questions, ...feedback.questions],
      },
    ],
  };
  assert.deepEqual(runtime.parseDefinition(samePage), samePage);
});

test("canonical piping rejects invalid, forward, conditional and non-choice source IDs", () => {
  const [workshop, feedback] = withPiping().pages;
  for (const id of ["missing", "improvement", "attend_again"]) {
    assert.throws(
      () => runtime.parseDefinition(withPiping(id)),
      /answer label.*earlier unconditional single-choice/i,
    );
  }
  for (const malformed of [
    null,
    "",
    "a".repeat(65),
    { questionId: "session" },
  ]) {
    assert.throws(
      () => runtime.parseDefinition(withPiping(malformed)),
      /stable machine-readable identifier/i,
    );
  }

  const [controller] = workshop.questions;
  const earlier = { ...controller, id: "earlier", code: "earlier_choice" };
  const conditional = {
    ...controller,
    visibleWhen: { questionId: "earlier", optionCode: "session_a" },
  };
  const numberController = {
    id: controller.id,
    code: controller.code,
    title: controller.title,
    required: false,
    type: "number",
  };
  for (const questions of [[earlier, conditional], [numberController]]) {
    assert.throws(
      () =>
        runtime.parseDefinition({
          ...pipingDraft,
          pages: [{ ...workshop, questions }, feedback],
        }),
      /answer label.*earlier unconditional single-choice/i,
    );
  }
});

test("moving or deleting a source referenced by a later title leaves the draft intact", () => {
  const definition = runtime.parseDefinition(withPiping());
  assert.throws(
    () =>
      editSurveyStructure(definition, {
        kind: "move-page",
        pageId: "workshop",
        toIndex: 1,
      }),
    /answer label.*earlier unconditional single-choice/i,
  );
  assert.throws(
    () =>
      editSurveyStructure(definition, {
        kind: "remove-question",
        pageId: "workshop",
        questionId: "session",
      }),
    /answer label.*earlier unconditional single-choice/i,
  );
  assert.deepEqual(definition, withPiping());
});

test("question title resolves only an authored label for a known option code", () => {
  const definition = runtime.parseDefinition(withPiping());
  const [source, target] = definition.pages.flatMap(
    ({ questions }) => questions,
  );
  const byId = new Map([[source.id, source]]);
  assert.equal(
    runtime.renderQuestionTitle(target, byId, new Map()),
    followUpTitle,
  );
  for (const value of ["unknown", firstLabel, 0, { code: "session_a" }]) {
    assert.equal(
      runtime.renderQuestionTitle(target, byId, new Map([[source.id, value]])),
      followUpTitle,
    );
  }
  assert.equal(
    runtime.renderQuestionTitle(
      target,
      byId,
      new Map([[source.id, "session_a"]]),
    ),
    followUpTitle + " — " + firstLabel,
  );
  assert.equal(
    runtime.renderQuestionTitle(
      target,
      byId,
      new Map([[source.id, "session_c"]]),
    ),
    followUpTitle + " — " + secondLabel,
  );
});
