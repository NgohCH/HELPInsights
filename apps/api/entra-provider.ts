import * as oidc from "openid-client";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const syntheticIssuer = "http://oidc-simulator:3002";

export function universityBrowserOrigin(env: NodeJS.ProcessEnv, host?: string) {
  if (
    env.NODE_ENV === "test" &&
    env.HELPINSIGHTS_ENTRA_ORIGIN === "loopback-test"
  )
    return host && /^127\.0\.0\.1:\d{1,5}$/.test(host)
      ? "http://" + host
      : null;
  const value = env.HELPINSIGHTS_ENTRA_ORIGIN;
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value ? value : null;
  } catch {
    return null;
  }
}

export function entraProvider(env: NodeJS.ProcessEnv) {
  const {
    HELPINSIGHTS_ENTRA_TENANT: tenant,
    HELPINSIGHTS_ENTRA_CLIENT_ID: clientId,
    HELPINSIGHTS_ENTRA_CLIENT_SECRET: secret,
    HELPINSIGHTS_ENTRA_ORIGIN: origin,
    HELPINSIGHTS_ENTRA_DATABASE_URL: identityDatabase,
    HELPINSIGHTS_TEST_OIDC_BROWSER_ORIGIN: syntheticBrowser,
  } = env;
  if (
    [tenant, clientId, secret, origin, identityDatabase].every(
      (value) => value === undefined,
    )
  )
    return null;
  const synthetic = env.NODE_ENV === "test" && origin === "loopback-test";
  if (
    !tenant ||
    !uuid.test(tenant) ||
    !clientId ||
    !uuid.test(clientId) ||
    !secret ||
    !identityDatabase ||
    (synthetic
      ? !syntheticBrowser ||
        !/^http:\/\/localhost:\d{1,5}$/.test(syntheticBrowser)
      : !universityBrowserOrigin(env))
  )
    throw new Error("Incomplete University sign-in configuration");

  const tenantBase = "https://login.microsoftonline.com/" + tenant;
  const issuer = synthetic ? syntheticIssuer : tenantBase + "/v2.0";
  const configuration = new oidc.Configuration(
    {
      issuer,
      authorization_endpoint: synthetic
        ? syntheticBrowser + "/authorize"
        : tenantBase + "/oauth2/v2.0/authorize",
      token_endpoint: synthetic
        ? syntheticIssuer + "/token"
        : tenantBase + "/oauth2/v2.0/token",
      jwks_uri: synthetic
        ? syntheticIssuer + "/keys"
        : tenantBase + "/discovery/v2.0/keys",
    },
    clientId,
    { id_token_signed_response_alg: "RS256" },
    oidc.ClientSecretPost(secret),
  );
  configuration.timeout = 5;
  if (synthetic) oidc.allowInsecureRequests(configuration);
  oidc.enableNonRepudiationChecks(configuration);

  return {
    identityDatabase,
    appOrigin: (host?: string) => universityBrowserOrigin(env, host),
    authorization: (parameters: Record<string, string>) =>
      oidc.buildAuthorizationUrl(configuration, parameters),
    async exchange(
      callback: URL,
      attempt: { state: string; verifier: string; nonce: string },
    ) {
      try {
        const tokens = await oidc.authorizationCodeGrant(
          configuration,
          callback,
          {
            pkceCodeVerifier: attempt.verifier,
            expectedState: attempt.state,
            expectedNonce: attempt.nonce,
            idTokenExpected: true,
          },
        );
        const claims = tokens.claims();
        if (
          !claims ||
          claims.tid !== tenant ||
          claims.aud !== clientId ||
          !/^[\x21-\x7e]{1,255}$/.test(claims.sub)
        )
          return null;
        return { issuer, subject: claims.sub };
      } catch {
        return null;
      }
    },
  };
}
