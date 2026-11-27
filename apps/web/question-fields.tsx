import type { Answer } from "../../packages/survey-runtime/answers.ts";
import { useState } from "react";
import {
  isQuestionVisible,
  type SurveyDefinition,
} from "../../packages/survey-runtime/definition.ts";

export function readAnswers(
  form: FormData,
  definition: SurveyDefinition,
): Answer[] {
  return definition.pages
    .flatMap(({ questions }) => questions)
    .flatMap((question) => {
      const raw = form.get(question.id);
      if (typeof raw !== "string" || !raw.trim()) return [];
      return [
        {
          questionId: question.id,
          value: question.type === "number" ? Number(raw) : raw,
        },
      ];
    });
}

export function QuestionFields({
  definition,
  pageHeading: PageHeading = "h2",
}: {
  definition: SurveyDefinition;
  pageHeading?: "h2" | "h3";
}) {
  const [choices, setChoices] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  return definition.pages.map((page) => {
    const visibleQuestions = page.questions.filter((question) =>
      isQuestionVisible(question, choices),
    );
    if (page.questions.length && !visibleQuestions.length) return null;
    return (
      <section key={page.id} aria-label={page.title || undefined}>
        {page.title && <PageHeading>{page.title}</PageHeading>}
        {visibleQuestions.map((question) =>
          question.type === "single_choice" ? (
            <fieldset key={question.id}>
              <legend>
                {question.title}
                {question.required && (
                  <span className="required"> Required</span>
                )}
              </legend>
              {question.options.map((option) => (
                <label className="choice" key={option.code}>
                  <input
                    type="radio"
                    name={question.id}
                    value={option.code}
                    required={question.required}
                    onChange={
                      question.visibleWhen
                        ? undefined
                        : () =>
                            setChoices((previous) =>
                              new Map(previous).set(question.id, option.code),
                            )
                    }
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
          ) : (
            <label key={question.id}>
              {question.title}
              <input
                type={question.type === "number" ? "number" : "text"}
                name={question.id}
                step={question.type === "number" ? "any" : undefined}
                maxLength={question.type === "short_text" ? 500 : undefined}
                required={question.required}
              />
            </label>
          ),
        )}
      </section>
    );
  });
}
