import type { Answer } from "../../packages/survey-runtime/answers.ts";
import type { SurveyDefinition } from "../../packages/survey-runtime/definition.ts";

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
          value:
            question.type === "number" || question.type === "nps"
              ? Number(raw)
              : raw,
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
  return definition.pages.map((page) => (
    <section key={page.id} aria-label={page.title || undefined}>
      {page.title && <PageHeading>{page.title}</PageHeading>}
      {page.questions.map((question) =>
        question.type === "single_choice" ? (
          <fieldset key={question.id}>
            <legend>
              {question.title}
              {question.required && <span className="required"> Required</span>}
            </legend>
            {question.options.map((option) => (
              <label className="choice" key={option.code}>
                <input
                  type="radio"
                  name={question.id}
                  value={option.code}
                  required={question.required}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        ) : (
          <label key={question.id}>
            {question.title}
            <input
              type={question.type === "short_text" ? "text" : "number"}
              name={question.id}
              step={
                question.type === "number"
                  ? "any"
                  : question.type === "nps"
                    ? 1
                    : undefined
              }
              min={question.type === "nps" ? 0 : undefined}
              max={question.type === "nps" ? 10 : undefined}
              aria-describedby={
                question.type === "nps" ? question.id + "-range" : undefined
              }
              maxLength={question.type === "short_text" ? 500 : undefined}
              required={question.required}
            />
            {question.type === "nps" && (
              <span id={question.id + "-range"}>
                Enter a whole number from 0 to 10.
              </span>
            )}
          </label>
        ),
      )}
    </section>
  ));
}
