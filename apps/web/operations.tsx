import { useEffect, useState, type FormEvent } from "react";
import { api, signOutUniversity } from "./api.ts";

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
  const [token, setToken] = useState("");
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
        const operations = await readOperations("", signal);
        if (!signal.aborted) setView(operations);
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
  }, [universitySignIn]);

  async function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setView(null);
    setError("");
    try {
      setView(await readOperations(token));
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
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Sign-out failed");
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <h1>Operations</h1>
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
          <a href="/auth/university/start?returnTo=admin">
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
                  <th scope="col">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {view.incidents.map((incident) => (
                  <tr key={incident.id}>
                    <td>{incident.component}</td>
                    <td>{incident.state}</td>
                    <td>{incident.severity.replaceAll("_", " ")}</td>
                    <td>
                      <time dateTime={incident.recordedAt}>
                        {new Date(incident.recordedAt).toLocaleString()}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </main>
  );
}
