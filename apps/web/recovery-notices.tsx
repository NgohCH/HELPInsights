import { useEffect, useState } from "react";
import { api } from "./api.ts";

type RecoveryNotice = {
  id: string;
  title: string;
  createdAt: string;
  state: "open" | "acknowledged";
};

export function RecoveryNotices({ token }: { token: string }) {
  const [notices, setNotices] = useState<RecoveryNotice[] | null>(null);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    void api<RecoveryNotice[]>("/me/notices", { token }).then(
      ({ data }) => {
        if (current) setNotices(data);
      },
      (failure: unknown) => {
        const status = (failure as { status?: number })?.status;
        if (current && status !== 403 && status !== 404)
          setError("Recovery notices are temporarily unavailable");
      },
    );
    return () => {
      current = false;
    };
  }, [token]);

  async function acknowledge(id: string) {
    setPending(id);
    setError("");
    try {
      const { data } = await api<RecoveryNotice>(
        "/me/notices/" + id + "/acknowledge",
        {
          method: "POST",
          token,
        },
      );
      setNotices(
        (current) =>
          current?.map((notice) => (notice.id === id ? data : notice)) ?? null,
      );
    } catch {
      setError("Unable to acknowledge the recovery notice");
    } finally {
      setPending(undefined);
    }
  }

  if (notices === null && !error) return null;

  return (
    <section className="panel" aria-labelledby="recovery-notices-heading">
      <h2 id="recovery-notices-heading">Recovery notices</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notices?.length === 0 && <p>No recovery notices.</p>}
      {!!notices?.length && (
        <ul>
          {notices.map((notice) => (
            <li key={notice.id}>
              <p>
                {notice.title}{" "}
                <time dateTime={notice.createdAt}>
                  {new Date(notice.createdAt).toLocaleString()}
                </time>
              </p>
              {notice.state === "acknowledged" ? (
                <p role="status">Acknowledged</p>
              ) : (
                <button
                  type="button"
                  disabled={pending !== undefined}
                  onClick={() => void acknowledge(notice.id)}
                >
                  Acknowledge
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
