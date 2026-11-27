import { useEffect, useRef, useState } from "react";

type Topic = { key: string; title: string; body: string };
type GuideContent = {
  version: number;
  locale: string;
  audience: string;
  topics: Topic[];
};

export function UserGuide({
  topicKey,
  onClose,
}: {
  topicKey: string;
  onClose: () => void;
}) {
  const search = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState<GuideContent | null>(null);
  const [selected, select] = useState(topicKey);
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    search.current?.focus();
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/assets/creator-help.en.json", {
          credentials: "omit",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Guide unavailable");
        const data = (await response.json()) as GuideContent;
        if (
          data.version !== 1 ||
          data.audience !== "creator" ||
          !Array.isArray(data.topics)
        ) {
          throw new Error("Guide content is unavailable");
        }
        setContent(data);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  const topics = content?.topics ?? [];
  const term = query.trim().toLowerCase();
  const matches = topics.filter((topic) =>
    (topic.title + " " + topic.body).toLowerCase().includes(term),
  );
  const detail = topics.find((topic) => topic.key === selected);

  return (
    <section
      id="creator-user-guide"
      className="panel user-guide"
      aria-labelledby="user-guide-heading"
    >
      <h2 id="user-guide-heading">User guide</h2>
      <label>
        Search help topics
        <input
          type="search"
          value={query}
          ref={search}
          onChange={(event) => {
            setQuery(event.target.value);
            select("");
          }}
        />
      </label>
      {failed && (
        <p role="alert">
          Guide content could not be loaded. Close the guide and try again.
        </p>
      )}
      {!content && !failed && <p>Loading help topics…</p>}
      {content && matches.length === 0 && (
        <p>No help topics match your search.</p>
      )}
      {matches.length > 0 && (
        <ul className="guide-topics">
          {matches.map((topic) => (
            <li key={topic.key}>
              <button
                type="button"
                className="secondary"
                aria-pressed={selected === topic.key}
                onClick={() => select(topic.key)}
              >
                {topic.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {detail && (
        <div className="guide-topic">
          <h3>{detail.title}</h3>
          <p>{detail.body}</p>
        </div>
      )}
      <button type="button" className="secondary" onClick={onClose}>
        Close user guide
      </button>
    </section>
  );
}
