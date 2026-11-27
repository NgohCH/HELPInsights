import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SurveyDefinition } from "../../packages/survey-runtime/definition.ts";
import { api } from "./api.ts";

type PublishedSurvey = {
  surveyVersionId: string;
  definition: SurveyDefinition;
};

export function Respondent({ token }: { token: string }) {
  const [survey, setSurvey] = useState<PublishedSurvey | null>(null);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const submissionKey = useRef<string>(null);

  useEffect(() => {
    let active = true;
    api<PublishedSurvey>("/public/s/" + token).then(
      ({ data }) => {
        if (active) setSurvey(data);
      },
      (failure: Error) => {
        if (active) setError(failure.message);
      },
    );
    return () => {
      active = false;
    };
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!survey) return;
    const form = new FormData(event.currentTarget);
    const answers = survey.definition.pages
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
    submissionKey.current ??= globalThis.crypto.randomUUID();
    setPending(true);
    setError("");
    try {
      await api("/public/s/" + token + "/responses", {
        method: "POST",
        headers: { "Idempotency-Key": submissionKey.current },
        body: { surveyVersionId: survey.surveyVersionId, answers },
      });
      setSubmitted(true);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Submission failed",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="shell respondent">
      <header className="brand">HELPInsights</header>
      <section className="panel">
        <h1>{survey?.definition.title ?? "Survey"}</h1>
        {survey?.definition.description && (
          <p>{survey.definition.description}</p>
        )}
        {!survey && !error && <p>Loading survey…</p>}
        {submitted ? (
          <p className="message" role="status">
            Response submitted
          </p>
        ) : (
          survey && (
            <form onSubmit={submit}>
              {survey.definition.pages.map((page) => (
                <section key={page.id} aria-label={page.title || undefined}>
                  {page.title && <h2>{page.title}</h2>}
                  {page.questions.map((question) =>
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
                          maxLength={
                            question.type === "short_text" ? 500 : undefined
                          }
                          required={question.required}
                        />
                      </label>
                    ),
                  )}
                </section>
              ))}
              <button disabled={pending}>Submit response</button>
            </form>
          )
        )}
        {error && (
          <p className="message error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
