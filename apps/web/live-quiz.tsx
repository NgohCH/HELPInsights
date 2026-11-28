import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./api.ts";

import { LivePollQuestion } from "./live-poll-question.tsx";
import type { LiveSnapshot } from "../api/live-quiz-transport.ts";
import type { Option } from "../../packages/survey-runtime/definition.ts";
import { useLiveConnection, type LiveAccess } from "./use-live-connection.ts";

export type LiveMode = "poll" | "game";
export type LiveVersion = {
  id: string;
  title: string;
  options?: Option[];
  surveyId?: string;
};
export type ShowPresenter = (
  mode: LiveMode,
  version: LiveVersion,
  trigger: HTMLButtonElement,
) => void;

export function LivePresentationActions({
  version,
  disabled,
  onPresent,
}: {
  version: LiveVersion;
  disabled: boolean;
  onPresent: ShowPresenter;
}) {
  return (
    <div className="actions">
      <button
        type="button"
        className="secondary"
        disabled={disabled}
        onClick={(event) => onPresent("poll", version, event.currentTarget)}
      >
        Present a Live Poll
      </button>
      {version.options && (
        <button
          type="button"
          className="secondary"
          disabled={disabled}
          onClick={(event) => onPresent("game", version, event.currentTarget)}
        >
          Present a Game Show
        </button>
      )}
    </div>
  );
}

type PreparedPresentation = {
  returnToSurvey(): void;
  onRoomUnavailable?(id: string): void;
} & (
  | {
      token: string;
      versionId: string;
      surveyId?: string;
      title: string;
      options?: { code: string; label: string }[];
      onRoomOpened?(id: string): void;
    }
  | { roomId: string }
);

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

export function LiveQuiz({
  isHost,
  gameShow = false,
  prepared,
  hidden = false,
}: {
  isHost: boolean;
  gameShow?: boolean;
  prepared?: PreparedPresentation;
  hidden?: boolean;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const isPrepared = prepared !== undefined;
  useEffect(() => {
    if (isPrepared && !hidden) title.current?.focus();
  }, [isPrepared, hidden]);
  const setup = prepared && "versionId" in prepared ? prepared : undefined;
  const roomId = prepared && "roomId" in prepared ? prepared.roomId : undefined;
  const [access, setAccess] = useState<LiveAccess | undefined>(() =>
    roomId ? { id: roomId, authorization: null } : undefined,
  );
  const [refresh, setRefresh] = useState(0);
  const { snapshot, connection } = useLiveConnection(access, refresh);
  const [hostLobby, setHostLobby] = useState<HostLobby>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const showingGame = gameShow || snapshot?.mode === "game_show";
  const onRoomUnavailable = prepared?.onRoomUnavailable;

  useEffect(() => {
    if (
      access &&
      (connection === "forbidden" ||
        snapshot?.state === "ended" ||
        snapshot?.state === "archived")
    ) {
      onRoomUnavailable?.(access.id);
    }
  }, [access, connection, snapshot?.state, onRoomUnavailable]);

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
        const token = setup?.token ?? String(fields.get("token")).trim();
        const { data } = await api<HostLobby>("/live-sessions", {
          token,
          method: "POST",
          body: {
            mode: gameShow ? "game_show" : "live_poll",
            quizVersionId:
              setup?.versionId ?? String(fields.get("version")).trim(),
            ...(setup?.surveyId && { surveyId: setup.surveyId }),
            ...(gameShow
              ? {
                  scoring: {
                    correctOptionCode: String(
                      fields.get("correctOptionCode"),
                    ).trim(),
                    durationSeconds: Number(fields.get("durationSeconds")),
                  },
                }
              : {}),
          },
        });
        setHostLobby(data);
        setup?.onRoomOpened?.(data.id);
        newAccess = {
          id: data.id,
          authorization: token ? "Bearer " + token : null,
        };
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

  function sendCommand(
    command: keyof typeof buttonLabels | "next_question" | "close_question",
  ) {
    if (!access || !snapshot || connection !== "connected") return;
    void run(async () => {
      await api<LiveSnapshot>("/live-sessions/" + access.id + "/commands", {
        ...(access.authorization
          ? { headers: { Authorization: access.authorization } }
          : { token: "" }),
        method: "POST",
        body: { command, expectedRevision: String(snapshot.revision) },
      });
    });
  }

  return (
    <main className="shell" hidden={hidden}>
      <header className="brand">
        <h1 ref={title} tabIndex={-1}>
          Live Quiz Arena
        </h1>
        {prepared && (
          <button
            className="secondary"
            type="button"
            onClick={prepared.returnToSurvey}
          >
            Return to survey
          </button>
        )}
      </header>
      <section className="panel compact">
        <h2>
          {snapshot
            ? (showingGame ? "Game Show " : "Live Poll ") + snapshot.state
            : roomId
              ? "Resume live presentation"
              : isHost
                ? gameShow
                  ? "Present a Game Show"
                  : "Present a Live Poll"
                : "Join a live quiz"}
        </h2>
        {setup && <p>{setup.title}</p>}
        {access ? (
          <>
            <p role="status">{connectionLabels[connection]}</p>
            {isHost && snapshot?.state === "lobby" && (
              <p>
                {hostLobby ? (
                  <>
                    Join PIN{" "}
                    <output aria-label="Join PIN">{hostLobby.pin}</output>
                    {" · "}Expires at{" "}
                    {new Date(hostLobby.pinExpiresAt).toLocaleTimeString()}
                  </>
                ) : (
                  "Guests can use the PIN you shared until it expires"
                )}
                {" · "}
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
                    {showingGame
                      ? buttonLabels[command].replace("live poll", "game")
                      : buttonLabels[command]}
                  </button>
                ))}
              </div>
            )}
            {isHost &&
              snapshot?.state === "running" &&
              (!snapshot.question || snapshot.hasNextQuestion) && (
                <button
                  disabled={pending || connection !== "connected"}
                  onClick={() => sendCommand("next_question")}
                >
                  {snapshot.question ? "Next question" : "Open first question"}
                </button>
              )}
            {isHost && snapshot?.question?.open && (
              <button
                disabled={pending || connection !== "connected"}
                onClick={() => sendCommand("close_question")}
              >
                Close question
              </button>
            )}
            {snapshot?.question && (
              <LivePollQuestion
                key={
                  snapshot.question.id + ":" + snapshot.question.openedRevision
                }
                question={snapshot.question}
                access={access}
                active={snapshot.question.open && connection === "connected"}
                isHost={isHost}
                gameShow={showingGame}
                hasVoted={snapshot.hasVoted}
                results={snapshot.results}
                turnout={snapshot.turnout}
              />
            )}
            <button onClick={() => setRefresh((generation) => generation + 1)}>
              Refresh lobby
            </button>
          </>
        ) : (
          <form onSubmit={open}>
            {isHost ? (
              <>
                {!prepared && (
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
                )}
                {gameShow && (
                  <>
                    {setup?.options ? (
                      <label>
                        Correct answer
                        <select name="correctOptionCode" required>
                          <option value="">Choose an answer</option>
                          {setup.options.map(({ code, label }) => (
                            <option key={code} value={code}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <label>
                        Correct option code
                        <input
                          name="correctOptionCode"
                          maxLength={64}
                          autoComplete="off"
                          required
                        />
                      </label>
                    )}
                    <label>
                      Answer time in seconds
                      <input
                        name="durationSeconds"
                        type="number"
                        min={5}
                        max={120}
                        required
                      />
                    </label>
                  </>
                )}
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
