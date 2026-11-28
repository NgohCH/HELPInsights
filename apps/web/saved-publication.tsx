import { useEffect, useId, useRef, useState } from "react";
import { api } from "./api.ts";
import { PublishAudience, usePublishAudience } from "./publish-audience.tsx";

export type NewPublication = {
  id: string;
  version: number;
  publishedAt: string;
  publicToken: string;
};

export function SavedPublication({
  endpoint,
  workspaceId,
  token,
  etag,
  hasQuestions,
  acceptingResponses,
  saving,
  setSaving,
  onPublished,
  onEnded,
  onError,
}: {
  endpoint: string;
  workspaceId: string;
  token: string;
  etag: string;
  hasQuestions: boolean;
  acceptingResponses: boolean;
  saving: boolean;
  setSaving: (value: boolean) => void;
  onPublished: (version: NewPublication) => void;
  onEnded: () => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState<"publish" | "end" | null>(null);
  const audience = usePublishAudience(
    form === "publish" ? workspaceId : "",
    token,
    "",
  );
  const opener = useRef<HTMLButtonElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const formId = useId();

  useEffect(() => {
    if (form) formHeading.current?.focus();
  }, [form]);
  const canPublish =
    hasQuestions &&
    !!audience.mode &&
    (audience.mode !== "university" || !!audience.policyId);

  function cancel() {
    setForm(null);
    onError("");
    opener.current?.focus();
  }

  async function publish() {
    if (!canPublish || saving) return;
    setSaving(true);
    onError("");
    try {
      const { data } = await api<NewPublication>(endpoint + "/publish", {
        token,
        method: "POST",
        headers: { "If-Match": etag },
        body:
          audience.mode === "university"
            ? {
                eligibilityMode: "university",
                universityPolicyId: audience.policyId,
              }
            : { eligibilityMode: "open" },
      });
      setForm(null);
      onPublished(data);
    } catch (failure) {
      if (audience.mode === "university") audience.refresh();
      onError(
        failure instanceof Error
          ? failure.message
          : "Could not publish the saved draft",
      );
    } finally {
      setSaving(false);
    }
  }

  async function endCollection() {
    if (!acceptingResponses || saving) return;
    setSaving(true);
    onError("");
    try {
      await api(endpoint + "/close", { token, method: "POST" });
      onEnded();
    } catch (failure) {
      onError(
        failure instanceof Error
          ? failure.message
          : "Could not end response collection",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="actions">
        <button
          type="button"
          className="secondary"
          disabled={saving || !hasQuestions}
          aria-expanded={form === "publish"}
          aria-controls={form === "publish" ? formId : undefined}
          onClick={(event) => {
            opener.current = event.currentTarget;
            audience.setMode("");
            audience.setSelectedId("");
            onError("");
            setForm("publish");
          }}
        >
          Publish saved draft
        </button>
        {acceptingResponses && (
          <button
            type="button"
            className="secondary"
            disabled={saving}
            aria-expanded={form === "end"}
            aria-controls={form === "end" ? formId : undefined}
            onClick={(event) => {
              opener.current = event.currentTarget;
              onError("");
              setForm("end");
            }}
          >
            End response collection
          </button>
        )}
      </div>
      {form === "publish" && (
        <div id={formId}>
          <h4 ref={formHeading} tabIndex={-1}>
            Choose respondent access
          </h4>
          {acceptingResponses && (
            <p>
              Publishing creates a new link. Earlier links keep their existing
              respondent access.
            </p>
          )}
          <PublishAudience
            audience={audience}
            disabled={saving}
            requiresSelection
          />
          <div className="actions">
            <button
              type="button"
              disabled={saving || !canPublish}
              onClick={publish}
            >
              Publish version
            </button>
            <button
              type="button"
              className="secondary"
              disabled={saving}
              onClick={cancel}
            >
              Cancel publication
            </button>
          </div>
        </div>
      )}
      {form === "end" && (
        <div id={formId}>
          <h4 ref={formHeading} tabIndex={-1}>
            End response collection
          </h4>
          <p>
            This closes every respondent link to this survey. Existing survey
            responses and publication versions are retained.
          </p>
          <div className="actions">
            <button type="button" disabled={saving} onClick={endCollection}>
              Confirm end of collection
            </button>
            <button
              type="button"
              className="secondary"
              disabled={saving}
              onClick={cancel}
            >
              Keep collecting
            </button>
          </div>
        </div>
      )}
    </>
  );
}
