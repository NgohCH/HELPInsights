import assert from "node:assert/strict";
import test from "node:test";
import type { SurveyDefinition } from "../../packages/survey-runtime/definition.ts";
import { editSurveyStructure } from "../../packages/survey-runtime/survey-structure.ts";

const initial: SurveyDefinition = {
  schemaVersion: "1",
  title: "Workshop feedback",
  description: "One anonymous follow-up.",
  pages: [
    {
      id: "feedback",
      title: "Feedback",
      questions: [
        {
          id: "timing",
          code: "workshop_timing",
          title: "How was the timing?",
          type: "single_choice",
          required: true,
          options: [
            { code: "too_short", label: "Too short" },
            { code: "long_enough", label: "Long enough" },
          ],
        },
      ],
    },
    {
      id: "attendance",
      questions: [
        {
          id: "adjustment",
          code: "workshop_adjustment",
          title: "What would you change?",
          type: "short_text",
          required: false,
          visibleWhen: { questionId: "timing", optionCode: "too_short" },
        },
        {
          id: "attendance_count",
          code: "workshop_attendance",
          title: "How many workshops?",
          type: "number",
          required: true,
        },
      ],
    },
  ],
};

test("moving a question across pages preserves its variable and existing survey metadata", () => {
  const before = structuredClone(initial);
  const moved = editSurveyStructure(initial, {
    kind: "move-question",
    pageId: "attendance",
    questionId: "attendance_count",
    toPageId: "feedback",
    toIndex: 0,
  });
  assert.deepEqual(moved, {
    ...before,
    pages: [
      {
        ...before.pages[0],
        questions: [before.pages[1].questions[1], before.pages[0].questions[0]],
      },
      { ...before.pages[1], questions: [before.pages[1].questions[0]] },
    ],
  });
  assert.deepEqual(initial, before);
});

test("structural changes reject moving or removing a visibility controller while it is still referenced", () => {
  const actions = [
    { kind: "move-page", pageId: "feedback", toIndex: 1 },
    { kind: "remove-page", pageId: "feedback" },
    { kind: "remove-question", pageId: "feedback", questionId: "timing" },
    {
      kind: "move-question",
      pageId: "feedback",
      questionId: "timing",
      toPageId: "attendance",
      toIndex: 1,
    },
  ] as const;
  const before = structuredClone(initial);

  for (const change of actions) {
    assert.throws(
      () => editSurveyStructure(initial, change),
      /visibility.*earlier/i,
    );
  }
  assert.deepEqual(initial, before);
});

test("a page and a new variable remain stable through same-page reorder and removal", () => {
  let draft = editSurveyStructure(initial, {
    kind: "add-page",
    pageId: "summary",
  });
  const variable = {
    id: "additional_notes",
    code: "workshop_notes",
    title: "Additional notes?",
    type: "short_text",
    required: false,
  } as const;
  draft = editSurveyStructure(draft, {
    kind: "add-question",
    pageId: "summary",
    question: variable,
  });
  draft = editSurveyStructure(draft, {
    kind: "move-question",
    pageId: "attendance",
    questionId: "attendance_count",
    toPageId: "summary",
    toIndex: 1,
  });
  draft = editSurveyStructure(draft, {
    kind: "move-question",
    pageId: "summary",
    questionId: "attendance_count",
    toPageId: "summary",
    toIndex: 0,
  });
  draft = editSurveyStructure(draft, {
    kind: "move-page",
    pageId: "summary",
    toIndex: 0,
  });
  assert.deepEqual(
    draft.pages.map(({ id }) => id),
    ["summary", "feedback", "attendance"],
  );
  assert.deepEqual(draft.pages[0].questions, [
    initial.pages[1].questions[1],
    variable,
  ]);
  const cleaned = editSurveyStructure(draft, {
    kind: "remove-question",
    pageId: "summary",
    questionId: "additional_notes",
  });
  assert.deepEqual(cleaned.pages[0].questions, [initial.pages[1].questions[1]]);
});

test("a saved definition retains at least one page and rejects duplicate keys", () => {
  const onePage = { ...initial, pages: [initial.pages[0]] };
  assert.throws(
    () =>
      editSurveyStructure(onePage, { kind: "remove-page", pageId: "feedback" }),
    /one page/i,
  );
  assert.throws(
    () =>
      editSurveyStructure(initial, {
        kind: "add-question",
        pageId: "attendance",
        question: { ...initial.pages[1].questions[1], id: "another_id" },
      }),
    /question codes must be unique/i,
  );
});
