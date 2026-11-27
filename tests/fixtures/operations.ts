import { createHash, randomBytes, randomUUID } from "node:crypto";
import { surveyFixture } from "./survey.ts";

export const event = {
  component: "database",
  state: "detected",
  severity: "advisory",
};

export function operationsFixture(fixture: ReturnType<typeof surveyFixture>) {
  const operator = randomUUID();
  const viewer = randomUUID();
  const operatorToken = randomBytes(32).toString("base64url");
  const viewerToken = randomBytes(32).toString("base64url");
  const hash = (token: string) =>
    createHash("sha256").update(token).digest("hex");
  fixture.sql(`
    INSERT INTO public.users (id, display_name) VALUES
      ('${operator}', 'Synthetic operator'), ('${viewer}', 'Synthetic operations viewer');
    INSERT INTO public.platform_operations_memberships (user_id, role) VALUES
      ('${operator}', 'operator'), ('${viewer}', 'viewer');
    INSERT INTO public.sessions (token_hash, user_id, expires_at) VALUES
      (decode('${hash(operatorToken)}', 'hex'), '${operator}', now() + interval '1 hour'),
      (decode('${hash(viewerToken)}', 'hex'), '${viewer}', now() + interval '1 hour');
  `);
  return { operator, viewer, operatorToken, viewerToken };
}
