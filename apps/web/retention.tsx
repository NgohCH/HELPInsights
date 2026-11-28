import { useState, type FormEvent } from "react";
import { api } from "./api.ts";

const dispositions = {
  not_closed: "Survey is still open",
  missing_deadline: "Retention deadline is missing",
  scheduled: "Within retention period",
  held: "Protected by a hold",
  eligible: "Retention period ended",
  live_session_present: "Disposal blocked by a linked live session",
  export_pending: "Disposal blocked by a queued export",
};

type Summary = {
  disposition: keyof typeof dispositions;
  expiryAt: string | null;
  protectedUntil: string | null;
};

type RetentionView = {
  summary: Summary;
  reviewed: boolean;
  previewError?: string;
};

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function Deadline({ value }: { value: string | null }) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Unavailable";
  return <time dateTime={value}>{dateTime.format(new Date(value))} UTC</time>;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function Retention({
  token,
  initialSurvey,
}: {
  token: string;
  initialSurvey: string;
}) {
  const [surveyId, setSurveyId] = useState(initialSurvey);
  const [view, setView] = useState<RetentionView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [approved, setApproved] = useState(false);
  const path = `/surveys/${encodeURIComponent(surveyId.trim())}/retention`;

  async function readRetention() {
    const { data: summary } = await api<Summary>(path, { token });
    try {
      const { data } = await api<Summary>(path + "/disposal-preview", {
        token,
      });
      setView({ summary: data, reviewed: true });
    } catch (failure) {
      setView({
        summary,
        reviewed: false,
        previewError: errorMessage(failure, "Disposal preview is unavailable"),
      });
    }
  }

  async function checkRetention(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setView(null);
    setApproved(false);
    setError("");
    try {
      await readRetention();
    } catch (failure) {
      setError(errorMessage(failure, "Retention status is unavailable"));
    } finally {
      setPending(false);
    }
  }

  async function approveHold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setPending(true);
    setApproved(false);
    setError("");
    try {
      const expiresAt = new Date(String(values.get("expiresAt")) + "Z");
      await api(path + "/holds", {
        token,
        method: "POST",
        body: {
          reason: values.get("reason"),
          evidenceReference: String(values.get("evidenceReference")).trim(),
          expiresAt: expiresAt.toISOString(),
        },
      });
      form.reset();
      setApproved(true);
      setView(null);
      await readRetention();
    } catch (failure) {
      setError(errorMessage(failure, "Retention request failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      id="survey-retention"
      className="panel"
      aria-labelledby="retention-heading"
    >
      <h2 id="retention-heading">Survey retention</h2>
      <form onSubmit={checkRetention}>
        <label>
          Survey ID
          <input
            value={surveyId}
            required
            disabled={pending}
            onChange={(event) => {
              setSurveyId(event.target.value);
              setView(null);
              setApproved(false);
              setError("");
            }}
          />
        </label>
        <button disabled={pending}>Check retention</button>
      </form>
      {pending && <p role="status">Updating retention information…</p>}
      {approved && <p role="status">Hold approved.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {view && (
        <>
          <dl aria-live="polite">
            <dt>{view.reviewed ? "Disposal preview" : "Retention status"}</dt>
            <dd>
              {view.reviewed && view.summary.disposition === "eligible"
                ? "Eligible for disposal"
                : dispositions[view.summary.disposition]}
            </dd>
            <dt>Retention deadline</dt>
            <dd>
              <Deadline value={view.summary.expiryAt} />
            </dd>
            {view.summary.protectedUntil && (
              <>
                <dt>Protected until</dt>
                <dd>
                  <Deadline value={view.summary.protectedUntil} />
                </dd>
              </>
            )}
          </dl>
          {view.previewError && <p>{view.previewError}</p>}
          {view.reviewed && (
            <>
              <p>
                Preview only. Checking eligibility leaves survey data intact.
              </p>
              <h3>Record a retention hold</h3>
              <form onSubmit={approveHold}>
                <label>
                  Hold reason
                  <select name="reason" required disabled={pending}>
                    <option value="">Choose a reason</option>
                    <option value="legal">Legal</option>
                    <option value="research">Research</option>
                  </select>
                </label>
                <label>
                  Evidence reference
                  <input
                    name="evidenceReference"
                    required
                    disabled={pending}
                    aria-describedby="hold-reference-help"
                  />
                </label>
                <small id="hold-reference-help">
                  Enter the evidence record UUID.
                </small>
                <label>
                  Hold expiry (UTC)
                  <input
                    name="expiresAt"
                    type="datetime-local"
                    required
                    disabled={pending}
                  />
                </label>
                <button disabled={pending}>Approve hold</button>
              </form>
            </>
          )}
        </>
      )}
    </section>
  );
}
