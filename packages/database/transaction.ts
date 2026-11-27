import type { Pool, PoolClient } from "pg";

export async function withTransaction<T>(
  pool: Pool,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  const markDisconnected = () => {
    discard = true;
  };

  // The pool handles errors from idle clients. A checked-out client needs its own listener.
  client.on("error", markDisconnected);
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (!discard) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
      }
    }
    throw error;
  } finally {
    client.release(discard);
    client.off("error", markDisconnected);
  }
}
