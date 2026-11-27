import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SurveyDefinition } from "../../packages/survey-runtime/definition.ts";
import { api } from "./api.ts";
import type { ResearchConsent } from "../api/research-consent.ts";
import { QuestionFields, readAnswers } from "./question-fields.tsx";

type PublishedSurvey = {
  surveyVersionId: string;
  definition: SurveyDefinition;
  researchConsent?: ResearchConsent;
};

type SurveyView = PublishedSurvey | { eligibilityRequired: true };
type VerifiedAccess = { capability: string; expiresAt: string };

export function Respondent({ token }: { token: string }) {
  const [survey, setSurvey] = useState<PublishedSurvey | null>(null);
  const [decision, setDecision] = useState<{
    versionId: string;
    accepted: boolean;
  } | null>(null);
  const [eligibilityRequired, setEligibilityRequired] = useState(false);
  const [access, setAccess] = useState<VerifiedAccess | null>(null);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const submissionKey = useRef<string>(null);

  useEffect(() => {
    let active = true;
    api<SurveyView>("/public/s/" + token).then(
      ({ data }) => {
        if (!active) return;
        if ("eligibilityRequired" in data) setEligibilityRequired(true);
        else setSurvey(data);
      },
      (failure: Error) => {
        if (active) setError(failure.message);
      },
    );
    return () => {
      active = false;
    };
  }, [token]);

  async function checkEligibility(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const proof = new FormData(event.currentTarget).get("proof");
    setPending(true);
    setError("");
    try {
      const path = "/public/s/" + token;
      const { data: verified } = await api<VerifiedAccess>(
        path + "/eligibility",
        {
          method: "POST",
          body: { proof },
        },
      );
      const { data } = await api<SurveyView>(path, {
        headers: { "X-Survey-Capability": verified.capability },
      });
      if ("eligibilityRequired" in data)
        throw new Error("Eligibility could not be confirmed. Check again.");
      setAccess(verified);
      setSurvey(data);
      setEligibilityRequired(false);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Eligibility check failed",
      );
    } finally {
      setPending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!survey) return;
    if (access && Date.parse(access.expiresAt) <= Date.now()) {
      setSurvey(null);
      setAccess(null);
      setEligibilityRequired(true);
      setError("Eligibility expired. Check eligibility again.");
      return;
    }
    const { researchConsent } = survey;
    if (
      researchConsent &&
      (decision?.versionId !== researchConsent.id || decision.accepted !== true)
    )
      return;
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
        headers: {
          "Idempotency-Key": submissionKey.current,
          ...(access ? { "X-Survey-Capability": access.capability } : {}),
        },
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
        {!survey && !error && !eligibilityRequired && <p>Loading survey…</p>}
        {eligibilityRequired && (
          <form onSubmit={checkEligibility}>
            <p>Use a synthetic Registry credential for this test survey.</p>
            <label>
              Synthetic Registry credential
              <input
                name="proof"
                type="password"
                autoComplete="off"
                maxLength={128}
                required
              />
            </label>
            <button disabled={pending}>Check eligibility</button>
          </form>
        )}
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
