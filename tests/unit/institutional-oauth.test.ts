import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { institutionalOAuth } from "../../apps/api/institutional-oauth.ts";

const issuer = "https://institution.example.test/oauth/v2.0";
const audience = "helpinsights.api";
const scope = "workspace.read";

test("institutional verification requires a signed delegated access token for exactly this API", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const other = await generateKeyPair("RS256");
  const jwks = JSON.stringify({
    keys: [
      { ...(await exportJWK(publicKey)), kid: "key", use: "sig", alg: "RS256" },
    ],
  });
  const env = {
    HELPINSIGHTS_OAUTH_ISSUER: issuer,
    HELPINSIGHTS_OAUTH_AUDIENCE: audience,
    HELPINSIGHTS_OAUTH_SCOPE: scope,
    HELPINSIGHTS_OAUTH_JWKS: jwks,
  };
  const verify = institutionalOAuth(env);
  assert.ok(verify);
  const sign = (
    claims: Record<string, unknown> = {},
    key = privateKey,
    kid = "key",
  ) =>
    new SignJWT({
      iss: issuer,
      aud: audience,
      sub: "opaque-subject",
      scp: scope,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid })
      .sign(key);

  assert.deepEqual(await verify(await sign({ scp: "additional " + scope })), {
    issuer,
    subject: "opaque-subject",
  });
  for (const token of await Promise.all([
    sign({ iss: issuer + "/" }),
    sign({ aud: "another-api" }),
    sign({ aud: [audience, "another-api"] }),
    sign({ scp: scope + ".more", roles: ["admin"] }),
    sign({ scp: undefined }),
    sign({ sub: undefined }),
    sign({ exp: undefined }),
    sign({ iat: undefined }),
    sign({ exp: Math.floor(Date.now() / 1000) - 1 }),
    sign({ nbf: Math.floor(Date.now() / 1000) + 120 }),
    sign({}, other.privateKey),
    sign({}, privateKey, "unknown"),
  ]))
    assert.equal(await verify(token), null);

  assert.equal(institutionalOAuth({}), null);
  assert.throws(() =>
    institutionalOAuth({ ...env, HELPINSIGHTS_OAUTH_AUDIENCE: undefined }),
  );
  assert.throws(() =>
    institutionalOAuth({
      ...env,
      HELPINSIGHTS_OAUTH_ISSUER:
        "https://institution.example.test/oauth/../oauth/v2.0",
    }),
  );
  assert.throws(() =>
    institutionalOAuth({
      ...env,
      HELPINSIGHTS_OAUTH_JWKS: JSON.stringify({
        keys: [{ ...JSON.parse(jwks).keys[0], d: "x" }],
      }),
    }),
  );
});
