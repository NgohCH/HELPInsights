import { useState, type FormEvent } from "react";
import { api } from "./api.ts";
import { RecoveryNotices } from "./recovery-notices.tsx";

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

export function Operations() {
  const [token, setToken] = useState("");
  const [view, setView] = useState<{
    health: Health;
    incidents: Incident[];
    sessionToken: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setView(null);
    setError("");
    try {
      const [health, incidents] = await Promise.all([
        api<Health>("/admin/health", { token }),
        api<Incident[]>("/admin/incidents", { token }),
      ]);
      setView({
        health: health.data,
        incidents: incidents.data,
        sessionToken: token,
      });
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Operations unavailable",
      );
    } finally {
      setLoading(false);
      setToken("");
    }
  }

  return (
    <main className="shell">
      <h1>Operations</h1>
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
          <RecoveryNotices token={view.sessionToken} />
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
    </main>
  );
}
