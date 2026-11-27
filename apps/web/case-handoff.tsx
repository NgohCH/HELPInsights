import { useRef, useState, type FormEvent } from "react";
import { caseCategories, casePriorities } from "../case-handoff-policy.ts";
import { api } from "./api.ts";

type Receipt = { eventId: string; sanitisedSummary: string };

export function CaseHandoff() {
  const [approved, setApproved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt>();
  const tokenInput = useRef<HTMLInputElement>(null);
  const approvalInput = useRef<HTMLInputElement>(null);
  const attempt = useRef<{ signature: string; key: string }>(null);

  async function queue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!approved || pending) return;
    const data = new FormData(event.currentTarget);
    const survey = String(data.get("survey"));
    const version = String(data.get("version"));
    const body = {
      reviewDecision: "approved",
      consentOrLawfulBasisRef: data.get("basis"),
      category: data.get("category"),
      priority: data.get("priority"),
    };
    const signature = JSON.stringify([survey, version, body]);
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, key: crypto.randomUUID() };
    }

    setReceipt(undefined);
    setError("");
    setPending(true);
    try {
      const result = await api<Receipt>(
        "/surveys/" +
          encodeURIComponent(survey) +
          "/versions/" +
          encodeURIComponent(version) +
          "/case-handoffs",
        {
          token: String(data.get("token")),
          method: "POST",
          body,
          headers: { "Idempotency-Key": attempt.current.key },
        },
      );
      setReceipt(result.data);
      if (tokenInput.current) tokenInput.current.value = "";
      setApproved(false);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to queue handoff",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="shell">
      <h1>Case handoff</h1>
      <form
        className="panel"
        onSubmit={queue}
        onChange={(event) => {
          if (event.nativeEvent.target !== approvalInput.current)
            setApproved(false);
        }}
      >
        <label>
          Development session token
          <input
            name="token"
            type="password"
            autoComplete="off"
            required
            ref={tokenInput}
          />
        </label>
        <div className="columns">
          <label>
            Survey ID
            <input name="survey" autoComplete="off" required />
          </label>
          <label>
            Survey version ID
            <input name="version" autoComplete="off" required />
          </label>
        </div>
        <label>
          Synthetic basis reference
          <input name="basis" autoComplete="off" required />
        </label>
        <div className="columns">
          <label>
            Category
            <select name="category" required defaultValue="">
              <option value="">Choose a category</option>
              {Object.entries(caseCategories).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select name="priority" required defaultValue="normal">
              {Object.entries(casePriorities).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="choice">
          <input
            type="checkbox"
            ref={approvalInput}
            checked={approved}
            onChange={(event) => setApproved(event.target.checked)}
          />
          I approve this synthetic handoff
        </label>
        <button disabled={!approved || pending} type="submit">
          Approve and queue
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {receipt && (
        <section className="panel">
          <p role="status">Handoff queued</p>
          <p>{receipt.sanitisedSummary}</p>
          <p>Event ID {receipt.eventId}</p>
        </section>
      )}
    </main>
  );
}
