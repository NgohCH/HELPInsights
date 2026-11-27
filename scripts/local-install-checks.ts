import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { localDockerContext } from "./test-docker.ts";

export const repository = fileURLToPath(new URL("../", import.meta.url));

type Check = { name: string; status: "PASS" | "FAIL"; detail: string };
type Host = { pnpmCli: string; context: string; checks: Check[] };

function result(
  name: string,
  value: string | null,
  remediation: string,
): Check {
  return value
    ? { name, status: "PASS", detail: value }
    : { name, status: "FAIL", detail: remediation };
}

function output(command: string, args: string[]) {
  try {
    return execFileSync(command, args, {
      cwd: repository,
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

export function isReady(checks: Check[]) {
  return checks.every((check) => check.status === "PASS");
}

export function printChecks(checks: Check[]) {
  console.log(
    JSON.stringify({
      status: isReady(checks) ? "PASS" : "BLOCKED_ENVIRONMENT",
      checks,
    }),
  );
}

export function inspectHost(): Host {
  const pnpmCli = process.env.npm_execpath ?? "";
  if (process.env.DOCKER_HOST) {
    return {
      pnpmCli,
      context: "",
      checks: [
        result(
          "docker-context",
          null,
          "Unset DOCKER_HOST and select a local Docker context.",
        ),
      ],
    };
  }

  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const pinnedPnpm = /^pnpm@(\d+\.\d+\.\d+)$/.exec(
    manifest.packageManager,
  )?.[1];
  const node = process.versions.node;
  const pnpm =
    isAbsolute(pnpmCli) && existsSync(pnpmCli)
      ? output(process.execPath, [pnpmCli, "--version"])
      : "";
  const revision = output("git", ["rev-parse", "--verify", "HEAD"]);
  const checkout = output("git", ["status", "--porcelain"]);
  const checks = [
    result(
      "revision",
      revision && /^[a-f0-9]{40}$/.test(revision) ? revision : null,
      "Run from a versioned HELPInsights checkout.",
    ),
    result(
      "checkout",
      checkout === null ? null : checkout ? "modified" : "clean",
      "Run from the readable HELPInsights checkout.",
    ),
    result(
      "node",
      manifest.engines.node === node.split(".")[0] + ".x" ? node : null,
      "Install the Node version declared in package.json.",
    ),
    result(
      "pnpm",
      pnpm && pnpm === pinnedPnpm ? pnpm : null,
      "Run this command with the Corepack and pnpm versions declared for this checkout.",
    ),
    result(
      "lockfile",
      existsSync(new URL("../pnpm-lock.yaml", import.meta.url))
        ? "pnpm-lock.yaml"
        : null,
      "Restore the committed pnpm lockfile.",
    ),
  ];
  let context: string;
  try {
    context = localDockerContext();
  } catch {
    checks.push(
      result(
        "docker-context",
        null,
        "Start Docker and select a local Docker context.",
      ),
    );
    return { pnpmCli, context: "", checks };
  }

  const engine = output("docker", [
    "--context",
    context,
    "info",
    "--format",
    "{{.OSType}} {{.ServerVersion}}",
  ]);
  const compose = output("docker", [
    "--context",
    context,
    "compose",
    "version",
    "--short",
  ]);
  checks.push(
    result("docker-context", context, "Select a local Docker context."),
    result(
      "docker-engine",
      /^linux [0-9.]+[A-Za-z0-9.+-]*$/.test(engine ?? "") ? engine : null,
      "Start a local Linux Docker engine or switch Docker Desktop to Linux containers.",
    ),
    result(
      "compose",
      /^v?[0-9.]+[A-Za-z0-9.+-]*$/.test(compose ?? "") ? compose : null,
      "Install or enable Docker Compose.",
    ),
  );
  return { pnpmCli, context, checks };
}

export async function inspectChromium(): Promise<Check> {
  try {
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch({ timeout: 10_000 });
    try {
      return result(
        "chromium",
        browser.version(),
        "Install the pinned Chromium browser.",
      );
    } finally {
      await browser.close();
    }
  } catch {
    return result(
      "chromium",
      null,
      "Run corepack pnpm install --frozen-lockfile and corepack pnpm exec playwright install chromium.",
    );
  }
}
