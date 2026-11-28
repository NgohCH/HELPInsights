import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, signOutUniversity, type Workspace } from "./api.ts";
import { Results } from "./results.tsx";
import { FeatureCatalogue } from "./features.tsx";
import { DraftPreview } from "./draft-preview.tsx";
import { FeedbackFields, readFeedbackDefinition } from "./guided-feedback.tsx";
import { TemplateLibrary } from "./templates.tsx";
import { UserGuide } from "./user-guide.tsx";
import type {
  Question,
  SurveyDefinition,
} from "../../packages/survey-runtime/definition.ts";

type Draft = { id: string; etag: string };

export function Creator({
  universitySignIn,
  developmentSignIn,
}: {
  universitySignIn: boolean;
  developmentSignIn: boolean;
}) {
  const [institutionalSession, setInstitutionalSession] = useState(false);
  const [token, setToken] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [followUpWhen, setFollowUpWhen] = useState("");
  const [npsWorkspaceId, setNpsWorkspaceId] = useState<string | null>(null);
  const [questionType, setQuestionType] = useState<"single_choice" | "nps">(
    "single_choice",
  );
  const canAuthorNps = workspaceId === npsWorkspaceId;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [startingPoint, setStartingPoint] = useState<
    "simple" | "feedback" | "returned"
  >("simple");
  const guided = startingPoint === "feedback";
  const guidedTrigger = useRef<HTMLButtonElement>(null);
  const selectedWorkspace = workspaces?.find(
    (entry) => entry.id === workspaceId,
  );
  const [starter, setStarter] = useState<SurveyDefinition | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const starterQuestion = starter?.pages[0]?.questions[0];
  const starterOptions =
    starterQuestion?.type === "single_choice"
      ? starterQuestion.options
      : undefined;
  const [ready, setReady] = useState(false);
  const [savedDefinition, setSavedDefinition] =
    useState<SurveyDefinition | null>(null);
  const [previewDefinition, setPreviewDefinition] =
    useState<SurveyDefinition | null>(null);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const [publicLink, setPublicLink] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!universitySignIn) return;
    const controller = new AbortController();
    async function loadInstitutionalWorkspace() {
      try {
        const response = await fetch("/api/v1/workspaces", {
          signal: controller.signal,
        });
        if (!response.ok || controller.signal.aborted) return;
        const entries = (await response.json()) as Workspace[];
        if (controller.signal.aborted) return;
        setInstitutionalSession(true);
        setWorkspaces(entries);
        setWorkspaceId(
          (
            entries.find((workspace) => workspace.defaultRetentionPolicyId) ??
            entries[0]
          )?.id ?? "",
        );
      } catch {
        // The sign-in entry point remains available after a failed session check.
      }
    }
    void loadInstitutionalWorkspace();
    return () => controller.abort();
  }, [universitySignIn]);

  useEffect(() => {
    if (starter) titleInput.current?.focus();
  }, [starter]);
  useEffect(() => {
    if (startingPoint === "returned") guidedTrigger.current?.focus();
  }, [startingPoint]);
  const [guideTopic, setGuideTopic] = useState<string | null>(null);
  const guideTrigger = useRef<HTMLButtonElement>(null);
  const guideButton = useRef<HTMLButtonElement>(null);

  function openGuide(trigger: HTMLButtonElement, topic = "") {
    guideTrigger.current = trigger;
    setGuideTopic(topic);
  }

  function closeGuide() {
    setGuideTopic(null);
    const trigger = guideTrigger.current;
    (trigger?.isConnected ? trigger : guideButton.current)?.focus();
  }

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

  function readSimpleDefinition(form: FormData): SurveyDefinition {
    const field = (name: string) => String(form.get(name) ?? "").trim();
    const title = field("title");
    const questionId = starterQuestion?.id ?? "question";
    const options = [
      {
        code: starterOptions?.[0]?.code ?? "option_1",
        label: field("option1"),
      },
      {
        code: starterOptions?.[1]?.code ?? "option_2",
        label: field("option2"),
      },
    ];
    const questions: Question[] = [
      {
        id: questionId,
        code: starterQuestion?.code ?? "workshop_question",
        title: field("question"),
        required: starterQuestion?.required ?? true,
        ...(questionType === "nps"
          ? { type: "nps" }
          : { type: "single_choice", options }),
      },
    ];
    if (questionType === "single_choice" && followUpWhen) {
      const optionCode = options[followUpWhen === "option_1" ? 0 : 1].code;
      questions.push({
        id: "follow_up",
        code: "workshop_follow_up",
        type: "short_text",
        title: field("followUpQuestion"),
        required: true,
        visibleWhen: { questionId, optionCode },
      });
    }
    return {
      ...starter,
      schemaVersion: "1",
      title,
      pages: [{ ...(starter?.pages[0] ?? { id: "first" }), questions }],
    };
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const definition = guided
      ? readFeedbackDefinition(form)
      : readSimpleDefinition(form);

    setStatus("");
    await run(async () => {
      let current = draft;
      if (!current) {
        const workspace = selectedWorkspace;
        if (!workspace?.defaultRetentionPolicyId)
          throw new Error("Choose a workspace with a retention policy");
        const created = await api<{ id: string }>("/surveys", {
          token,
          method: "POST",
          body: {
            workspaceId,
            title: definition.title,
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
      setSavedDefinition(saved.data);
      setPreviewDefinition(null);
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
          headers: { "If-Match": draft.etag },
        },
      );
      setPublicLink("/respond/" + data.publicToken);
      setPreviewDefinition(null);
      setReady(false);
      setStatus("Survey published");
    });
  }

  return (
    <main className="shell">
      <header className="brand">
        <h1>HELPInsights</h1>
        <button
          type="button"
          className="secondary"
          aria-controls="creator-user-guide"
          ref={guideButton}
          aria-expanded={guideTopic !== null}
          onClick={(event) => openGuide(event.currentTarget)}
        >
          Open user guide
        </button>
      </header>
      {guideTopic !== null && (
        <UserGuide
          key={guideTopic}
          topicKey={guideTopic}
          onClose={closeGuide}
        />
      )}
      {workspaces === null ? (
        <section className="panel compact" aria-labelledby="workspace-heading">
          <h2 id="workspace-heading">Open your workspace</h2>
          {universitySignIn && (
            <a href="/auth/university/start">Sign in with University account</a>
          )}
          {developmentSignIn && (
            <form onSubmit={signIn}>
              <label>
                Development session token
                <input
                  autoComplete="off"
                  type="password"
                  name="token"
                  required
                />
              </label>
              <button disabled={pending}>Open workspace</button>
            </form>
          )}
        </section>
      ) : (
        <section className="panel" aria-labelledby="create-heading">
          <h2 id="create-heading">Create survey</h2>
          {institutionalSession && (
            <button
              type="button"
              disabled={pending}
              onClick={() => void run(() => signOutUniversity("/"))}
            >
              Sign out
            </button>
          )}
          <form onSubmit={save} onChange={() => setReady(false)}>
            <label>
              Workspace
              <select
                value={workspaceId}
                onChange={(event) => {
                  setQuestionType("single_choice");
                  setFollowUpWhen("");
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
            {!draft &&
              (guided ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={pending}
                  onClick={() => setStartingPoint("returned")}
                >
                  Back to simple creation
                </button>
              ) : (
                <fieldset>
                  <legend>Guided creation</legend>
                  <p>
                    Start with five questions about clarity, pace and improving
                    the next class.
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    disabled={pending || !workspaceId}
                    ref={guidedTrigger}
                    onClick={() => setStartingPoint("feedback")}
                  >
                    After-class feedback
                  </button>
                </fieldset>
              ))}
            {startingPoint !== "simple" && (
              <FeedbackFields
                active={guided}
                pending={pending}
                hasRetentionPolicy={
                  !!selectedWorkspace?.defaultRetentionPolicyId
                }
              />
            )}
            <div hidden={guided}>
              <fieldset className="creator-inputs" disabled={guided}>
                {!draft && (
                  <TemplateLibrary
                    token={token}
                    workspaceId={workspaceId}
                    pending={pending}
                    run={run}
                    onClone={(copy, definition) => {
                      setDraft(copy);
                      setStarter(definition);
                      setQuestionType("single_choice");
                      setFollowUpWhen("");
                      setSavedDefinition(definition);
                      setReady(true);
                      setStatus("Template copied to a draft");
                    }}
                  />
                )}
                <label>
                  Survey title
                  <input
                    key={starter ? "template-title" : "new-title"}
                    ref={titleInput}
                    name="title"
                    maxLength={200}
                    defaultValue={starter?.title}
                    required
                  />
                </label>
                {canAuthorNps && (
                  <label>
                    Question type
                    <select
                      value={questionType}
                      onChange={(event) => {
                        setQuestionType(
                          event.target.value === "nps"
                            ? "nps"
                            : "single_choice",
                        );
                        setFollowUpWhen("");
                      }}
                    >
                      <option value="single_choice">Single choice</option>
                      <option value="nps">NPS (0–10)</option>
                    </select>
                  </label>
                )}
                <fieldset key={starter ? "template-question" : "new-question"}>
                  <legend>
                    {questionType === "nps"
                      ? "NPS question"
                      : "Single-choice question"}
                  </legend>
                  <label>
                    Question
                    <input
                      name="question"
                      maxLength={300}
                      defaultValue={starterQuestion?.title}
                      required
                    />
                  </label>
                  {questionType === "single_choice" && (
                    <div className="columns">
                      <label>
                        Option 1
                        <input
                          name="option1"
                          maxLength={160}
                          defaultValue={starterOptions?.[0]?.label}
                          required
                        />
                      </label>
                      <label>
                        Option 2
                        <input
                          name="option2"
                          maxLength={160}
                          defaultValue={starterOptions?.[1]?.label}
                          required
                        />
                      </label>
                    </div>
                  )}
                  {questionType === "single_choice" && (
                    <>
                      <div>
                        <label htmlFor="follow-up-condition">
                          Show a follow-up when
                        </label>
                        <select
                          id="follow-up-condition"
                          value={followUpWhen}
                          onChange={(event) =>
                            setFollowUpWhen(event.target.value)
                          }
                        >
                          <option value="">No follow-up</option>
                          <option value="option_1">Option 1 is selected</option>
                          <option value="option_2">Option 2 is selected</option>
                        </select>
                      </div>
                      {followUpWhen && (
                        <label>
                          Follow-up question
                          <input
                            name="followUpQuestion"
                            maxLength={300}
                            required
                          />
                        </label>
                      )}
                    </>
                  )}
                </fieldset>
              </fieldset>
            </div>
            <div className="actions">
              <button
                disabled={
                  pending ||
                  !workspaceId ||
                  (guided && !selectedWorkspace?.defaultRetentionPolicyId)
                }
              >
                Save draft
              </button>
              <button
                type="button"
                className="secondary"
                ref={previewTrigger}
                disabled={pending || !savedDefinition}
                onClick={() => setPreviewDefinition(savedDefinition)}
              >
                Preview draft
              </button>
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
      {previewDefinition && (
        <DraftPreview
          definition={previewDefinition}
          onHelp={(button) => openGuide(button, "preview")}
          onClose={() => {
            setPreviewDefinition(null);
            previewTrigger.current?.focus();
          }}
        />
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
