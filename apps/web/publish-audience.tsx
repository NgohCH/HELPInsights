import { useEffect, useState } from "react";
import { api } from "./api.ts";

type Policy = { id: string; code: string; version: number };
type PolicyList = { enabled: boolean; items: Policy[] };
type PolicyLoad = { workspaceId: string; list: PolicyList | null };

export function usePublishAudience(workspaceId: string, token: string) {
  const [mode, setMode] = useState<"open" | "university">("open");
  const [selectedId, setSelectedId] = useState("");
  const [load, setLoad] = useState<PolicyLoad | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    api<PolicyList>(
      "/workspaces/" + workspaceId + "/university-eligibility-policies",
      { token, signal: controller.signal },
    ).then(
      ({ data }) => {
        if (!controller.signal.aborted) setLoad({ workspaceId, list: data });
      },
      () => {
        if (!controller.signal.aborted) setLoad({ workspaceId, list: null });
      },
    );
    return () => controller.abort();
  }, [workspaceId, token, revision]);

  const current = load?.workspaceId === workspaceId ? load : null;
  const policyId = current?.list?.items.some(({ id }) => id === selectedId)
    ? selectedId
    : "";

  return {
    mode,
    setMode,
    policyId,
    setSelectedId,
    current,
    refresh() {
      setLoad(null);
      setRevision((value) => value + 1);
    },
  };
}

export function PublishAudience({
  audience,
  disabled,
}: {
  audience: ReturnType<typeof usePublishAudience>;
  disabled: boolean;
}) {
  const { mode, setMode, policyId, setSelectedId, current, refresh } = audience;
  if (mode === "open" && (!current || current.list?.enabled === false))
    return null;
  const items = current?.list?.items ?? [];

  return (
    <fieldset disabled={disabled}>
      <legend>Respondent access</legend>
      <label>
        Audience
        <select
          value={mode}
          onChange={(event) =>
            setMode(event.target.value === "university" ? "university" : "open")
          }
        >
          <option value="open">Anyone with the link</option>
          <option value="university">University accounts only</option>
        </select>
      </label>
      {mode === "university" && (
        <>
          <p>Eligible respondents sign in. Their answers remain anonymous.</p>
          {!current ? (
            <p>Loading University eligibility policies…</p>
          ) : !current.list?.enabled ? (
            <p>University eligibility policies are unavailable.</p>
          ) : items.length === 0 ? (
            <p>
              No approved University eligibility policies are available for this
              workspace.
            </p>
          ) : (
            <label>
              University eligibility policy
              <select
                value={policyId}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                <option value="">Choose an approved policy</option>
                {items.map(({ id, code, version }) => (
                  <option key={id} value={id}>
                    {code} (version {version})
                  </option>
                ))}
              </select>
            </label>
          )}
          {current && (
            <button type="button" className="secondary" onClick={refresh}>
              Refresh eligibility policies
            </button>
          )}
        </>
      )}
    </fieldset>
  );
}
