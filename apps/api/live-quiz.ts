import { createHmac, randomBytes, randomInt } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool, PoolClient } from "pg";
import {
  InvalidInput,
  object,
  parseDefinition,
  uuid,
} from "../../packages/survey-runtime/definition.ts";
import { sendJson } from "./application.ts";
import {
  createLiveRoomTransport,
  type LiveSnapshot,
} from "./live-quiz-transport.ts";
import {
  HttpError,
  readSessionProof,
  readUniversitySessionProof,
  withActor,
} from "./sessions.ts";
import { digest, jsonBody, writeClientError } from "./surveys.ts";

const collection = "/api/v1/live-sessions";
const roomPath =
  /^\/api\/v1\/live-sessions\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:\/(socket|commands|answers))?$/i;
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

function browserHost(request: IncomingMessage) {
  const hash = readUniversitySessionProof(request);
  if (!hash)
    throw new HttpError(
      401,
      "UNAUTHORISED",
      "A valid live room credential is required",
    );
  return { isHost: true, hash };
}

function requestCredentials(request: IncomingMessage) {
  const authorization = request.headers.authorization;
  return authorization === undefined
    ? browserHost(request)
    : credentials(authorization);
}

function parseGameRule(value: unknown) {
  const { correctOptionCode, durationSeconds } = object(value, [
    "correctOptionCode",
    "durationSeconds",
  ]);
  if (
    typeof correctOptionCode !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(correctOptionCode) ||
    typeof durationSeconds !== "number" ||
    !Number.isInteger(durationSeconds) ||
    durationSeconds < 5 ||
    durationSeconds > 120
  )
    throw new InvalidInput(
      "Use a published option code and an answer time of 5 to 120 seconds",
    );
  return { correctOptionCode, durationSeconds };
}

