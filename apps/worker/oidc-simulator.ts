import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { SignJWT } from "jose";

if (process.env.NODE_ENV !== "test")
  throw new Error("Synthetic provider requires the disposable test runtime");
const issuer = "http://oidc-simulator:3002";
const client = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenant = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "oidc-fixture",
  alg: "RS256",
  use: "sig",
};
const invalidSigner = generateKeyPairSync("rsa", {
  modulusLength: 2048,
}).privateKey;
const choices = [
  "owner",
  "viewer",
  "operations-viewer",
  "survey-creator",
  "eligibility-student",
  "wrong nonce",
  "wrong issuer",
  "wrong tenant",
  "wrong audience",
  "wrong signature",
  "expired",
  "unbound",
];
const grants = new Map<string, { query: URLSearchParams; subject: string }>();

async function form(request: IncomingMessage) {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 8192) throw new Error("Fixture body exceeded its limit");
  }
  return new URLSearchParams(body);
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", issuer);
    if (url.pathname === "/keys") {
      response.writeHead(200, { "Content-Type": "application/json" });
      return response.end(JSON.stringify({ keys: [publicJwk] }));
    }
    if (url.pathname === "/authorize" && request.method === "GET") {
      const destination = url.searchParams.get("redirect_uri");
      if (
        !destination ||
        !/^http:\/\/127\.0\.0\.1:\d+\/auth\/university\/callback$/.test(
          destination,
        ) ||
        url.searchParams.get("client_id") !== client ||
        url.searchParams.get("code_challenge_method") !== "S256" ||
        url.searchParams.get("scope") !== "openid" ||
        !url.searchParams.get("state") ||
        !url.searchParams.get("nonce")
      ) {
        response.writeHead(400);
        return response.end();
      }
      if (grants.size >= 128) grants.clear();
      const code = randomBytes(20).toString("hex");
      grants.set(code, { query: url.searchParams, subject: "" });
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return response.end(
        '<!doctype html><title>Synthetic University</title><form method="post"><input name="code" type="hidden" value="' +
          code +
          '">' +
          choices
            .map(
              (choice) =>
                '<button name="subject" value="' +
                choice +
                '">' +
                choice +
                "</button>",
            )
            .join("") +
          "</form>",
      );
    }
    if (url.pathname === "/authorize" && request.method === "POST") {
      const fields = await form(request);
      const code = fields.get("code") ?? "";
      const grant = grants.get(code);
      const subject = fields.get("subject") ?? "";
      if (!grant || grant.subject || !choices.includes(subject)) {
        response.writeHead(400);
        return response.end();
      }
      grant.subject = subject;
      const callback = new URL(grant.query.get("redirect_uri")!);
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", grant.query.get("state")!);
      response.writeHead(303, { Location: callback.href });
      return response.end();
    }
    if (url.pathname === "/token" && request.method === "POST") {
      const fields = await form(request);
      const code = fields.get("code") ?? "";
      const grant = grants.get(code);
      grants.delete(code);
      const challenge = createHash("sha256")
        .update(fields.get("code_verifier") ?? "")
        .digest("base64url");
      if (
        !grant?.subject ||
        challenge !== grant.query.get("code_challenge") ||
        fields.get("client_id") !== client ||
        fields.get("client_secret") !==
          "helpinsights_oidc_disposable_fixture" ||
        fields.get("redirect_uri") !== grant.query.get("redirect_uri") ||
        fields.get("grant_type") !== "authorization_code"
      ) {
        response.writeHead(400, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "invalid_grant" }));
      }
      const idToken = await new SignJWT({
        tid: grant.subject === "wrong tenant" ? "some-other-tenant" : tenant,
        nonce:
          grant.subject === "wrong nonce"
            ? "incorrect"
            : grant.query.get("nonce"),
        roles: ["workspace-owner"],
      })
        .setProtectedHeader({ alg: "RS256", kid: "oidc-fixture" })
        .setIssuer(
          grant.subject === "wrong issuer"
            ? "https://different-issuer.example"
            : issuer,
        )
        .setAudience(
          grant.subject === "wrong audience" ? "another-app" : client,
        )
        .setSubject(
          [
            "owner",
            "viewer",
            "unbound",
            "operations-viewer",
            "survey-creator",
            "eligibility-student",
          ].includes(grant.subject)
            ? grant.subject
            : "owner",
        )
        .setIssuedAt()
        .setExpirationTime(grant.subject === "expired" ? "1 minute ago" : "5m")
        .sign(grant.subject === "wrong signature" ? invalidSigner : privateKey);
      response.writeHead(200, { "Content-Type": "application/json" });
      return response.end(
        JSON.stringify({
          access_token: "fixture-access-token",
          id_token: idToken,
          token_type: "Bearer",
        }),
      );
    }
    response.writeHead(404);
    response.end();
  } catch {
    response.writeHead(400);
    response.end();
  }
}).listen(3002, "0.0.0.0");
