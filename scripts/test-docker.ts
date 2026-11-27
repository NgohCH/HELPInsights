import { execFileSync } from "node:child_process";

export function localDockerContext(preferred?: string) {
  if (process.env.DOCKER_HOST)
    throw new Error("DOCKER_HOST must be unset for stack tests");
  const context =
    preferred ??
    execFileSync("docker", ["context", "show"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    }).trim();
  const endpoint = execFileSync(
    "docker",
    ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000 },
  ).trim();
  if (!/^(npipe|unix):\/\//.test(endpoint))
    throw new Error("Stack tests require a local Docker socket");
  return context;
}

export function testDocker(context: string, project: string) {
  if (!/^helpinsights-test-[a-f0-9]{12}$/.test(project)) {
    throw new Error("Invalid disposable Compose project");
  }
  const env = { ...process.env, HELPINSIGHTS_TEST_PROJECT: project };
  const docker = (args: string[]) =>
    execFileSync("docker", ["--context", context, ...args], {
      encoding: "utf8",
      timeout: 300_000,
      env,
      stdio: ["ignore", "pipe", "inherit"],
    });
  const compose = (...args: string[]) =>
    docker([
      "compose",
      "-f",
      "compose.yaml",
      "-f",
      "compose.test.yaml",
      "-p",
      project,
      ...args,
    ]);
  const baseUrl = () => {
    const port = compose("port", "app", "3000").trim();
    if (!/^127\.0\.0\.1:\d+$/.test(port))
      throw new Error("App port is not bound to loopback");
    return "http://" + port;
  };
  return { docker, compose, baseUrl };
}

export function runningTestStack() {
  const context = process.env.HELPINSIGHTS_TEST_CONTEXT;
  const project = process.env.HELPINSIGHTS_TEST_PROJECT;
  if (!context || !project)
    throw new Error("Start integration tests via pnpm test:stack");
  const stack = testDocker(localDockerContext(context), project);
  for (const service of ["postgres", "app", "worker"]) {
    const id = stack.compose("ps", "--quiet", service).trim();
    if (!/^[a-f0-9]{12,64}$/.test(id))
      throw new Error("Missing disposable service: " + service);
    const label = stack.docker([
      "inspect",
      "--format",
      '{{index .Config.Labels "org.helpinsights.test-run"}}',
      id,
    ]);
    if (label.trim() !== project)
      throw new Error("Container is outside the disposable test run");
  }
  return stack;
}
