import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../apps/api/application.ts";
import { entraSignInRoutes } from "../../apps/api/entra-sign-in.ts";
import { entraProvider } from "../../apps/api/entra-provider.ts";

test("the callback is bound to one browser and a single PKCE attempt", async (context) => {
  const appOrigin = "https://surveys.example.test";
  let challenge = "";
  let exchanges = 0;
  let sessions = 0;
  const route = entraSignInRoutes(
    {
      appOrigin,
      authorization(parameters) {
        challenge = parameters.code_challenge;
        return new URL(
          "https://login.example.test/authorize?" +
            new URLSearchParams(parameters),
        );
      },
      async exchange(callback, attempt) {
        exchanges++;
        assert.equal(callback.searchParams.get("code"), "fixture-code");
        assert.equal(callback.searchParams.get("state"), attempt.state);
        assert.ok(attempt.nonce);
        assert.equal(
          createHash("sha256").update(attempt.verifier).digest("base64url"),
          challenge,
        );
        return {
          issuer: "https://login.example.test",
          subject: "owner-subject",
        };
      },
    },
    {
      async issue(principal, tokenHash) {
        sessions++;
        assert.deepEqual(principal, {
          issuer: "https://login.example.test",
          subject: "owner-subject",
        });
        assert.equal(tokenHash.length, 32);
        return true;
      },
      async revoke() {},
    },
  );
  const server = createApplication(async () => true, route);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = "http://127.0.0.1:" + address.port;
  const start = await fetch(base + "/auth/university/start", {
    redirect: "manual",
  });
  assert.equal(start.status, 303);
  const target = new URL(start.headers.get("location")!);
  assert.equal(target.origin, "https://login.example.test");
  assert.equal(target.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    target.searchParams.get("redirect_uri"),
    appOrigin + "/auth/university/callback",
  );
  const cookie = start.headers.getSetCookie()[0];
  assert.match(cookie, /; HttpOnly; Secure; SameSite=Lax/);
  const state = target.searchParams.get("state")!;
  const callback =
    base +
    "/auth/university/callback?" +
    new URLSearchParams({ code: "fixture-code", state });
  const rejected = await fetch(callback, { redirect: "manual" });
  assert.equal(rejected.status, 401);
  assert.equal(exchanges, 0);
  const withCookie = {
    redirect: "manual" as const,
    headers: { Cookie: cookie.split(";")[0] },
  };
  const wrongState = new URL(callback);
  wrongState.searchParams.set("state", "wrong");
  assert.equal((await fetch(wrongState, withCookie)).status, 401);
  assert.equal(exchanges, 0);
  const signedIn = await fetch(callback, withCookie);
  assert.equal(signedIn.status, 303);
  assert.equal(signedIn.headers.get("location"), "/");
  assert.match(
    signedIn.headers.getSetCookie().join(" "),
    /__Host-helpinsights-session=[A-Za-z0-9_-]{43};/,
  );
  assert.equal((await fetch(callback, withCookie)).status, 401);
  assert.equal(exchanges, 1);
  assert.equal(sessions, 1);

  const secondStart = await fetch(base + "/auth/university/start", {
    redirect: "manual",
  });
  const secondState = new URL(
    secondStart.headers.get("location")!,
  ).searchParams.get("state")!;
  const secondCookie = secondStart.headers.getSetCookie()[0].split(";")[0];
  const providerDenied = new URL(base + "/auth/university/callback");
  providerDenied.search = new URLSearchParams({
    state: secondState,
    error: "access_denied",
  }).toString();
  assert.equal(
    (await fetch(providerDenied, { headers: { Cookie: secondCookie } })).status,
    401,
  );

  const thirdStart = await fetch(base + "/auth/university/start", {
    redirect: "manual",
  });
  const expired = new URL(callback);
  expired.searchParams.set(
    "state",
    new URL(thirdStart.headers.get("location")!).searchParams.get("state")!,
  );
  const future = Date.now() + 301_000;
  const time = context.mock.method(Date, "now", () => future);
  try {
    assert.equal(
      (
        await fetch(expired, {
          headers: {
            Cookie: thirdStart.headers.getSetCookie()[0].split(";")[0],
          },
        })
      ).status,
      401,
    );
  } finally {
    time.mock.restore();
  }
  assert.equal(exchanges, 1);
});

test("University sign-in is opt-in and refuses partial or fixture configuration outside test", () => {
  assert.equal(entraProvider({}), null);
  assert.throws(
    () =>
      entraProvider({
        HELPINSIGHTS_ENTRA_ORIGIN: "https://survey.example.test",
      }),
    /Incomplete University sign-in configuration/,
  );
  assert.throws(
    () =>
      entraProvider({
        NODE_ENV: "production",
        HELPINSIGHTS_ENTRA_TENANT: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        HELPINSIGHTS_ENTRA_CLIENT_ID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        HELPINSIGHTS_ENTRA_CLIENT_SECRET: "disposable",
        HELPINSIGHTS_ENTRA_ORIGIN: "loopback-test",
        HELPINSIGHTS_ENTRA_DATABASE_URL: "synthetic",
        HELPINSIGHTS_TEST_OIDC_BROWSER_ORIGIN: "http://localhost:1234",
      }),
    /Incomplete University sign-in configuration/,
  );
});
