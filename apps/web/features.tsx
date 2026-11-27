import { useState, type FormEvent } from "react";
import { api } from "./api.ts";

type RequestStatus = "pending" | "approved" | "denied" | "expired";
type FeatureRequest = {
  id: string;
  purpose: string;
  status: RequestStatus;
  rationale: string | null;
  expiresAt: string | null;
};
type Catalogue = {
  title: string;
  description: string;
  enabled: boolean;
  canRequest: boolean;
  canReview: boolean;
  requests: FeatureRequest[];
};
const statusLabels: Record<RequestStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  denied: "Denied",
  expired: "Expired",
};

export function FeatureCatalogue({
  token,
  workspaceId,
  onAccessChange,
}: {
  token: string;
  workspaceId: string;
  onAccessChange: (enabled: boolean) => void;
}) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const path = "/workspaces/" + workspaceId + "/features/nps";

  async function load() {
    const { data } = await api<Catalogue>(path, { token });
    setCatalogue(data);
    onAccessChange(data.enabled);
  }

  async function run(operation: () => Promise<void>) {
    setError("");
    setPending(true);
    try {
      await operation();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Feature request failed",
      );
    } finally {
      setPending(false);
    }
  }

  function requestAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      await api(path + "/requests", {
        token,
        method: "POST",
        body: { purpose: form.get("purpose"), dataClassification: "anonymous" },
      });
      await load();
    });
  }

  function decide(event: FormEvent<HTMLFormElement>, requestId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = (event.nativeEvent as SubmitEvent).submitter;
    const decision = button?.getAttribute("value") ?? "approve";
    void run(async () => {
      await api(path + "/requests/" + requestId + "/decision", {
        token,
        method: "POST",
        body: {
          decision,
          rationale: form.get("rationale"),
          ...(decision === "approve"
            ? { expiresInDays: Number(form.get("days")) }
            : {}),
        },
      });
      await load();
    });
  }

  return (
    <section className="panel" aria-labelledby="feature-catalogue">
      <h2 id="feature-catalogue">Feature catalogue</h2>
      <button
        type="button"
        className="secondary"
        disabled={pending}
        onClick={() => void run(load)}
      >
        {catalogue ? "Refresh feature catalogue" : "View feature catalogue"}
      </button>
      {catalogue && (
        <>
          <h3>{catalogue.title}</h3>
          <p>{catalogue.description}</p>
          {catalogue.enabled && <p>NPS authoring is available.</p>}
          {catalogue.canRequest && (
            <form onSubmit={requestAccess}>
              <label>
                Purpose
                <input name="purpose" required maxLength={300} />
              </label>
              <p>
                Use this feature for anonymous surveys. Keep names and other
                personal information out of the request.
              </p>
              <button disabled={pending}>Request NPS access</button>
            </form>
          )}
          {catalogue.requests.map((request) => (
            <article key={request.id}>
              <h4>{statusLabels[request.status]}</h4>
              <p>{request.purpose}</p>
              {request.rationale && <p>{request.rationale}</p>}
              {request.expiresAt && (
                <p>
                  Access expiry{" "}
                  <time dateTime={request.expiresAt}>
                    {new Date(request.expiresAt).toLocaleString()}
                  </time>
                </p>
              )}
              {catalogue.canReview && request.status === "pending" && (
                <form onSubmit={(event) => decide(event, request.id)}>
                  <label>
                    Decision rationale
                    <input name="rationale" required maxLength={300} />
                  </label>
                  <label>
                    Access days
                    <input
                      name="days"
                      type="number"
                      min={1}
                      max={90}
                      defaultValue={7}
                      required
                    />
                  </label>
                  <div className="actions">
                    <button value="approve" disabled={pending}>
                      Approve access
                    </button>
                    <button
                      value="deny"
                      className="secondary"
                      formNoValidate
                      disabled={pending}
                    >
                      Deny access
                    </button>
                  </div>
                </form>
              )}
            </article>
          ))}
        </>
      )}
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
    </section>
  );
}
