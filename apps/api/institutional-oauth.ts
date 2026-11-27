import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";

type Principal = { issuer: string; subject: string };
export type InstitutionalVerifier = (
  token: string,
) => Promise<Principal | null>;

const compactToken = /^[\w-]+\.[\w-]+\.[\w-]+$/;
const visibleAscii = /^[\x21-\x7e]{1,255}$/;
const keyId = /^[A-Za-z0-9_-]{1,128}$/;
const keyPart = /^[A-Za-z0-9_-]+$/;

function publicKeySet(value: string): JSONWebKeySet {
  const { keys } = JSON.parse(value);
  if (!Array.isArray(keys) || !keys.length || keys.length > 8)
    throw new Error("Invalid keys");

  for (const key of keys) {
    if (
      !key ||
      Object.keys(key).some(
        (name) => !["kty", "alg", "use", "kid", "n", "e"].includes(name),
      ) ||
      key.kty !== "RSA" ||
      key.alg !== "RS256" ||
      key.use !== "sig" ||
      typeof key.kid !== "string" ||
      !keyId.test(key.kid) ||
      typeof key.n !== "string" ||
      !keyPart.test(key.n) ||
      typeof key.e !== "string" ||
      !keyPart.test(key.e)
    )
      throw new Error("Invalid public verification key");
  }
  if (new Set(keys.map((key) => key.kid)).size !== keys.length)
    throw new Error("Duplicate public key identifier");
  return { keys };
}

export function institutionalOAuth(
  env: NodeJS.ProcessEnv,
): InstitutionalVerifier | null {
  const {
    HELPINSIGHTS_OAUTH_ISSUER: issuer,
    HELPINSIGHTS_OAUTH_AUDIENCE: audience,
    HELPINSIGHTS_OAUTH_SCOPE: scope,
    HELPINSIGHTS_OAUTH_JWKS: publicKeys,
  } = env;
  if (
    [issuer, audience, scope, publicKeys].every((value) => value === undefined)
  )
    return null;

  try {
    if (
      !issuer ||
      !visibleAscii.test(issuer) ||
      !audience ||
      !visibleAscii.test(audience) ||
      !scope ||
      !visibleAscii.test(scope) ||
      !publicKeys ||
      publicKeys.length > 16384
    )
      throw new Error("Incomplete configuration");
    const url = new URL(issuer);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.href !== issuer && url.origin !== issuer)
    )
      throw new Error("Invalid issuer");
    const keyset = createLocalJWKSet(publicKeySet(publicKeys));

    return async (token) => {
      if (token.length > 8192 || !compactToken.test(token)) return null;
      try {
        const { payload, protectedHeader } = await jwtVerify(token, keyset, {
          algorithms: ["RS256"],
          issuer,
          audience,
          requiredClaims: ["sub", "exp", "iat"],
          maxTokenAge: "90m",
        });
        if (
          !protectedHeader.kid ||
          payload.aud !== audience ||
          typeof payload.sub !== "string" ||
          !visibleAscii.test(payload.sub) ||
          typeof payload.scp !== "string" ||
          !payload.scp.split(" ").includes(scope)
        )
          return null;
        return { issuer, subject: payload.sub };
      } catch {
        return null;
      }
    };
  } catch {
    throw new Error("Invalid institutional OAuth configuration");
  }
}