export function createLiveQuiz(
  pool: Pool,
  pinKey: string | undefined,
  publicOrigin?: string,
  gameShowEnabled = false,
  universityOrigin?: string | null,
) {
  if (!pinKey || Buffer.byteLength(pinKey) < 32)
    throw new Error(
      "LIVE_QUIZ_PIN_KEY must be at least 32 bytes when Live Quiz is enabled",
    );
  if (publicOrigin && universityOrigin && publicOrigin !== universityOrigin)
    throw new Error(
      "LIVE_QUIZ_ORIGIN must match the University browser origin",
    );
  const liveOrigin = publicOrigin ?? universityOrigin;
  if (liveOrigin) {
    const url = new URL(liveOrigin);
    if (url.protocol !== "https:" || url.origin !== liveOrigin)
      throw new Error("LIVE_QUIZ_ORIGIN must be an HTTPS origin");
  }

  const pinDigest = (pin: string) =>
    createHmac("sha256", pinKey).update(pin).digest();

  function originAllowed(request: IncomingMessage) {
    const host = request.headers.host;
    const allowed =
      liveOrigin ??
      (host && /^127\.0\.0\.1:\d+$/.test(host) ? "http://" + host : null);
    return allowed !== null && request.headers.origin === allowed;
  }

  async function readSnapshot(
    executor: Pool | PoolClient,
    id: string,
    proof: ReturnType<typeof credentials>,
  ) {
    const {
      rows: [data],
    } = await executor.query<{ snapshot: LiveSnapshot | null }>(
      "SELECT public.read_live_room_snapshot($1, $2, $3, $4) AS snapshot",
      [id, proof.hash, proof.isHost, gameShowEnabled],
    );
    return data.snapshot;
  }

  async function snapshot(
    id: string,
    proof: ReturnType<typeof credentials>,
  ): Promise<LiveSnapshot> {
    const current = await readSnapshot(pool, id, proof);
    if (current) return current;
    // Preserve 401 for an expired presenter credential and 403 for a foreign room.
    if (proof.isHost)
      await withActor(pool, proof.hash, async () => {
        throw denied();
      });
    throw denied();
  }

  const events = createLiveRoomTransport(
    (request) => {
      const room = roomPath.exec(request.url ?? "");
      return room?.[2] === "socket" && originAllowed(request)
        ? room[1].toLowerCase()
        : undefined;
    },
    (id, authorization, request) => {
      const proof =
        authorization === null
          ? browserHost(request)
          : credentials(authorization);
      return {
        read: () => snapshot(id, proof),
        participant: proof.isHost ? undefined : proof.hash.toString("hex"),
      };
    },
  );

  async function command(id: string, request: IncomingMessage) {
    const proof = requestCredentials(request);
    if (!proof.isHost) throw denied();
    const body = object(await jsonBody(request), [
      "command",
      "expectedRevision",
    ]);
    const revision = body.expectedRevision;
    if (
      typeof body.command !== "string" ||
      ![
        "start",
        "pause",
        "resume",
        "end",
        "archive",
        "next_question",
        "close_question",
      ].includes(body.command) ||
      typeof revision !== "string" ||
      !/^[1-9][0-9]{0,9}$/.test(revision) ||
      Number(revision) > 2_147_483_647
    )
      throw new InvalidInput("Choose a valid command and revision");

    const updated = await withActor(pool, proof.hash, async (client) => {
      const {
        rows: [outcome],
      } = await client.query<{ result: string }>(
        "SELECT public.command_live_room($1, $2, $3, $4, $5) AS result",
        [proof.hash, id, Number(revision), body.command, gameShowEnabled],
      );
      if (outcome.result === "unauthorised")
        throw new HttpError(401, "UNAUTHORISED", "A valid session is required");
      if (outcome.result === "forbidden") throw denied();
      if (outcome.result === "conflict")
        throw new HttpError(
          409,
          "CONFLICT",
          "The live room changed or cannot perform that command",
        );
      const current = await readSnapshot(client, id, proof);
      if (!current) throw denied();
      return current;
    });
    events.update(updated.id);
    return updated;
  }

  async function vote(id: string, request: IncomingMessage) {
    const proof = credentials(request.headers.authorization);
    if (proof.isHost) throw denied();
    const key = uuid(request.headers["idempotency-key"], "Idempotency key");
    const body = object(await jsonBody(request), [
      "questionId",
      "answer",
      "openedRevision",
    ]);
    const { questionId, answer, openedRevision } = body;
    const isCode = (value: unknown) =>
      typeof value === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
    if (
      !isCode(questionId) ||
      !isCode(answer) ||
      typeof openedRevision !== "number" ||
      !Number.isInteger(openedRevision) ||
      openedRevision < 1 ||
      openedRevision > 2_147_483_647
    )
      throw new InvalidInput(
        "Choose a valid question, answer and opening revision",
      );

    const {
      rows: [outcome],
    } = await pool.query<{
      result: string;
      questionId: string;
      acceptedAt: Date;
    }>(
      "SELECT * FROM public.submit_live_room_answer($1, $2, $3, $4, $5, $6, $7)",
      [
        id,
        proof.hash,
        questionId,
        openedRevision,
        answer,
        key,
        gameShowEnabled,
      ],
    );
    const { result, ...receipt } = outcome;
    if (result === "forbidden") throw denied();
    if (result === "conflict")
      throw new HttpError(
        409,
        "CONFLICT",
        "This ballot was already cast or the question changed",
      );
    if (result === "invalid")
      throw new HttpError(
        422,
        "INVALID_ANSWER",
        "Choose an option on the published question",
      );
    if (result === "accepted") events.update(id, proof.hash.toString("hex"));
    return receipt;
  }

  async function route(
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ) {
    const room = roomPath.exec(path);
    const isJoin = path === collection + "/join";
    if (path !== collection && !isJoin && (!room || room[2] === "socket"))
      return false;
    try {
      if (request.headers.origin && !originAllowed(request)) throw denied();
      const expectedMethod = room && !room[2] ? "GET" : "POST";
      if (request.method !== expectedMethod) {
        response.setHeader("Allow", expectedMethod);
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      if (room) {
        const id = room[1].toLowerCase();
        const body =
          room[2] === "commands"
            ? await command(id, request)
            : room[2] === "answers"
              ? await vote(id, request)
              : await snapshot(id, requestCredentials(request));
        sendJson(response, 200, body);
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
        } = await pool.query(
          "SELECT * FROM public.join_live_room($1, $2, $3)",
          [pinDigest(pin), digest(participantToken), gameShowEnabled],
        );
        if (!joined) throw denied();
        sendJson(response, 200, { snapshot: joined, participantToken });
        return true;
      }

      const proof = readSessionProof(request);
      const body = object(await jsonBody(request), [
        "quizVersionId",
        "mode",
        "scoring",
      ]);
      const quizVersionId = uuid(body.quizVersionId, "Quiz version");
      const mode = body.mode;
      if (mode !== "live_poll" && mode !== "game_show")
        throw new InvalidInput("Choose an available live mode");
      if (mode === "game_show" && !gameShowEnabled) throw denied();
      const scoring =
        mode === "game_show" ? parseGameRule(body.scoring) : undefined;
      if (mode === "live_poll" && body.scoring !== undefined)
        throw new InvalidInput("Live Poll accepts ballot choices");
      const created = await withActor(pool, proof, async (client, actor) => {
        const {
          rows: [version],
        } = await client.query<{ definition: unknown; conditional: boolean }>(
          `SELECT v.definition, v.definition @? '$.pages[*].questions[*].visibleWhen' AS conditional
           FROM public.survey_versions v
           JOIN public.surveys s ON s.id = v.survey_id
           WHERE v.id = $1 AND s.status = 'published' AND public.live_version_is_open(v.id)
             AND public.workspace_role(s.workspace_id) IN ('owner', 'editor')`,
          [quizVersionId],
        );
        if (!version) throw denied();
        if (version.conditional)
          throw new InvalidInput(
            "Live Poll requires questions without conditional visibility",
          );
        const questions = parseDefinition(version.definition).pages.flatMap(
          (page) => page.questions,
        );
        if (
          !questions.length ||
          !questions.every((question) => question.type === "single_choice")
        )
          throw new InvalidInput(
            "A live room needs published choice questions",
          );
        if (scoring && questions.length !== 1)
          throw new InvalidInput(
            "Game Show requires one published choice question",
          );
        for (let attempt = 0; attempt < 5; attempt++) {
          const pin = String(randomInt(100_000_000)).padStart(8, "0");
          const {
            rows: [lobby],
          } = await client.query(
            `INSERT INTO public.live_sessions (quiz_version_id, host_id, mode, pin_hash)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING
             RETURNING ${snapshotColumns}, pin_expires_at AS "pinExpiresAt"`,
            [quizVersionId, actor.id, mode, pinDigest(pin)],
          );
          if (!lobby) continue;
          if (scoring) {
            const {
              rows: [rule],
            } = await client.query<{ configured: boolean }>(
              "SELECT public.configure_live_game($1, $2, $3, $4) AS configured",
              [
                lobby.id,
                proof,
                scoring.correctOptionCode,
                scoring.durationSeconds,
              ],
            );
            if (!rule.configured)
              throw new InvalidInput(
                "Choose an option from the published question for the private answer key",
              );
          }
          return { ...lobby, pin };
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

  return { route, attachSockets: events.attach };
}
