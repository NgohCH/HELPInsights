import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  InvalidInput,
  object,
} from "../../packages/survey-runtime/definition.ts";
import { HttpError } from "./sessions.ts";

export type LiveSnapshot = {
  id: string;
  mode: "live_poll" | "game_show";
  state: "lobby" | "running" | "paused" | "ended" | "archived";
  revision: number;
  quizVersionId?: string;
  scoresReleased?: true;
  question?: {
    id: string;
    title: string;
    options: Array<{ code: string; label: string }>;
    openedRevision: number;
    open: boolean;
    closesAt?: string;
  };
  hasVoted?: boolean;
  hasNextQuestion?: boolean;
  turnout?: number | null;
  results?: {
    total: number;
    counts: Array<{ code: string; count: number }>;
  } | null;
};

type Audience = { read: () => Promise<LiveSnapshot>; participant?: string };
type Subscription = { refresh: () => void; participant?: string };

export function createLiveRoomTransport(
  resolveRoom: (request: IncomingMessage) => string | undefined,
  authorize: (room: string, authorization: unknown) => Audience,
) {
  const rooms = new Map<string, Set<Subscription>>();

  function update(room: string, participant?: string) {
    for (const member of rooms.get(room) ?? []) {
      if (
        !participant ||
        !member.participant ||
        member.participant === participant
      )
        member.refresh();
    }
  }

  function attach(server: Server) {
    const sockets = new WebSocketServer({
      noServer: true,
      maxPayload: 512,
      perMessageDeflate: false,
    });
    const awaitingPong = new WeakSet<WebSocket>();
    const heartbeat = setInterval(() => {
      for (const socket of sockets.clients) {
        if (socket.readyState !== WebSocket.OPEN) continue;
        if (awaitingPong.has(socket)) {
          socket.terminate();
          continue;
        }
        awaitingPong.add(socket);
        socket.ping();
      }
    }, 20_000);

    server.on("upgrade", (request, transport, head) => {
      const room = resolveRoom(request);
      if (!room || sockets.clients.size >= 256) {
        transport.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      sockets.handleUpgrade(request, transport, head, (socket) => {
        const deadline = setTimeout(() => socket.terminate(), 5000);
        socket.on("error", () => socket.terminate());
        socket.on("pong", () => awaitingPong.delete(socket));
        socket.once("close", () => clearTimeout(deadline));
        socket.once("message", (message, binary) => {
          let audience: Audience;
          try {
            if (binary) throw new InvalidInput("Expected JSON credentials");
            const { authorization } = object(JSON.parse(message.toString()), [
              "authorization",
            ]);
            audience = authorize(room, authorization);
          } catch {
            socket.close(1008);
            return;
          }
          socket.on("message", () => socket.close(1008));

          let reading = false;
          let pending = false;
          let revision = 0;
          let previous = "";
          async function refresh() {
            pending = true;
            if (reading) return;
            reading = true;
            try {
              while (pending && socket.readyState === WebSocket.OPEN) {
                pending = false;
                const snapshot = await audience.read();
                clearTimeout(deadline);
                if (socket.readyState !== WebSocket.OPEN) return;
                const payload = JSON.stringify({ type: "snapshot", snapshot });
                if (snapshot.revision < revision || payload === previous)
                  continue;
                if (socket.bufferedAmount > 32_768) {
                  socket.terminate();
                  return;
                }
                revision = snapshot.revision;
                previous = payload;
                socket.send(payload);
              }
            } catch (error) {
              socket.close(error instanceof HttpError ? 1008 : 1011);
            } finally {
              reading = false;
            }
          }

          const members = rooms.get(room) ?? new Set();
          const subscription = { refresh, participant: audience.participant };
          members.add(subscription);
          rooms.set(room, members);
          socket.once("close", () => {
            members.delete(subscription);
            if (!members.size) rooms.delete(room);
          });
          void refresh();
        });
      });
    });

    return () => {
      clearInterval(heartbeat);
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
    };
  }

  return { update, attach };
}
