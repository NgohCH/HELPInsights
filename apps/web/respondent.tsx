import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SurveyDefinition } from "../../packages/survey-runtime/definition.ts";
import { api } from "./api.ts";
import { QuestionFields, readAnswers } from "./question-fields.tsx";

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
    const answers = readAnswers(
      new FormData(event.currentTarget),
      survey.definition,
    );
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
              <QuestionFields definition={survey.definition} />
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
