import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { withTransaction } from "../../packages/database/transaction.ts";
import {
  createExport,
  type ExportSource,
} from "../../packages/survey-runtime/export.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 2_000,
  statement_timeout: 10_000,
});
const recordIncidents = process.env.HELPINSIGHTS_EXPORT_INCIDENTS === "1";
const transportCodes = new Set([
  "08000",
  "08001",
  "08003",
  "08006",
  "57P01",
  "57P02",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
]);
let pendingEpisode: { id: string; detectedAt: Date } | undefined;

function observeTransportFailure(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  if (recordIncidents && typeof code === "string" && transportCodes.has(code)) {
    pendingEpisode ??= { id: randomUUID(), detectedAt: new Date() };
  }
}

pool.on("error", (error) => {
  observeTransportFailure(error);
  console.error("Export worker connection interrupted");
});

const shutdown = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => shutdown.abort());
}

function processExport() {
  return withTransaction(pool, async (client) => {
    await client.query(`
      WITH expired AS (
        SELECT id FROM public.export_jobs WHERE status = 'completed' AND expires_at <= now()
        ORDER BY expires_at LIMIT 25 FOR UPDATE SKIP LOCKED
      )
      UPDATE public.export_jobs j SET status = 'expired', archive = NULL
      FROM expired WHERE j.id = expired.id
    `);
    const {
      rows: [job],
    } = await client.query<{ id: string }>(`
      SELECT id FROM public.export_jobs WHERE status = 'queued' AND next_attempt_at <= now()
      ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
    `);
    if (job) {
      await client.query("SAVEPOINT process_job");
      try {
        const {
          rows: [source],
        } = await client.query<ExportSource>(
          "SELECT * FROM public.export_source($1)",
          [job.id],
        );
        let archive: Buffer | null = null;
        if (source && !source.over_limit) {
          try {
            archive = createExport(source, new Date());
          } catch {
            console.error("Export archive could not be generated");
          }
        }
        if (!archive) {
          await client.query(
            "UPDATE public.export_jobs SET status = 'failed' WHERE id = $1",
            [job.id],
          );
        } else {
          await client.query(
            `
          UPDATE public.export_jobs SET status = 'completed', archive = $2,
          expires_at = clock_timestamp() + interval '15 minutes' WHERE id = $1
        `,
            [job.id, archive],
          );
        }
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT process_job");
        await client.query(
          `
          UPDATE public.export_jobs SET attempts = attempts + 1,
          status = CASE WHEN attempts >= 2 THEN 'failed' ELSE 'queued' END,
          next_attempt_at = clock_timestamp() + make_interval(secs => attempts + 1)
          WHERE id = $1
        `,
          [job.id],
        );
        const state = (error as { code?: unknown })?.code;
        console.error(
          "Export job could not complete",
          typeof state === "string" && /^[A-Z0-9]{5}$/.test(state)
            ? state
            : "internal",
        );
      }
    }
  });
}

try {
  let pollDelay = 300;
  while (!shutdown.signal.aborted) {
    try {
      await processExport().catch((error: unknown) => {
        observeTransportFailure(error);
        throw error;
      });
      await writeFile(
        "/tmp/helpinsights-export-worker.ready",
        String(Date.now()),
      );
      const episode = pendingEpisode;
      if (episode && !shutdown.signal.aborted) {
        await withTransaction(pool, (client) =>
          client.query("SELECT public.record_export_worker_recovery($1, $2)", [
            episode.id,
            episode.detectedAt,
          ]),
        );
        pendingEpisode = undefined;
      }
      pollDelay = 300;
    } catch {
      console.error("Export worker could not finish a polling cycle");
      pollDelay = pendingEpisode ? Math.min(pollDelay * 2, 2_400) : 300;
    }
    await delay(pollDelay, undefined, { signal: shutdown.signal }).catch(
      (error) => {
        if (!shutdown.signal.aborted) throw error;
      },
    );
  }
} finally {
  await pool.end();
}
