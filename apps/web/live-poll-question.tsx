import { useEffect, useState, type FormEvent } from "react";
import type { LiveSnapshot } from "../api/live-quiz-transport.ts";
import { api } from "./api.ts";
import type { LiveAccess } from "./use-live-connection.ts";

type Props = {
  question: NonNullable<LiveSnapshot["question"]>;
  access: LiveAccess;
  active: boolean;
  isHost: boolean;
  gameShow: boolean;
  hasVoted?: boolean;
  results: LiveSnapshot["results"];
  turnout: LiveSnapshot["turnout"];
};

export function LivePollQuestion({
  question,
  access,
  active,
  isHost,
  gameShow,
  hasVoted,
  results,
  turnout,
}: Props) {
  const [choice, setChoice] = useState("");
  const [ballot, setBallot] = useState<{ answer: string; key: string }>();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const deadline = question.closesAt;
  const mayAnswer = active && !expired;
  const timing = deadline ? (
    <p>
      {expired
        ? "Answer time ended"
        : "Answers close at " + new Date(deadline).toLocaleTimeString()}
    </p>
  ) : null;

  useEffect(() => {
    if (!deadline) return;
    const delay = Date.parse(deadline) - Date.now();
    if (delay <= 0) {
      setExpired(true);
      return;
    }
    const timer = window.setTimeout(() => setExpired(true), delay);
    return () => window.clearTimeout(timer);
  }, [deadline]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mayAnswer || submitting || !choice) return;
    const attempt =
      ballot?.answer === choice
        ? ballot
        : { answer: choice, key: crypto.randomUUID() };
    setBallot(attempt);
    setSubmitting(true);
    setError("");
    try {
      await api("/live-sessions/" + access.id + "/answers", {
        method: "POST",
        body: {
          questionId: question.id,
          answer: choice,
          openedRevision: question.openedRevision,
        },
        headers: {
          Authorization: access.authorization,
          "Idempotency-Key": attempt.key,
        },
      });
      setAccepted(true);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Answer unavailable",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (isHost)
    return (
      <section aria-label="Live poll results">
        <h3>{question.title}</h3>
        {timing}
        {gameShow ? (
          <p>Scores are private.</p>
        ) : results ? (
          <>
            <p>{results.total} votes</p>
            <ul>
              {question.options.map((option) => (
                <li key={option.code}>
                  {option.label}{" "}
                  <output aria-label={option.label}>
                    {results.counts.find((count) => count.code === option.code)
                      ?.count ?? 0}
                  </output>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>
            {turnout
              ? "At least " + turnout + " votes submitted"
              : "Fewer than five votes submitted"}
            . Counts are available after closing when privacy rules permit.
          </p>
        )}
      </section>
    );

  if (hasVoted || accepted)
    return (
      <section aria-label="Live poll vote">
        <h3>{question.title}</h3>
        <p>{gameShow ? "Answer received" : "Vote received"}</p>
      </section>
    );

  return (
    <form onSubmit={submit}>
      {timing}
      <fieldset disabled={!mayAnswer || submitting}>
        <legend>{question.title}</legend>
        {question.options.map((option) => (
          <label key={option.code}>
            <input
              name="poll-choice"
              type="radio"
              value={option.code}
              required
              checked={choice === option.code}
              onChange={() => setChoice(option.code)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <button disabled={!mayAnswer || submitting || !choice}>
        {gameShow ? "Submit answer" : "Submit vote"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
