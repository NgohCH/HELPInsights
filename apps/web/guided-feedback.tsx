import { useEffect, useRef } from "react";
import type {
  Question,
  SurveyDefinition,
} from "../../packages/survey-runtime/definition.ts";

const questions: Question[] = [
  {
    id: "clarity",
    code: "clarity",
    type: "single_choice",
    title: "How clear was today’s class?",
    required: true,
    options: [
      { code: "clear", label: "Clear" },
      { code: "partly_clear", label: "Partly clear" },
      { code: "unclear", label: "Unclear" },
    ],
  },
  {
    id: "pace",
    code: "pace",
    type: "single_choice",
    title: "How did the pace feel?",
    required: true,
    options: [
      { code: "about_right", label: "About right" },
      { code: "too_fast", label: "Too fast" },
      { code: "too_slow", label: "Too slow" },
    ],
  },
  {
    id: "practice",
    code: "practice",
    type: "single_choice",
    title: "Did you have enough time to practise?",
    required: true,
    options: [
      { code: "enough", label: "Enough practice" },
      { code: "more_needed", label: "More practice needed" },
    ],
  },
  {
    id: "helped",
    code: "helped",
    type: "short_text",
    title: "What helped you learn?",
    required: false,
  },
  {
    id: "improve",
    code: "improve",
    type: "short_text",
    title: "What could we improve next class?",
    required: false,
  },
];

const titleField = "feedback-title";
const promptField = (question: Question) => "feedback-prompt-" + question.id;
const optionField = (question: Question, code: string) =>
  "feedback-option-" + question.id + "-" + code;

export function readFeedbackDefinition(form: FormData): SurveyDefinition {
  const field = (name: string) => String(form.get(name) ?? "").trim();

  return {
    schemaVersion: "1",
    title: field(titleField),
    description: "Please leave out names and other identifying details.",
    pages: [
      {
        id: "feedback",
        questions: questions.map((question) => {
          const title = field(promptField(question));
          if (question.type !== "single_choice") return { ...question, title };
          return {
            ...question,
            title,
            options: question.options.map(({ code }) => ({
              code,
              label: field(optionField(question, code)),
            })),
          };
        }),
      },
    ],
  };
}

export function FeedbackFields({
  active,
  pending,
  hasRetentionPolicy,
}: {
  active: boolean;
  pending: boolean;
  hasRetentionPolicy: boolean;
}) {
  const title = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active) title.current?.focus();
  }, [active]);

  return (
    <div hidden={!active}>
      <fieldset className="creator-inputs" disabled={!active || pending}>
        <legend>After-class feedback</legend>
        <p>Anyone with the link can answer anonymously.</p>
        <p>
          {hasRetentionPolicy
            ? "Responses follow this workspace’s retention policy."
            : "Choose a workspace with a retention policy before saving."}
        </p>
        <label>
          Feedback survey title
          <input
            ref={title}
            name={titleField}
            defaultValue="After-class feedback"
            maxLength={200}
            required
          />
        </label>
        {questions.map((question, index) => (
          <fieldset key={question.id}>
            <legend>
              {question.type === "single_choice"
                ? "Required single choice"
                : "Optional written answer"}
            </legend>
            <label>
              Prompt {index + 1}
              <input
                name={promptField(question)}
                defaultValue={question.title}
                maxLength={300}
                required
              />
            </label>
            {question.type === "single_choice" &&
              question.options.map(({ code, label }, optionIndex) => (
                <label key={code}>
                  Choice {optionIndex + 1}
                  <input
                    name={optionField(question, code)}
                    defaultValue={label}
                    maxLength={160}
                    required
                  />
                </label>
              ))}
          </fieldset>
        ))}
      </fieldset>
    </div>
  );
}
