import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../../packages/database/transaction.ts";
import { sendJson } from "./application.ts";
import { cookieValue, universitySessionCookie } from "./entra-sign-in.ts";
import { universityBrowserOrigin } from "./entra-provider.ts";
import type { InstitutionalVerifier } from "./institutional-oauth.ts";

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

export function readSessionProof(
  request: IncomingMessage,
  allowUniversityCookie = true,
) {
  const credential = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(
    request.headers.authorization ?? "",
  );
  if (credential) return createHash("sha256").update(credential[1]).digest();
  if (!allowUniversityCookie || request.headers.authorization !== undefined)
    throw unauthorized();
  const proof = readUniversitySessionProof(request);
  if (!proof) throw unauthorized();
  return proof;
}

export function readUniversitySessionProof(request: IncomingMessage) {
  const origin = universityBrowserOrigin(process.env, request.headers.host);
  const cookie = origin
    ? cookieValue(request, universitySessionCookie)
    : undefined;
  if (!cookie) return undefined;
  if (request.method !== "GET" && request.headers.origin !== origin)
    throw new HttpError(403, "FORBIDDEN", "Same-origin request required");
  return createHash("sha256").update(cookie).digest();
}

export function withActor<T>(
  pool: Pool,
  hash: Buffer,
  run: (client: PoolClient, actor: Actor) => Promise<T>,
): Promise<T> {
  return withResolvedActor(
    pool,
    'SELECT id, display_name AS "displayName" FROM public.resolve_session($1)',
    [hash],
    run,
  );
}

function withResolvedActor<T>(
  pool: Pool,
  query: string,
  identity: readonly unknown[],
  run: (client: PoolClient, actor: Actor) => Promise<T>,
): Promise<T> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<Actor>(query, [...identity]);
    const actor = rows[0];
    if (!actor) throw unauthorized();
    await client.query("SELECT set_config('helpinsights.actor_id', $1, true)", [
      actor.id,
    ]);
    return run(client, actor);
  });
}

export function sessionRoutes(
  pool: Pool,
  verifyInstitutional: InstitutionalVerifier | null = null,
) {
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
      const read = async (client: PoolClient, actor: Actor) => {
        if (path === "/api/v1/me") return actor;
        const { rows } = await client.query(
          `SELECT w.id, w.organisation_id AS "organisationId", w.name, p.id AS "defaultRetentionPolicyId"
           FROM public.workspaces w LEFT JOIN public.retention_policies p ON p.workspace_id = w.id
           ORDER BY w.name, w.id`,
        );
        return rows.map(({ defaultRetentionPolicyId, ...row }) =>
          defaultRetentionPolicyId ? { ...row, defaultRetentionPolicyId } : row,
        );
      };
      const token = /^Bearer ([A-Za-z0-9_.-]{1,8192})$/i.exec(
        request.headers.authorization ?? "",
      )?.[1];
      let data;
      if (verifyInstitutional && token?.includes(".")) {
        const principal = await verifyInstitutional(token);
        if (!principal) throw unauthorized();
        data = await withResolvedActor(
          pool,
          'SELECT id, display_name AS "displayName" FROM public.resolve_institutional_principal($1, $2)',
          [principal.issuer, principal.subject],
          read,
        );
      } else {
        data = await withActor(pool, readSessionProof(request), read);
      }
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
