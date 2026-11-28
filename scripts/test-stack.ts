import { generateKeyPairSync, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { localDockerContext, testDocker } from "./test-docker.ts";

const project = "helpinsights-test-" + randomBytes(6).toString("hex");
process.env.HELPINSIGHTS_TEST_REGISTRY_KEY = randomBytes(32).toString("hex");
const oauthFixture = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.HELPINSIGHTS_TEST_OAUTH_PUBLIC_JWKS = JSON.stringify({
  keys: [
    {
      ...oauthFixture.publicKey.export({ format: "jwk" }),
      alg: "RS256",
      use: "sig",
      kid: "disposable-rsa",
    },
  ],
});
const context = localDockerContext();
let { compose, docker, baseUrl } = testDocker(context, project);
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("Run this script with pnpm test:stack");

mkdirSync("runtime-evidence", { recursive: true });
console.log("Disposable Compose project:", project);
try {
  console.log(compose("up", "-d", "--build", "--wait", "oidc-simulator"));
  const oidcPort = compose("port", "oidc-simulator", "3002").trim();
  if (!/^127\.0\.0\.1:\d+$/.test(oidcPort))
    throw new Error("Synthetic identity provider must bind to loopback");
  process.env.HELPINSIGHTS_TEST_OIDC_BROWSER_ORIGIN =
    "http://" + oidcPort.replace("127.0.0.1", "localhost");
  ({ compose, docker, baseUrl } = testDocker(context, project));
  console.log(
    compose("up", "-d", "--build", "--wait", "--wait-timeout", "120"),
  );
  for (const suite of ["test:integration", "test:security", "test:e2e"]) {
    execFileSync(process.execPath, [pnpm, suite], {
      env: {
        ...process.env,
        APP_BASE_URL: baseUrl(),
        HELPINSIGHTS_TEST_CONTEXT: context,
        HELPINSIGHTS_TEST_PROJECT: project,
        ...(suite === "test:e2e" && {
          HELPINSIGHTS_TEST_OAUTH_SIGNING_JWK: JSON.stringify(
            oauthFixture.privateKey.export({ format: "jwk" }),
          ),
        }),
      },
      stdio: "inherit",
    });
  }
} finally {
  try {
    writeFileSync(
      "runtime-evidence/" + project + ".log",
      compose("logs", "--no-color", "--timestamps", "--tail", "200"),
    );
  } finally {
    console.log(
      compose("down", "--volumes", "--remove-orphans", "--rmi", "local"),
    );
    const remaining = docker([
      "volume",
      "ls",
      "--filter",
      "label=com.docker.compose.project=" + project,
      "--format",
      "{{.Name}}",
    ]);
    if (remaining.trim())
      throw new Error("Disposable volumes remain for " + project);
    console.log("Confirmed disposable Compose volume cleanup:", project);
  }
}
