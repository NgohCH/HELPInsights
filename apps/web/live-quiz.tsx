import { useState, type FormEvent } from "react";
import { api } from "./api.ts";

import type { LiveSnapshot } from "../api/live-quiz-transport.ts";
import { useLiveConnection, type LiveAccess } from "./use-live-connection.ts";

type HostLobby = LiveSnapshot & { pin: string; pinExpiresAt: string };
type GuestLobby = { snapshot: LiveSnapshot; participantToken: string };

const actions = {
  lobby: ["start", "end"],
  running: ["pause", "end"],
  paused: ["resume", "end"],
  ended: ["archive"],
  archived: [],
} as const;

const buttonLabels = {
  start: "Start live poll",
  pause: "Pause live poll",
  resume: "Resume live poll",
  end: "End live poll",
  archive: "Archive live poll",
};

const connectionLabels = {
  connecting: "Connecting to the lobby",
  connected: "Connected to the lobby",
  reconnecting: "Reconnecting to the lobby",
  forbidden: "Access to this lobby expired",
};

export function LiveQuiz({ isHost }: { isHost: boolean }) {
  const [access, setAccess] = useState<LiveAccess>();
  const [refresh, setRefresh] = useState(0);
  const { snapshot, connection, acceptSnapshot } = useLiveConnection(
    access,
    refresh,
  );
  const [hostLobby, setHostLobby] = useState<HostLobby>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function run(operation: () => Promise<void>) {
    setError("");
    setPending(true);
    try {
      await operation();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void run(async () => {
      let newAccess: LiveAccess;
      if (isHost) {
        const token = String(fields.get("token")).trim();
        const { data } = await api<HostLobby>("/live-sessions", {
          token,
          method: "POST",
          body: {
            mode: "live_poll",
            quizVersionId: String(fields.get("version")).trim(),
          },
        });
        setHostLobby(data);
        newAccess = { id: data.id, authorization: "Bearer " + token };
      } else {
        const { data } = await api<GuestLobby>("/live-sessions/join", {
          method: "POST",
          body: { pin: String(fields.get("pin")).trim() },
        });
        newAccess = {
          id: data.snapshot.id,
          authorization: "Participant " + data.participantToken,
        };
      }
      setAccess(newAccess);
    });
  }

  function sendCommand(command: keyof typeof buttonLabels) {
    if (!access || !snapshot || connection !== "connected") return;
    void run(async () => {
      const { data } = await api<LiveSnapshot>(
        "/live-sessions/" + access.id + "/commands",
        {
          headers: { Authorization: access.authorization },
          method: "POST",
          body: { command, expectedRevision: String(snapshot.revision) },
        },
      );
      acceptSnapshot(data);
    });
  }

  return (
    <main className="shell">
      <header className="brand">
        <h1>Live Quiz Arena</h1>
      </header>
      <section className="panel compact">
        <h2>
          {snapshot
            ? "Live Poll " + snapshot.state
            : isHost
              ? "Present a Live Poll"
              : "Join a Live Poll"}
        </h2>
        {access ? (
          <>
            <p role="status">{connectionLabels[connection]}</p>
            {hostLobby && snapshot?.state === "lobby" && (
              <p>
                Join PIN <output aria-label="Join PIN">{hostLobby.pin}</output>
                {" Â· "}Expires at{" "}
                {new Date(hostLobby.pinExpiresAt).toLocaleTimeString()}
                {" Â· "}
                <a href="/live/join">Open guest join page</a>
              </p>
            )}
            {isHost && snapshot && actions[snapshot.state].length > 0 && (
              <div>
                {actions[snapshot.state].map((command) => (
                  <button
                    key={command}
                    disabled={pending || connection !== "connected"}
                    onClick={() => sendCommand(command)}
                  >
                    {buttonLabels[command]}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setRefresh((generation) => generation + 1)}>
              Refresh lobby
            </button>
          </>
        ) : (
          <form onSubmit={open}>
            {isHost ? (
              <>
                <label>
                  Development session token
                  <input
                    autoComplete="off"
                    name="token"
                    type="password"
                    required
                  />
                </label>
                <label>
                  Published quiz version ID
                  <input name="version" maxLength={36} required />
                </label>
              </>
            ) : (
              <label>
                Join PIN
                <input
                  autoComplete="off"
                  name="pin"
                  inputMode="numeric"
                  pattern="[0-9]{8}"
                  maxLength={8}
                  required
                />
              </label>
            )}
            <button disabled={pending}>
              {isHost ? "Open live lobby" : "Join live lobby"}
            </button>
          </form>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
    </main>
  );
}
