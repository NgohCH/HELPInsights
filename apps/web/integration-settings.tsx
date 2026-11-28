import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./api.ts";

const endpoint = "/admin/integrations";
const operations = {
  "workspace:read": "Read workspace name",
  "survey:read_status": "Read survey status",
} as const;
type Operation = keyof typeof operations;
type Environment = "development" | "test" | "production";
type Client = {
  id: string;
  name: string;
  department: string;
  purpose: string;
  credentialOwner: string;
  workspaceId: string;
  operations: Operation[];
  status: "pending" | "active" | "revoked";
  expiresAt: string;
  credentialVersion: number;
};
type Settings = { environment: Environment; clients: Client[] };

function ScopeFields({ client }: { client?: Client }) {
  return (
    <>
      <label>
        Workspace scope ID
        <input name="workspaceId" defaultValue={client?.workspaceId} required />
      </label>
      <fieldset>
        <legend>Permitted operations</legend>
        {Object.entries(operations).map(([operation, label]) => (
          <label className="integration-operation" key={operation}>
            <input
              type="checkbox"
              name="operations"
              value={operation}
              defaultChecked={client?.operations.includes(
                operation as Operation,
              )}
            />
            {label}
          </label>
        ))}
      </fieldset>
    </>
  );
}

function permissionScope(form: FormData) {
  return {
    workspaceId: form.get("workspaceId"),
    operations: form.getAll("operations"),
  };
}

export function IntegrationSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [credential, setCredential] = useState<{
    value: string;
    clientId: string;
  } | null>(null);
  const registrationId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1" + endpoint, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return;
        if (!response.ok)
          throw new Error("Integration settings could not be loaded");
        const result: Settings = await response.json();
        if (!controller.signal.aborted) setSettings(result);
      })
      .catch((failure: Error) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, []);

  async function change(body: object, message: string) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const { data } = await api<{ client: Client; credential?: string }>(
        endpoint,
        {
          token: "",
          method: "POST",
          body,
        },
      );
      setSettings((current) => {
        if (!current) return current;
        const clients = current.clients.some(
          (client) => client.id === data.client.id,
        )
          ? current.clients.map((client) =>
              client.id === data.client.id ? data.client : client,
            )
          : [...current.clients, data.client];
        return { ...current, clients };
      });
      const issued = data.credential;
      if (issued) setCredential({ value: issued, clientId: data.client.id });
      else if (data.client.status === "revoked")
        setCredential((current) =>
          current?.clientId === data.client.id ? null : current,
        );
      setStatus(message);
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Integration settings could not be saved",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function register(
    event: FormEvent<HTMLFormElement>,
    environment: Environment,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    registrationId.current ??= crypto.randomUUID();
    if (
      await change(
        {
          action: "register",
          registrationId: registrationId.current,
          name: values.get("name"),
          department: values.get("department"),
          purpose: values.get("purpose"),
          credentialOwner: values.get("credentialOwner"),
          environment,
          ...permissionScope(values),
        },
        "Integration client registered",
      )
    ) {
      registrationId.current = null;
      form.reset();
    }
  }

  if (!settings && !error) return null;
  return (
    <section className="panel" aria-labelledby="integrations-heading">
      <h2 id="integrations-heading">Integration clients</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {status && <p role="status">{status}</p>}
      {credential && (
        <div>
          <p>Store this credential securely. It is displayed once.</p>
          <label>
            Integration credential
            <input
              readOnly
              value={credential.value}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <button type="button" onClick={() => setCredential(null)}>
            Hide credential
          </button>
        </div>
      )}
      {settings && (
        <>
          <p>Environment {settings.environment}</p>
          <details>
            <summary>Register an integration client</summary>
            <form
              onSubmit={(event) => void register(event, settings.environment)}
            >
              <label>
                Client name
                <input name="name" maxLength={160} required />
              </label>
              <label>
                Owning department
                <input name="department" maxLength={160} required />
              </label>
              <label>
                Integration purpose
                <input name="purpose" maxLength={500} required />
              </label>
              <label>
                Credential owner
                <input name="credentialOwner" maxLength={160} required />
              </label>
              <ScopeFields />
              <button disabled={busy}>Register client</button>
            </form>
          </details>
          {settings.clients.map((client) => (
            <details key={client.id}>
              <summary>
                {client.name} ({client.status})
              </summary>
              <p>
                {client.department} · {client.purpose}
              </p>
              <p>Credential owner {client.credentialOwner}</p>
              <p>
                Credential expiry{" "}
                <time dateTime={client.expiresAt}>
                  {new Date(client.expiresAt).toLocaleDateString()}
                </time>
              </p>
              {client.status === "revoked" ? (
                <p>Workspace {client.workspaceId}</p>
              ) : (
                <>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void change(
                        {
                          action: "permissions",
                          clientId: client.id,
                          ...permissionScope(new FormData(event.currentTarget)),
                        },
                        "Integration permissions saved",
                      );
                    }}
                  >
                    <ScopeFields
                      key={client.workspaceId + client.operations.join(",")}
                      client={client}
                    />
                    <button disabled={busy}>Save permissions</button>
                  </form>
                  <div className="actions">
                    {client.status === "pending" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void change(
                            { action: "enable", clientId: client.id },
                            "Integration client enabled",
                          )
                        }
                      >
                        Enable client
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void change(
                          {
                            action: "renew",
                            clientId: client.id,
                            expectedCredentialVersion: client.credentialVersion,
                          },
                          "Integration credential replaced",
                        )
                      }
                    >
                      Renew credential
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void change(
                          { action: "revoke", clientId: client.id },
                          "Integration client revoked",
                        )
                      }
                    >
                      Revoke client
                    </button>
                  </div>
                </>
              )}
            </details>
          ))}
        </>
      )}
    </section>
  );
}
