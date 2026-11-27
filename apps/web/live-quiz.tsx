import { useState, type FormEvent } from "react";
import { api } from "./api.ts";

type LobbySnapshot = {
  id: string;
  state: "lobby";
  mode: "live_poll";
  revision: number;
};
type HostLobby = LobbySnapshot & { pin: string; pinExpiresAt: string };
type GuestLobby = { snapshot: LobbySnapshot; participantToken: string };
type Access = { id: string; authorization: string };

function requestSnapshot({
  id,
  authorization,
}: Access): Promise<LobbySnapshot> {
  return new Promise((resolve, reject) => {
    const url = new URL(
      "/api/v1/live-sessions/" + id + "/socket",
      location.href,
    );
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    const unavailable = () =>
      reject(
        new Error("Lobby connection unavailable. Try refreshing the lobby."),
      );
    const timeout = window.setTimeout(() => {
      unavailable();
      socket.close();
    }, 6000);
    socket.addEventListener(
      "open",
      () => socket.send(JSON.stringify({ authorization })),
      { once: true },
    );
    socket.addEventListener(
      "message",
      (event) => {
        try {
          const { type, snapshot } = JSON.parse(String(event.data));
          if (
            type !== "snapshot" ||
            snapshot?.id !== id ||
            snapshot.state !== "lobby"
          )
            return unavailable();
          resolve(snapshot as LobbySnapshot);
        } catch {
          unavailable();
        } finally {
          socket.close();
        }
      },
      { once: true },
    );
    socket.addEventListener(
      "close",
      () => {
        window.clearTimeout(timeout);
        unavailable();
      },
      { once: true },
    );
  });
}

export function LiveQuiz({ isHost }: { isHost: boolean }) {
  const [access, setAccess] = useState<Access>();
  const [snapshot, setSnapshot] = useState<LobbySnapshot>();
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
      let newAccess: Access;
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
      setSnapshot(await requestSnapshot(newAccess));
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
            ? "Live Poll lobby"
            : isHost
              ? "Present a Live Poll"
              : "Join a Live Poll"}
        </h2>
        {access ? (
          <>
            <p role="status">
              {pending
                ? "Connecting to the lobby"
                : snapshot
                  ? "Lobby snapshot received"
                  : "Lobby connection unavailable"}
            </p>
            {hostLobby && (
              <p>
                Join PIN <output aria-label="Join PIN">{hostLobby.pin}</output>
                {" · "}Expires at{" "}
                {new Date(hostLobby.pinExpiresAt).toLocaleTimeString()}
                {" · "}
                <a href="/live/join">Open guest join page</a>
              </p>
            )}
            <button
              disabled={pending}
              onClick={() =>
                void run(async () => {
                  setSnapshot(await requestSnapshot(access));
                })
              }
            >
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
