import { createHmac, randomBytes, randomInt } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { WebSocketServer } from "ws";
import {
  InvalidInput,
  object,
  parseDefinition,
  uuid,
} from "../../packages/survey-runtime/definition.ts";
import { sendJson } from "./application.ts";
import { HttpError, readSessionProof, withActor } from "./sessions.ts";
import { digest, jsonBody, writeClientError } from "./surveys.ts";

const collection = "/api/v1/live-sessions";
const roomPath =
  /^\/api\/v1\/live-sessions\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(\/socket)?$/i;
const denied = () => new HttpError(403, "FORBIDDEN", "Live room unavailable");
const snapshotColumns =
  'id, mode, state, revision, quiz_version_id AS "quizVersionId"';

function credentials(authorization: unknown) {
  const proof =
    typeof authorization === "string" &&
    /^(Bearer|Participant) ([A-Za-z0-9_-]{43})$/i.exec(authorization);
  if (!proof)
    throw new HttpError(
      401,
      "UNAUTHORISED",
      "A valid live room credential is required",
    );
  return {
    isHost: proof[1].toLowerCase() === "bearer",
    hash: digest(proof[2]),
  };
}

export function createLiveQuiz(
  pool: Pool,
  pinKey: string | undefined,
  publicOrigin?: string,
) {
  if (!pinKey || Buffer.byteLength(pinKey) < 32)
    throw new Error(
      "LIVE_QUIZ_PIN_KEY must be at least 32 bytes when Live Quiz is enabled",
    );
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (url.protocol !== "https:" || url.origin !== publicOrigin)
      throw new Error("LIVE_QUIZ_ORIGIN must be an HTTPS origin");
  }

  const pinDigest = (pin: string) =>
    createHmac("sha256", pinKey).update(pin).digest();

  function originAllowed(request: IncomingMessage) {
    const host = request.headers.host;
    const allowed =
      publicOrigin ??
      (host && /^127\.0\.0\.1:\d+$/.test(host) ? "http://" + host : null);
    return allowed !== null && request.headers.origin === allowed;
  }

  async function snapshot(id: string, authorization: unknown) {
    const proof = credentials(authorization);
    const result = proof.isHost
      ? await withActor(pool, proof.hash, (client) =>
          client.query(
            `SELECT ${snapshotColumns} FROM public.live_sessions WHERE id = $1`,
            [id],
          ),
        )
      : await pool.query(
          "SELECT * FROM public.read_participant_lobby($1, $2)",
          [id, proof.hash],
        );
    if (!result.rows[0]) throw denied();
    return result.rows[0];
  }

  async function route(
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ) {
    const room = roomPath.exec(path);
    const isJoin = path === collection + "/join";
    if (path !== collection && !isJoin && (!room || room[2])) return false;
    try {
      if (request.headers.origin && !originAllowed(request)) throw denied();
      const expectedMethod = room ? "GET" : "POST";
      if (request.method !== expectedMethod) {
        response.setHeader("Allow", expectedMethod);
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      if (room) {
        sendJson(
          response,
          200,
          await snapshot(room[1], request.headers.authorization),
        );
        return true;
      }
      if (isJoin) {
        const { pin } = object(await jsonBody(request), ["pin"]);
        if (typeof pin !== "string" || !/^[0-9]{8}$/.test(pin)) throw denied();
        const budget = await pool.query(
          "SELECT public.consume_live_join_budget() AS allowed",
        );
        if (!budget.rows[0]?.allowed) {
          response.setHeader("Retry-After", "60");
          throw new HttpError(
            429,
            "RATE_LIMITED",
            "Too many join attempts. Try again shortly.",
          );
        }
        const participantToken = randomBytes(32).toString("base64url");
        const {
          rows: [joined],
        } = await pool.query("SELECT * FROM public.join_live_lobby($1, $2)", [
          pinDigest(pin),
          digest(participantToken),
        ]);
        if (!joined) throw denied();
        sendJson(response, 200, { snapshot: joined, participantToken });
        return true;
      }

      const proof = readSessionProof(request);
      const body = object(await jsonBody(request), ["quizVersionId", "mode"]);
      const quizVersionId = uuid(body.quizVersionId, "Quiz version");
      if (body.mode !== "live_poll") throw new InvalidInput("Choose Live Poll");
      const created = await withActor(pool, proof, async (client, actor) => {
        const {
          rows: [version],
        } = await client.query<{ definition: unknown }>(
          `SELECT v.definition FROM public.survey_versions v
           JOIN public.surveys s ON s.id = v.survey_id
           WHERE v.id = $1 AND s.status = 'published'
             AND public.workspace_role(s.workspace_id) IN ('owner', 'editor')`,
          [quizVersionId],
        );
        if (!version) throw denied();
        const questions = parseDefinition(version.definition).pages.flatMap(
          (page) => page.questions,
        );
        if (
          !questions.length ||
          !questions.every((question) => question.type === "single_choice")
        )
          throw new InvalidInput(
            "A Live Poll needs published choice questions",
          );
        for (let attempt = 0; attempt < 5; attempt++) {
          const pin = String(randomInt(100_000_000)).padStart(8, "0");
          const {
            rows: [lobby],
          } = await client.query(
            `INSERT INTO public.live_sessions (quiz_version_id, host_id, mode, pin_hash)
             VALUES ($1, $2, 'live_poll', $3) ON CONFLICT DO NOTHING
             RETURNING ${snapshotColumns}, pin_expires_at AS "pinExpiresAt"`,
            [quizVersionId, actor.id, pinDigest(pin)],
          );
          if (lobby) return { ...lobby, pin };
        }
        throw new HttpError(
          503,
          "UNAVAILABLE",
          "Could not allocate a join PIN",
        );
      });
      sendJson(response, 201, created);
    } catch (error) {
      writeClientError(response, error, requestId);
    }
    return true;
  }

  function attachSockets(server: Server) {
    const sockets = new WebSocketServer({
      noServer: true,
      maxPayload: 512,
      perMessageDeflate: false,
    });
    server.on("upgrade", (request, transport, head) => {
      const room = roomPath.exec(request.url ?? "");
      if (
        !room?.[2] ||
        !originAllowed(request) ||
        sockets.clients.size >= 256
      ) {
        transport.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      sockets.handleUpgrade(request, transport, head, (socket) => {
        const timeout = setTimeout(() => socket.terminate(), 5000);
        socket.on("error", () => socket.terminate());
        socket.once("close", () => clearTimeout(timeout));
        socket.once("message", async (message, binary) => {
          try {
            if (binary) throw denied();
            const { authorization } = object(JSON.parse(message.toString()), [
              "authorization",
            ]);
            const current = await snapshot(room[1], authorization);
            socket.send(
              JSON.stringify({ type: "snapshot", snapshot: current }),
              () => socket.close(1000),
            );
          } catch (error) {
            const refused =
              error instanceof HttpError ||
              error instanceof InvalidInput ||
              error instanceof SyntaxError;
            socket.close(refused ? 1008 : 1011);
          }
        });
      });
    });
    return () => {
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
    };
  }

  return { route, attachSockets };
}
