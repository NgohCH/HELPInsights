import { useState } from "react";
import { api } from "./api.ts";

type Report = {
  surveyVersionId: string;
  responseCount: number;
  questions: Array<{
    questionId: string;
    title: string;
    suppressed: boolean;
    count?: number;
    categories: Array<{ code: string; label: string; count: number }>;
  }>;
};

type ExportJob = { id: string; status: string; downloadUrl?: string | null };

export function Results({
  surveyId,
  token,
}: {
  surveyId: string;
  token: string;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<"report" | "export" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function showResults() {
    setBusy("report");
    setError("");
    setMessage("");
    try {
      const { data } = await api<Report>(
        "/surveys/" + surveyId + "/analytics",
        { token },
      );
      setReport(data);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Results could not be loaded",
      );
    } finally {
      setBusy(null);
    }
  }

  async function exportData() {
    if (!report) return;
    setBusy("export");
    setError("");
    setMessage("");
    try {
      const { data: queued } = await api<ExportJob>(
        "/surveys/" + surveyId + "/exports",
        {
          token,
          method: "POST",
          body: {
            format: "jasp_csv_bundle",
            surveyVersionId: report.surveyVersionId,
          },
        },
      );
      let job = queued;
      for (
        let attempt = 0;
        attempt < 50 && job.status === "queued";
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        job = (await api<ExportJob>("/exports/" + queued.id, { token })).data;
      }
      const expected = "/api/v1/exports/" + queued.id + "/download";
      if (job.status !== "completed" || job.downloadUrl !== expected) {
        throw new Error("The export is unavailable. Try again shortly.");
      }
      const response = await fetch(expected, {
        credentials: "omit",
        headers: { Authorization: "Bearer " + token },
      });
      if (!response.ok) throw new Error("The export download is unavailable");
      const objectUrl = URL.createObjectURL(await response.blob());
      try {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = "helpinsights-data.zip";
        document.body.append(link);
        link.click();
        link.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      }
      setMessage("Export ready");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The export could not be saved",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel results" aria-label="Response reporting">
      <div className="actions">
        <button className="secondary" disabled={!!busy} onClick={showResults}>
          {busy === "report"
            ? "Loading results…"
            : report
              ? "Refresh results"
              : "View results"}
        </button>
        {report && (
          <button disabled={!!busy} onClick={exportData}>
            {busy === "export" ? "Preparing export…" : "Export JASP CSV"}
          </button>
        )}
      </div>
      {report && (
        <div className="report">
          <h2>Survey results</h2>
          <p className="total">
            {report.responseCount}{" "}
            {report.responseCount === 1 ? "response" : "responses"}
          </p>
          {report.questions.map((question) => (
            <section className="question-results" key={question.questionId}>
              <h3>{question.title}</h3>
              {question.suppressed ? (
                <p>Breakdown hidden until enough responses are available.</p>
              ) : question.categories.length ? (
                <ul className="chart">
                  {question.categories.map((category) => (
                    <li key={category.code}>
                      <span>{category.label}</span>
                      <progress
                        aria-label={category.label}
                        value={category.count}
                        max={Math.max(1, report.responseCount)}
                      />
                      <span>{category.count}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{question.count ?? 0} answered</p>
              )}
            </section>
          ))}
        </div>
      )}
      {message && (
        <p className="message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
