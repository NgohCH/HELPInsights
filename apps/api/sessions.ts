import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool, PoolClient } from "pg";
import { sendJson } from "./application.ts";

export type Actor = { id: string; displayName: string };
export type WorkspaceRole = "owner" | "editor" | "analyst" | "viewer";

export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const unauthorized = () =>
  new HttpError(401, "UNAUTHORISED", "A valid session is required");

export function readSessionProof(request: IncomingMessage) {
  const credential = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(
    request.headers.authorization ?? "",
  );
  if (!credential) throw unauthorized();
  return createHash("sha256").update(credential[1]).digest();
}

export async function withActor<T>(
  pool: Pool,
  hash: Buffer,
  run: (client: PoolClient, actor: Actor) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<Actor>(
      'SELECT id, display_name AS "displayName" FROM public.resolve_session($1)',
      [hash],
    );
    const actor = rows[0];
    if (!actor) throw unauthorized();
    await client.query("SELECT set_config('helpinsights.actor_id', $1, true)", [
      actor.id,
    ]);
    const result = await run(client, actor);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

export function sessionRoutes(pool: Pool) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ) => {
    if (path !== "/api/v1/me" && path !== "/api/v1/workspaces") return false;
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      sendJson(response, 405, {
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed",
        requestId,
      });
      return true;
    }

    try {
      const data = await withActor(
        pool,
        readSessionProof(request),
        async (client, actor) => {
          if (path === "/api/v1/me") return actor;
          const { rows } = await client.query(
            `SELECT w.id, w.organisation_id AS "organisationId", w.name, p.id AS "defaultRetentionPolicyId"
           FROM public.workspaces w LEFT JOIN public.retention_policies p ON p.workspace_id = w.id
           ORDER BY w.name, w.id`,
          );
          return rows.map(({ defaultRetentionPolicyId, ...row }) =>
            defaultRetentionPolicyId
              ? { ...row, defaultRetentionPolicyId }
              : row,
          );
        },
      );
      sendJson(response, 200, data);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      if (error.status === 401)
        response.setHeader("WWW-Authenticate", 'Bearer realm="HELPInsights"');
      sendJson(response, error.status, {
        code: error.code,
        message: error.message,
        requestId,
      });
    }
    return true;
  };
}
