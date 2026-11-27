import { useEffect, useState } from "react";
import type { LiveSnapshot } from "../api/live-quiz-transport.ts";

export type LiveAccess = { id: string; authorization: string };

type Connection = "connecting" | "connected" | "reconnecting" | "forbidden";

export function useLiveConnection(
  access: LiveAccess | undefined,
  refresh: number,
) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot>();
  const [connection, setConnection] = useState<Connection>("connecting");

  function acceptSnapshot(next: LiveSnapshot) {
    setSnapshot((current) =>
      !current || current.id !== next.id || current.revision <= next.revision
        ? next
        : current,
    );
  }

  useEffect(() => {
    if (!access) return;
    const { id, authorization } = access;
    let current: WebSocket | undefined;
    let retry: number | undefined;
    let deadline: number | undefined;
    let attempt = 0;
    let forbidden = false;
    const url = new URL(
      "/api/v1/live-sessions/" + id + "/socket",
      location.href,
    );
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";

    function disconnect() {
      window.clearTimeout(retry);
      window.clearTimeout(deadline);
      const old = current;
      current = undefined;
      old?.close();
    }

    function reconnectLater() {
      setConnection("reconnecting");
      if (!navigator.onLine) return;
      const delay = Math.min(500 * 2 ** attempt, 5000);
      attempt = Math.min(attempt + 1, 4);
      retry = window.setTimeout(connect, delay);
    }

    function connect() {
      disconnect();
      if (forbidden) return;
      if (!navigator.onLine) {
        setConnection("reconnecting");
        return;
      }
      const socket = new WebSocket(url);
      current = socket;
      deadline = window.setTimeout(() => socket.close(), 6000);
      socket.addEventListener(
        "open",
        () => {
          if (current === socket)
            socket.send(JSON.stringify({ authorization: authorization }));
        },
        { once: true },
      );
      socket.addEventListener("message", (event) => {
        if (current !== socket) return;
        try {
          const { type, snapshot: incoming } = JSON.parse(String(event.data));
          if (
            type !== "snapshot" ||
            incoming?.id !== id ||
            !Number.isSafeInteger(incoming.revision) ||
            incoming.revision < 1
          ) {
            socket.close();
            return;
          }
          window.clearTimeout(deadline);
          attempt = 0;
          acceptSnapshot(incoming as LiveSnapshot);
          setConnection("connected");
        } catch {
          socket.close();
        }
      });
      socket.addEventListener(
        "close",
        (event) => {
          if (current !== socket) return;
          disconnect();
          if (event.code === 1008) {
            forbidden = true;
            setConnection("forbidden");
          } else {
            reconnectLater();
          }
        },
        { once: true },
      );
    }

    function offline() {
      disconnect();
      if (!forbidden) setConnection("reconnecting");
    }

    setConnection("connecting");
    window.addEventListener("online", connect);
    window.addEventListener("offline", offline);
    connect();
    return () => {
      window.removeEventListener("online", connect);
      window.removeEventListener("offline", offline);
      disconnect();
    };
  }, [access, refresh]);

  return { snapshot, connection };
}
