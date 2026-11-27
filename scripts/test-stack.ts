import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const project = "helpinsights-test-" + randomBytes(6).toString("hex");
const context = execFileSync("docker", ["context", "show"], {
  encoding: "utf8",
}).trim();
const endpoint = execFileSync(
  "docker",
  ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"],
  { encoding: "utf8" },
).trim();
if (process.env.DOCKER_HOST || !/^(npipe|unix):\/\//.test(endpoint)) {
  throw new Error(
    "Stack tests require a local Docker socket and no DOCKER_HOST override",
  );
}

const compose = (...args: string[]) =>
  execFileSync(
    "docker",
    [
      "--context",
      context,
      "compose",
      "-f",
      "compose.yaml",
      "-f",
      "compose.test.yaml",
      "-p",
      project,
      ...args,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );

console.log("Disposable Compose project:", project);
try {
  console.log(
    compose("up", "-d", "--build", "--wait", "--wait-timeout", "120"),
  );
  for (const suite of ["test:integration", "test:security", "test:e2e"]) {
    const port = compose("port", "app", "3000").trim();
    if (!/^127\.0\.0\.1:\d+$/.test(port))
      throw new Error("App port is not bound to loopback");
    const env = {
      ...process.env,
      APP_BASE_URL: "http://" + port,
      HELPINSIGHTS_TEST_PROJECT: project,
    };
    execFileSync(process.execPath, [process.env.npm_execpath!, suite], {
      env,
      stdio: "inherit",
    });
  }
} catch (error) {
  try {
    console.error(compose("logs", "--no-color", "--tail", "100"));
  } catch {
    console.error("Could not collect Compose logs");
  }
  throw error;
} finally {
  console.log(compose("down", "--volumes", "--remove-orphans"));
}
