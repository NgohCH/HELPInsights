import { useState, type FormEvent } from "react";
import { api, type Workspace } from "./api.ts";
import { Results } from "./results.tsx";
import { FeatureCatalogue } from "./features.tsx";
import type { SurveyDefinition } from "../../packages/survey-runtime/definition.ts";

type Draft = { id: string; etag: string };

export function Creator() {
  const [token, setToken] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [npsWorkspaceId, setNpsWorkspaceId] = useState<string | null>(null);
  const [questionType, setQuestionType] = useState<"single_choice" | "nps">(
    "single_choice",
  );
  const canAuthorNps = workspaceId === npsWorkspaceId;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ready, setReady] = useState(false);
  const [publicLink, setPublicLink] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function run(operation: () => Promise<void>) {
    setPending(true);
    setError("");
    try {
      await operation();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const credential = String(
      new FormData(event.currentTarget).get("token"),
    ).trim();
    await run(async () => {
      const { data } = await api<Workspace[]>("/workspaces", {
        token: credential,
      });
      setToken(credential);
      setWorkspaces(data);
      setWorkspaceId(
        (
          data.find((workspace) => workspace.defaultRetentionPolicyId) ??
          data[0]
        )?.id ?? "",
      );
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "").trim();
    const title = field("title");
    const definition: SurveyDefinition = {
      schemaVersion: "1",
      title,
      pages: [
        {
          id: "first",
          questions: [
            {
              id: "question",
              code: "workshop_question",
              title: field("question"),
              required: true,
              ...(questionType === "nps"
                ? { type: "nps" }
                : {
                    type: "single_choice",
                    options: [
                      { code: "option_1", label: field("option1") },
                      { code: "option_2", label: field("option2") },
                    ],
                  }),
            },
          ],
        },
      ],
    };

    setStatus("");
    await run(async () => {
      let current = draft;
      if (!current) {
        const workspace = workspaces?.find((entry) => entry.id === workspaceId);
        if (!workspace?.defaultRetentionPolicyId)
          throw new Error("Choose a workspace with a retention policy");
        const created = await api<{ id: string }>("/surveys", {
          token,
          method: "POST",
          body: {
            workspaceId,
            title,
            privacyMode: "anonymous",
            retentionPolicyId: workspace.defaultRetentionPolicyId,
          },
        });
        if (!created.etag) throw new Error("The draft revision is unavailable");
        current = { id: created.data.id, etag: created.etag };
        setDraft(current);
      }
      const saved = await api<SurveyDefinition>(
        "/surveys/" + current.id + "/draft",
        {
          token,
          method: "PUT",
          headers: { "If-Match": current.etag },
          body: definition,
        },
      );
      if (!saved.etag)
        throw new Error("The saved draft revision is unavailable");
      setDraft({ id: current.id, etag: saved.etag });
      setReady(true);
      setStatus("Draft saved");
    });
  }

  async function publish() {
    if (!draft) return;
    await run(async () => {
      const { data } = await api<{ publicToken: string }>(
        "/surveys/" + draft.id + "/publish",
        {
          token,
          method: "POST",
        },
      );
      setPublicLink("/respond/" + data.publicToken);
      setReady(false);
      setStatus("Survey published");
    });
  }

  return (
    <main className="shell">
      <header className="brand">
        <h1>HELPInsights</h1>
      </header>
      {workspaces === null ? (
        <section className="panel compact" aria-labelledby="workspace-heading">
          <h2 id="workspace-heading">Open your workspace</h2>
          <form onSubmit={signIn}>
            <label>
              Development session token
              <input autoComplete="off" type="password" name="token" required />
            </label>
            <button disabled={pending}>Open workspace</button>
          </form>
        </section>
      ) : (
        <section className="panel" aria-labelledby="create-heading">
          <h2 id="create-heading">Create survey</h2>
          <form onSubmit={save} onChange={() => setReady(false)}>
            <label>
              Workspace
              <select
                value={workspaceId}
                onChange={(event) => {
                  setQuestionType("single_choice");
                  setWorkspaceId(event.target.value);
                }}
                disabled={!!draft || pending}
                required
              >
                {!workspaces.length && (
                  <option value="">No workspaces available</option>
                )}
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Survey title
              <input name="title" maxLength={200} required />
            </label>
            {canAuthorNps && (
              <label>
                Question type
                <select
                  value={questionType}
                  onChange={(event) =>
                    setQuestionType(
                      event.target.value === "nps" ? "nps" : "single_choice",
                    )
                  }
                >
                  <option value="single_choice">Single choice</option>
                  <option value="nps">NPS (0–10)</option>
                </select>
              </label>
            )}
            <fieldset>
              <legend>
                {questionType === "nps"
                  ? "NPS question"
                  : "Single-choice question"}
              </legend>
              <label>
                Question
                <input name="question" maxLength={300} required />
              </label>
              {questionType === "single_choice" && (
                <div className="columns">
                  <label>
                    Option 1<input name="option1" maxLength={160} required />
                  </label>
                  <label>
                    Option 2<input name="option2" maxLength={160} required />
                  </label>
                </div>
              )}
            </fieldset>
            <div className="actions">
              <button disabled={pending || !workspaceId}>Save draft</button>
              <button
                type="button"
                className="secondary"
                disabled={!ready || pending}
                onClick={publish}
              >
                Publish survey
              </button>
            </div>
          </form>
          {publicLink && (
            <div className="link-row">
              <a href={publicLink}>Open respondent link</a>
            </div>
          )}
        </section>
      )}
      {workspaces && workspaceId && (
        <FeatureCatalogue
          key={workspaceId}
          token={token}
          workspaceId={workspaceId}
          onAccessChange={(enabled) => {
            setNpsWorkspaceId(enabled ? workspaceId : null);
            if (!enabled) {
              setQuestionType("single_choice");
              if (questionType === "nps") setReady(false);
            }
          }}
        />
      )}
      {draft && publicLink && (
        <Results key={publicLink} surveyId={draft.id} token={token} />
      )}
      {status && (
        <p className="message" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
