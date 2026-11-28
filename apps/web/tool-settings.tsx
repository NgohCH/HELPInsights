import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api.ts";
import { IntegrationSettings } from "./integration-settings.tsx";

const tools = {
  "template-copy": "Template copying",
  "research-consent": "Research consent",
} as const;
type Tool = keyof typeof tools;
const modes = {
  off: "Disabled",
  all: "All eligible creators",
  university: "University creators",
  approved: "Approved users and groups",
} as const;

type Mode = keyof typeof modes;
type Grant = {
  workspaceId: string;
  subjectType: "user" | "group";
  subjectId: string;
};
type Settings = { mode: Mode; grants: Grant[] };

export function ToolSettings({
  universitySignIn,
}: {
  universitySignIn: boolean;
}) {
  const [tool, setTool] = useState<Tool>("template-copy");
  const [adminAuthorized, setAdminAuthorized] = useState(false);
  return (
    <main className="shell">
      <header className="brand">
        <a href="/admin">HELPInsights</a>
      </header>
      <h1>Admin Settings</h1>
      <ToolPolicy
        key={tool}
        universitySignIn={universitySignIn}
        tool={tool}
        setTool={setTool}
        setAdminAuthorized={setAdminAuthorized}
      />
      {adminAuthorized && <IntegrationSettings />}
    </main>
  );
}

function ToolPolicy({
  universitySignIn,
  tool,
  setTool,
  setAdminAuthorized,
}: {
  universitySignIn: boolean;
  tool: Tool;
  setTool: (tool: Tool) => void;
  setAdminAuthorized: (authorized: boolean) => void;
}) {
  const endpoint = "/admin/tools/" + tool;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mode, setMode] = useState<Mode>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!universitySignIn) return;
    const controller = new AbortController();
    api<Settings>(endpoint, { token: "", signal: controller.signal }).then(
      ({ data }) => {
        if (controller.signal.aborted) return;
        setAdminAuthorized(true);
        setSettings(data);
        setMode(data.mode);
      },
      (failure: Error) => {
        if (!controller.signal.aborted) {
          setAdminAuthorized(false);
          setError(failure.message);
        }
      },
    );
    return () => controller.abort();
  }, [universitySignIn, endpoint, setAdminAuthorized]);

  async function save(body: object, message: string) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const { data } = await api<Settings>(endpoint, {
        token: "",
        method: "POST",
        body,
      });
      setSettings(data);
      setMode(data.mode);
      setStatus(message);
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Settings could not be saved",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      await save(
        {
          action: "grant",
          workspaceId: values.get("workspaceId"),
          subjectType: values.get("subjectType"),
          subjectId: values.get("subjectId"),
        },
        "Approval saved",
      )
    )
      form.reset();
  }

  return (
    <>
      {!universitySignIn && <p>University sign-in is unavailable.</p>}
      {!settings && universitySignIn && (
        <p>
          <a href="/auth/university/start?returnTo=settings">
            Sign in with University account
          </a>
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {status && <p role="status">{status}</p>}
      {settings && (
        <>
          <section className="panel" aria-labelledby="tool-heading">
            <label>
              Creator tool
              <select
                disabled={busy}
                value={tool}
                onChange={(event) => setTool(event.target.value as Tool)}
              >
                {Object.entries(tools).map(([key, name]) => (
                  <option value={key} key={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <h2 id="tool-heading">{tools[tool]}</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save({ action: "mode", mode }, "Availability saved");
              }}
            >
              <label>
                Tool availability
                <select
                  value={mode}
                  onChange={(event) => setMode(event.target.value as Mode)}
                >
                  {Object.entries(modes)
                    .filter(
                      ([key]) => tool !== "research-consent" || key !== "all",
                    )
                    .map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                </select>
              </label>
              <button disabled={busy}>Save availability</button>
            </form>
          </section>
          <section className="panel" aria-labelledby="tool-approvals-heading">
            <h2 id="tool-approvals-heading">Workspace approvals</h2>
            <p>
              Approvals apply when the tool is set to Approved users and groups.
            </p>
            <form onSubmit={grant}>
              <label>
                Workspace ID
                <input name="workspaceId" required />
              </label>
              <label>
                Approval type
                <select name="subjectType">
                  <option value="user">User</option>
                  <option value="group">Group</option>
                </select>
              </label>
              <label>
                User or group ID
                <input name="subjectId" required />
              </label>
              <button disabled={busy}>Add approval</button>
            </form>
            {settings.grants.length === 0 ? (
              <p>No approvals</p>
            ) : (
              <ul>
                {settings.grants.map((entry) => (
                  <li
                    key={
                      entry.workspaceId + entry.subjectType + entry.subjectId
                    }
                  >
                    <p>
                      {entry.subjectType} {entry.subjectId} in workspace{" "}
                      {entry.workspaceId}
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={
                        "Revoke " +
                        entry.subjectType +
                        " " +
                        entry.subjectId +
                        " in workspace " +
                        entry.workspaceId
                      }
                      onClick={() =>
                        void save(
                          { action: "revoke", ...entry },
                          "Approval revoked",
                        )
                      }
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
