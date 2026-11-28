import { useCallback, useEffect, useRef, useState } from "react";
import type { SurveyDefinition } from "../../packages/survey-runtime/definition.ts";
import { api } from "./api.ts";
import { DraftPreview } from "./draft-preview.tsx";
import { Results } from "./results.tsx";
import { SavedDraftEditor } from "./saved-draft-editor.tsx";
import { SavedPublication } from "./saved-publication.tsx";

type SurveySummary = {
  id: string;
  workspaceId: string;
  title: string;
  status: "draft" | "published" | "closed";
};
type SurveyDetails = SurveySummary & {
  draft: SurveyDefinition | null;
  canEdit: boolean;
  canViewResults: boolean;
};
type SurveyList = { items: SurveySummary[]; nextCursor: string | null };
type Version = { id: string; version: number; publishedAt: string };
const statusLabel = {
  draft: "Draft",
  published: "Published",
  closed: "Closed",
};

export function WorkspaceSurveys({
  workspaceId,
  token,
  refreshKey,
  canAuthorNps,
  saving,
  setSaving,
  onHelp,
}: {
  workspaceId: string;
  token: string;
  refreshKey?: string;
  canAuthorNps: boolean;
  saving: boolean;
  setSaving: (value: boolean) => void;
  onHelp: (button: HTMLButtonElement) => void;
}) {
  const [catalogue, setCatalogue] = useState<SurveyList | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const load = useCallback(
    async (cursor?: string) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      const query = new URLSearchParams({ workspaceId });
      if (cursor) query.set("cursor", cursor);
      setLoading(true);
      setError("");
      try {
        const { data } = await api<SurveyList>("/surveys?" + query.toString(), {
          token,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setCatalogue((current) =>
          cursor && current
            ? { ...data, items: [...current.items, ...data.items] }
            : data,
        );
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not load surveys",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [workspaceId, token],
  );

  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, [load, refreshKey]);

  return (
    <section
      id="workspace-surveys"
      className="panel results"
      aria-labelledby="workspace-surveys-heading"
    >
      <h2 id="workspace-surveys-heading" ref={heading} tabIndex={-1}>
        Workspace surveys
      </h2>
      <div aria-live="polite">
        {loading && <p>Loading surveys…</p>}
        {!loading && !error && catalogue?.items.length === 0 && (
          <p>There are no surveys in this workspace yet.</p>
        )}
      </div>
      {!!catalogue?.items.length && (
        <ul>
          {catalogue.items.map((survey) => (
            <li key={survey.id}>
              <button
                className="secondary"
                type="button"
                disabled={editing || saving}
                onClick={(event) => {
                  trigger.current = event.currentTarget;
                  setSelectedId(survey.id);
                }}
              >
                Open {survey.title}
              </button>{" "}
              <span>{statusLabel[survey.status]}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button
          className="secondary"
          type="button"
          disabled={loading || saving}
          onClick={() => void load()}
        >
          Refresh surveys
        </button>
        {catalogue?.nextCursor && (
          <button
            className="secondary"
            type="button"
            disabled={loading || saving}
            onClick={() => void load(catalogue.nextCursor!)}
          >
            Load more surveys
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      {selectedId && (
        <SavedSurvey
          key={selectedId}
          surveyId={selectedId}
          workspaceId={workspaceId}
          token={token}
          editing={editing}
          setEditing={setEditing}
          canAuthorNps={canAuthorNps}
          saving={saving}
          setSaving={setSaving}
          onHelp={onHelp}
          onSave={(saved) =>
            setCatalogue(
              (current) =>
                current && {
                  ...current,
                  items: current.items.map((entry) =>
                    entry.id === saved.id
                      ? { ...entry, title: saved.title, status: saved.status }
                      : entry,
                  ),
                },
            )
          }
          onClose={() => {
            setSelectedId("");
            const button = trigger.current;
            (button?.isConnected ? button : heading.current)?.focus();
          }}
        />
      )}
    </section>
  );
}

function SavedSurvey({
  surveyId,
  workspaceId,
  token,
  editing,
  setEditing,
  canAuthorNps,
  saving,
  setSaving,
  onHelp,
  onSave,
  onClose,
}: {
  surveyId: string;
  workspaceId: string;
  token: string;
  editing: boolean;
  setEditing: (editing: boolean) => void;
  canAuthorNps: boolean;
  saving: boolean;
  setSaving: (value: boolean) => void;
  onHelp: (button: HTMLButtonElement) => void;
  onSave: (survey: SurveySummary) => void;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<{
    survey: SurveyDetails;
    etag: string | null;
    versions: Version[];
  } | null>(null);
  const [reload, setReload] = useState(0);
  const [preview, setPreview] = useState(false);
  const [publicationNotice, setPublicationNotice] = useState<{
    message: string;
    path?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const endpoint = "/surveys/" + surveyId;
  const draft = record?.survey.draft;
  const etag = record?.etag;

  useEffect(() => {
    const controller = new AbortController();
    const options = { token, signal: controller.signal };
    Promise.all([
      api<SurveyDetails>(endpoint, options),
      api<Version[]>(endpoint + "/versions", options),
    ]).then(
      ([{ data: survey, etag }, { data: versions }]) => {
        if (controller.signal.aborted) return;
        if (survey.workspaceId !== workspaceId) {
          setError("This survey is unavailable in the selected workspace.");
          return;
        }
        setRecord({ survey, etag, versions });
      },
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not open the survey",
          );
      },
    );
    return () => controller.abort();
  }, [endpoint, reload, token, workspaceId]);

  useEffect(() => {
    heading.current?.focus();
  }, [record?.survey.id]);

  async function save(updated: SurveyDefinition) {
    if (!record?.survey.draft || !etag || saving || !record.survey.canEdit)
      return;
    setSaving(true);
    setError("");
    try {
      const saved = await api<SurveyDefinition>(endpoint + "/draft", {
        token,
        method: "PUT",
        headers: { "If-Match": etag },
        body: updated,
      });
      const survey = {
        ...record.survey,
        title: saved.data.title,
        draft: saved.data,
      };
      setRecord({ ...record, survey, etag: saved.etag });
      onSave(survey);
      setEditing(false);
      heading.current?.focus();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not save the draft",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="report" aria-label="Saved survey details">
      <h3 ref={heading} tabIndex={-1}>
        {record?.survey.title ?? "Saved survey"}
      </h3>
      {!record && !error && <p aria-live="polite">Loading survey…</p>}
      {!editing && (
        <div className="actions">
          {draft && (
            <button
              className="secondary"
              type="button"
              ref={previewTrigger}
              disabled={saving}
              onClick={() => setPreview(true)}
            >
              Preview saved draft
            </button>
          )}
          {draft && etag && record?.survey.canEdit && (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setError("");
                setPreview(false);
                setEditing(true);
              }}
            >
              Edit saved draft
            </button>
          )}
          <button
            type="button"
            className="secondary"
            disabled={saving || (!record && !error)}
            onClick={() => {
              setRecord(null);
              setPublicationNotice(null);
              setError("");
              setPreview(false);
              setReload((value) => value + 1);
            }}
          >
            Reload saved survey
          </button>
          <button
            type="button"
            className="secondary"
            disabled={saving}
            onClick={onClose}
          >
            Close saved survey
          </button>
        </div>
      )}
      {record && !draft && <p>This survey has no saved draft content yet.</p>}
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {!editing && !preview && draft && etag && record?.survey.canEdit && (
        <SavedPublication
          endpoint={endpoint}
          workspaceId={workspaceId}
          token={token}
          etag={etag}
          hasQuestions={draft.pages.some((page) => page.questions.length > 0)}
          acceptingResponses={record.survey.status === "published"}
          saving={saving}
          setSaving={setSaving}
          onPublished={({ publicToken, ...version }) => {
            const survey = { ...record.survey, status: "published" as const };
            setRecord({
              ...record,
              survey,
              versions: [version, ...record.versions],
            });
            setPublicationNotice({
              message: "Saved survey published",
              path: "/respond/" + publicToken,
            });
            onSave(survey);
            heading.current?.focus();
          }}
          onEnded={() => {
            const survey = {
              ...record.survey,
              status: "closed" as const,
              canEdit: false,
            };
            setRecord({ ...record, survey });
            setPublicationNotice({ message: "Response collection ended" });
            onSave(survey);
            heading.current?.focus();
          }}
          onError={setError}
        />
      )}
      {publicationNotice && (
        <>
          <p className="message" role="status">
            {publicationNotice.message}
          </p>
          {publicationNotice.path && (
            <a
              role="link"
              aria-disabled={saving}
              href={saving ? undefined : publicationNotice.path}
            >
              Open new respondent link
            </a>
          )}
        </>
      )}
      {editing && draft && (
        <SavedDraftEditor
          initial={draft}
          canAuthorNps={canAuthorNps}
          saving={saving}
          onSave={save}
          onCancel={() => {
            setError("");
            setEditing(false);
            heading.current?.focus();
          }}
        />
      )}
      {preview && draft && (
        <DraftPreview
          definition={draft}
          onHelp={onHelp}
          onClose={() => {
            setPreview(false);
            previewTrigger.current?.focus();
          }}
        />
      )}
      {record && (
        <>
          <h4>Publication history</h4>
          {record.versions.length ? (
            <ol>
              {record.versions.map((version) => (
                <li key={version.id}>
                  <span>Version {version.version}</span>{" "}
                  <time dateTime={version.publishedAt}>
                    {new Date(version.publishedAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p>No published versions yet.</p>
          )}
          {record.versions.length > 0 && record.survey.canViewResults && (
            <Results
              surveyId={surveyId}
              token={token}
              versions={record.versions}
            />
          )}
        </>
      )}
    </section>
  );
}
