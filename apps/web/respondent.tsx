import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SurveyDefinition } from "../../packages/survey-runtime/definition.ts";
import { api } from "./api.ts";
import type { ResearchConsent } from "../api/research-consent.ts";

type PublishedSurvey = {
  surveyVersionId: string;
  definition: SurveyDefinition;
  researchConsent?: ResearchConsent;
};

export function Respondent({ token }: { token: string }) {
  const [survey, setSurvey] = useState<PublishedSurvey | null>(null);
  const [pending, setPending] = useState(false);
  const [decision, setDecision] = useState<{
    versionId: string;
    accepted: boolean;
  } | null>(null);
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
    const { researchConsent } = survey;
    if (
      researchConsent &&
      (decision?.versionId !== researchConsent.id || !decision.accepted)
    )
      return;
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
        body: {
          surveyVersionId: survey.surveyVersionId,
          answers,
          ...(researchConsent ? { consent: decision } : {}),
        },
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

  const consent = survey?.researchConsent;
  const decided = !!consent && decision?.versionId === consent.id;
  const declined = decided && decision?.accepted === false;
  return (
    <main className="shell respondent">
      <header className="brand">HELPInsights</header>
      <section className="panel">
        <h1>{survey?.definition.title ?? "Survey"}</h1>
        {survey?.definition.description && (
          <p>{survey.definition.description}</p>
        )}
        {!survey && !error && <p>Loading survey…</p>}
        {consent && !decided && (
          <section aria-labelledby="synthetic-consent">
            <h2 id="synthetic-consent">Synthetic study consent</h2>
            <p>{consent.notice}</p>
            <p>Notice revision {consent.revision}</p>
            <div className="actions">
              <button
                type="button"
                onClick={() =>
                  setDecision({ versionId: consent.id, accepted: true })
                }
              >
                I agree to participate
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setDecision({ versionId: consent.id, accepted: false })
                }
              >
                Decline
              </button>
            </div>
          </section>
        )}
        {declined && (
          <p className="message" role="status">
            You declined. No answer was sent.
          </p>
        )}
        {submitted ? (
          <p className="message" role="status">
            Response submitted
          </p>
        ) : (
          survey &&
          (!consent || (decided && !declined)) && (
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
