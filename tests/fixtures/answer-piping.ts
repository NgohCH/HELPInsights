import type { SurveyDefinition } from "../../packages/survey-runtime/definition.ts";

export const firstLabel = `Workshop <b>A</b> & "B's"`;
export const secondLabel = "Workshop C (afternoon)";
export const followUpTitle = "Which part should we improve?";
export const choiceFollowUpTitle = "Would you attend again?";

export const pipingDraft: SurveyDefinition = {
  schemaVersion: "1",
  title: "Synthetic workshop answer piping",
  description: "Help us improve the next workshop.",
  pages: [
    {
      id: "workshop",
      title: "Past workshops",
      questions: [
        {
          id: "session",
          code: "workshop_session",
          title: "Which workshop did you attend?",
          type: "single_choice",
          required: false,
          options: [
            { code: "session_a", label: firstLabel },
            { code: "session_c", label: secondLabel },
          ],
        },
      ],
    },
    {
      id: "feedback",
      title: "Workshop feedback",
      questions: [
        {
          id: "improvement",
          code: "workshop_improvement",
          title: followUpTitle,
          type: "short_text",
          required: true,
        },
        {
          id: "attend_again",
          code: "workshop_return",
          title: choiceFollowUpTitle,
          type: "single_choice",
          required: true,
          options: [
            { code: "yes", label: "Yes" },
            { code: "no", label: "No" },
          ],
        },
      ],
    },
  ],
};

export function withPiping(titleAnswerSourceId: unknown = "session") {
  const [workshop, feedback] = pipingDraft.pages;
  return {
    ...pipingDraft,
    pages: [
      workshop,
      {
        ...feedback,
        questions: feedback.questions.map((question) => ({
          ...question,
          titleAnswerSourceId,
        })),
      },
    ],
  };
}
