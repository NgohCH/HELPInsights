import { createHmac, timingSafeEqual } from "node:crypto";

export interface PersonRegistry {
  checkEligibility(proof: string): Promise<boolean>;
}

export class RegistryUnavailable extends Error {}

export function registryAdapter(endpoint: URL): PersonRegistry {
  return {
    async checkEligibility(proof) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proof }),
          redirect: "error",
          signal: AbortSignal.timeout(1500),
        });
        if (response.ok) {
          const result = await response.json();
          if (typeof result?.eligible === "boolean") return result.eligible;
        }
      } catch {
        // Keep provider details and request credentials out of application logs.
      }
      throw new RegistryUnavailable();
    },
  };
}

const capabilityWindow = 5 * 60 * 1000;
const capabilityFormat = /^(\d{13})\.([A-Za-z0-9_-]{43})$/;

export function registryCapabilities(key: Buffer, now = Date.now) {
  const sign = (scope: Buffer, expiry: number) =>
    createHmac("sha256", key)
      .update("helpinsights-registry-synthetic-v1:")
      .update(scope)
      .update(String(expiry))
      .digest();

  return {
    issue(scope: Buffer) {
      // A common time bucket prevents carrying an individual check timestamp into collection.
      const expires =
        (Math.floor(now() / capabilityWindow) + 2) * capabilityWindow;
      return {
        capability: expires + "." + sign(scope, expires).toString("base64url"),
        expiresAt: new Date(expires).toISOString(),
      };
    },
    verify(scope: Buffer, candidate: unknown) {
      if (typeof candidate !== "string") return false;
      const parsed = capabilityFormat.exec(candidate);
      if (!parsed) return false;
      const expires = Number(parsed[1]);
      const current = now();
      if (expires <= current || expires > current + capabilityWindow * 2)
        return false;
      return timingSafeEqual(
        sign(scope, expires),
        Buffer.from(parsed[2], "base64url"),
      );
    },
  };
}

export type RegistryGate = {
  registry: PersonRegistry;
  capabilities: ReturnType<typeof registryCapabilities>;
};

export function syntheticRegistry(env: NodeJS.ProcessEnv): RegistryGate | null {
  if (
    env.NODE_ENV !== "test" ||
    env.HELPINSIGHTS_DEV_REGISTRY_MODE !== "synthetic"
  )
    return null;
  const key = env.HELPINSIGHTS_TEST_REGISTRY_KEY;
  if (!key || !/^[a-f0-9]{64}$/.test(key))
    throw new Error("The synthetic Registry requires a per-test signing key");
  return {
    registry: registryAdapter(
      new URL("http://registry-simulator:3001/eligibility"),
    ),
    capabilities: registryCapabilities(Buffer.from(key, "hex")),
  };
}
