import { randomUUID } from "node:crypto";
import { operationsFixture } from "./operations.ts";
import { surveyFixture } from "./survey.ts";

export function recoveryNoticeFixture(fixture = surveyFixture()) {
  const first = operationsFixture(fixture);
  const second = operationsFixture(fixture);
  const episode = randomUUID();
  const manualId = randomUUID();
  fixture.sql(`
    BEGIN;
    SET LOCAL ROLE helpinsights_exporter;
    SELECT public.record_export_worker_recovery('${episode}', now() - interval '1 minute');
    RESET ROLE;
    INSERT INTO public.operation_incidents (id, component, state, severity, actor_id)
      VALUES ('${manualId}', 'database', 'recovered', 'information', '${first.operator}');
    COMMIT;
  `);
  const recoveryId = fixture.sql(`
    SELECT id FROM public.operation_incidents WHERE episode_id = '${episode}' AND state = 'recovered'
  `);
  const detectionId = fixture.sql(`
    SELECT id FROM public.operation_incidents WHERE episode_id = '${episode}' AND state = 'detected'
  `);
  return { ...fixture, first, second, recoveryId, detectionId, manualId };
}
