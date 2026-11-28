import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./application.ts";

const startPath = "/auth/university/start";
const callbackPath = "/auth/university/callback";
const logoutPath = "/auth/university/logout";
const attemptCookie = "__Host-helpinsights-sign-in";
export const universitySessionCookie = "__Host-helpinsights-session";
const attemptLifetime = 300;
export const universitySessionLifetime = 1800;
const opaqueValue = /^[A-Za-z0-9_-]{43}$/;

type Principal = {
  issuer: string;
  subject: string;
  groupIds: string[];
  issuedAt: number;
  expiresAt: number;
};
type Attempt = {
  state: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
  returnPath: string;
};
type UniversityProvider = {
  appOrigin: string | ((host?: string) => string | null);
  authorization(parameters: Record<string, string>): URL;
  exchange(callback: URL, attempt: Attempt): Promise<Principal | null>;
};
type SessionStore = {
  issue(principal: Principal, tokenHash: Buffer): Promise<boolean>;
  revoke(tokenHash: Buffer): Promise<void>;
};

function randomValue() {
  return randomBytes(32).toString("base64url");
}

export function cookieValue(request: IncomingMessage, name: string) {
  const matches = (request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(name + "="));
  const value = matches.length === 1 ? matches[0].slice(name.length + 1) : "";
  return opaqueValue.test(value) ? value : undefined;
}

function cookie(name: string, value: string, lifetime: number) {
  return (
    name +
    "=" +
    value +
    "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" +
    lifetime
  );
}

function redirect(response: ServerResponse, to: string) {
  response.writeHead(303, { Location: to });
  response.end();
}

export function entraSignInRoutes(
  provider: UniversityProvider,
  sessions: SessionStore,
) {
  const attempts = new Map<string, Attempt>();

  return async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    requestId: string,
  ) => {
    if (![startPath, callbackPath, logoutPath].includes(path)) return false;

    const origin =
      typeof provider.appOrigin === "string"
        ? provider.appOrigin
        : provider.appOrigin(request.headers.host);
    if (!origin) return false;
    const redirectUri = origin + callbackPath;
    const requiredMethod = path === logoutPath ? "POST" : "GET";
    if (request.method !== requiredMethod) {
      response.setHeader("Allow", requiredMethod);
      sendJson(response, 405, {
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed",
        requestId,
      });
      return true;
    }

    if (path === startPath) {
      const now = Date.now();
      for (const [key, attempt] of attempts) {
        if (attempt.expiresAt > now) break;
        attempts.delete(key);
      }
      const previous = cookieValue(request, attemptCookie);
      if (previous) attempts.delete(previous);
      if (attempts.size >= 2048) {
        sendJson(response, 503, {
          code: "UNAVAILABLE",
          message: "Sign-in temporarily unavailable",
          requestId,
        });
        return true;
      }
      const key = randomValue();
      const query = new URLSearchParams(
        (request.url ?? "").slice(startPath.length),
      );
      const requested = query.getAll("returnTo");
      const destination = requested.length === 1 ? requested[0] : "";
      const surveys = query.getAll("survey");
      const retentionSurvey =
        surveys.length === 1 &&
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(surveys[0])
          ? "&survey=" + encodeURIComponent(surveys[0])
          : "";
      const attempt: Attempt = {
        returnPath:
          destination === "retention"
            ? "/admin?view=retention" + retentionSurvey + "#survey-retention"
            : destination === "admin"
              ? "/admin"
              : destination === "settings"
                ? "/admin/settings"
                : /^\/respond\/[A-Za-z0-9_-]{43}$/.test(destination)
                  ? destination
                  : "/",
        state: randomValue(),
        nonce: randomValue(),
        verifier: randomValue(),
        expiresAt: now + attemptLifetime * 1000,
      };
      const target = provider.authorization({
        redirect_uri: redirectUri,
        scope: "openid",
        state: attempt.state,
        nonce: attempt.nonce,
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(attempt.verifier)
          .digest("base64url"),
      });
      attempts.set(key, attempt);
      response.setHeader(
        "Set-Cookie",
        cookie(attemptCookie, key, attemptLifetime),
      );
      redirect(response, target.href);
      return true;
    }

    if (path === logoutPath) {
      if (request.headers.origin !== origin) {
        sendJson(response, 403, {
          code: "FORBIDDEN",
          message: "Same-origin request required",
          requestId,
        });
        return true;
      }
      const token = cookieValue(request, universitySessionCookie);
      if (token)
        await sessions.revoke(createHash("sha256").update(token).digest());
      response.setHeader("Set-Cookie", cookie(universitySessionCookie, "", 0));
      redirect(response, "/");
      return true;
    }

    const key = cookieValue(request, attemptCookie);
    const attempt = key ? attempts.get(key) : undefined;
    const callback = new URL(redirectUri);
    callback.search = (request.url ?? "").slice(callbackPath.length);
    const states = callback.searchParams.getAll("state");
    const codes = callback.searchParams.getAll("code");
    const deny = () => {
      sendJson(response, 401, {
        code: "UNAUTHORISED",
        message: "University sign-in could not be completed",
        requestId,
      });
      return true;
    };
    if (
      !key ||
      !attempt ||
      attempt.expiresAt <= Date.now() ||
      states.length !== 1 ||
      states[0] !== attempt.state
    )
      return deny();
    attempts.delete(key);
    const clearAttempt = cookie(attemptCookie, "", 0);
    response.setHeader("Set-Cookie", clearAttempt);
    if (codes.length !== 1 || !codes[0] || callback.searchParams.has("error"))
      return deny();

    const principal = await provider.exchange(callback, attempt);
    if (!principal) return deny();
    const token = randomValue();
    if (
      !(await sessions.issue(
        principal,
        createHash("sha256").update(token).digest(),
      ))
    )
      return deny();
    response.setHeader("Set-Cookie", [
      clearAttempt,
      cookie(universitySessionCookie, token, universitySessionLifetime),
    ]);
    redirect(response, attempt.returnPath);
    return true;
  };
}
