import { useEffect, useState, type FormEvent } from "react";
import { api, signOutUniversity } from "./api.ts";
import { Retention } from "./retention.tsx";

type Health = {
  status: string;
  components: { name: string; status: string }[];
};

type Incident = {
  id: string;
  component: string;
  state: string;
  severity: string;
  recordedAt: string;
  source?: "export_worker";
  observedAt?: string;
};

async function readOperations(token: string, signal?: AbortSignal) {
  const [health, incidents] = await Promise.all([
    api<Health>("/admin/health", { token, signal }),
    api<Incident[]>("/admin/incidents", { token, signal }),
  ]);
  return { health: health.data, incidents: incidents.data };
}

export function Operations({
  universitySignIn,
  developmentSignIn,
}: {
  universitySignIn: boolean;
  developmentSignIn: boolean;
}) {
  const query = new URLSearchParams(location.search);
  const retentionOnly = query.get("view") === "retention";
  const requestedSurvey = query.get("survey");
  const initialSurvey =
    requestedSurvey &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestedSurvey)
      ? requestedSurvey
      : "";
  const [token, setToken] = useState("");
  const [developmentToken, setDevelopmentToken] = useState<string | null>(null);
  const [institutionalSession, setInstitutionalSession] = useState(false);
  const [view, setView] = useState<Awaited<
    ReturnType<typeof readOperations>
  > | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(universitySignIn);

  useEffect(() => {
    if (!universitySignIn) return;
    const controller = new AbortController();
    const { signal } = controller;
    async function loadUniversitySession() {
      try {
        const response = await fetch("/api/v1/me", { signal });
        if (signal.aborted || response.status === 401) return;
        if (!response.ok) throw new Error("University session unavailable");
        setInstitutionalSession(true);
        if (!retentionOnly) {
          const operations = await readOperations("", signal);
          if (!signal.aborted) setView(operations);
        }
      } catch (failure) {
        if (!signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Operations unavailable",
          );
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }
    void loadUniversitySession();
    return () => controller.abort();
  }, [universitySignIn, retentionOnly]);

  async function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setView(null);
    setDevelopmentToken(null);
    setError("");
    try {
      await api("/me", { token });
      setDevelopmentToken(token);
      if (!retentionOnly) setView(await readOperations(token));
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Operations unavailable",
      );
    } finally {
      setLoading(false);
      setToken("");
    }
  }

  async function signOut() {
    setLoading(true);
    setError("");
    try {
      await signOutUniversity("/admin");
      setView(null);
      setInstitutionalSession(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Sign-out failed");
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <h1>Operations</h1>
      <nav aria-label="Operations navigation" className="actions">
        <a href="/">Workspace</a>
        {retentionOnly && <a href="/admin">Operations dashboard</a>}
      </nav>
      {universitySignIn && (
        <p>
          <a href="/admin/settings">Admin Settings</a>
        </p>
      )}
      {institutionalSession && (
        <button type="button" disabled={loading} onClick={() => void signOut()}>
          Sign out
        </button>
      )}
      {universitySignIn && !institutionalSession && !loading && (
        <p>
          <a
            href={
              retentionOnly
                ? "/auth/university/start?returnTo=retention" +
                  (initialSurvey
                    ? "&survey=" + encodeURIComponent(initialSurvey)
                    : "")
                : "/auth/university/start?returnTo=admin"
            }
          >
            Sign in with University account
          </a>
        </p>
      )}
      {developmentSignIn && !institutionalSession && (
        <form className="panel" onSubmit={open}>
          <label>
            Development session token
            <input
              type="password"
              autoComplete="off"
              required
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <button disabled={loading} type="submit">
            Open operations
          </button>
        </form>
      )}
      {loading && <p role="status">Loading operations</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {view && (
        <>
          <h2>Service health</h2>
          <p>Overall status: {view.health.status}</p>
          <dl>
            {view.health.components.map((component) => (
              <div key={component.name}>
                <dt>{component.name}</dt>
                <dd>{component.status}</dd>
              </div>
            ))}
          </dl>
          <h2 id="incident-heading">Recent incidents</h2>
          {view.incidents.length === 0 ? (
            <p>No incidents recorded.</p>
          ) : (
            <table aria-labelledby="incident-heading">
              <thead>
                <tr>
                  <th scope="col">Component</th>
                  <th scope="col">State</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Source</th>
                  <th scope="col">Time</th>
                </tr>
              </thead>
              <tbody>
                {view.incidents.map((incident) => (
                  <tr key={incident.id}>
                    <td>{incident.component}</td>
                    <td>{incident.state}</td>
                    <td>{incident.severity.replaceAll("_", " ")}</td>
                    <td>
                      {incident.source === "export_worker"
                        ? "Export worker"
                        : "Operator"}
                    </td>
                    <td>
                      <time
                        dateTime={incident.observedAt ?? incident.recordedAt}
                      >
                        {new Date(
                          incident.observedAt ?? incident.recordedAt,
                        ).toLocaleString()}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      {institutionalSession && (
        <Retention token="" initialSurvey={initialSurvey} />
      )}
      {!institutionalSession && developmentToken !== null && (
        <Retention
          key={developmentToken}
          token={developmentToken}
          initialSurvey={initialSurvey}
        />
      )}
    </main>
  );
}
