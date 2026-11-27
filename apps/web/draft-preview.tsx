import { useEffect, useRef, useState, type FormEvent } from "react";
import { parseAnswers } from "../../packages/survey-runtime/answers.ts";
import type { SurveyDefinition } from "../../packages/survey-runtime/definition.ts";
import { QuestionFields, readAnswers } from "./question-fields.tsx";

export function DraftPreview({
  definition,
  onClose,
  onHelp,
}: {
  definition: SurveyDefinition;
  onClose: () => void;
  onHelp: (button: HTMLButtonElement) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    heading.current?.focus();
  }, []);

  function checkAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChecked(false);
    setError("");
    try {
      parseAnswers(
        definition,
        readAnswers(new FormData(event.currentTarget), definition),
      );
      setChecked(true);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Check the preview answers",
      );
    }
  }

  return (
    <section className="panel preview" aria-label="Draft preview">
      <h2 ref={heading} tabIndex={-1}>
        {definition.title}
      </h2>
      {definition.description && <p>{definition.description}</p>}
      <form
        onSubmit={checkAnswer}
        onChange={() => {
          setChecked(false);
          setError("");
        }}
      >
        <QuestionFields definition={definition} pageHeading="h3" />
        <div className="actions">
          <button>Check preview answer</button>
          <button
            type="button"
            className="secondary"
            aria-controls="creator-user-guide"
            onClick={(event) => onHelp(event.currentTarget)}
          >
            Help with preview
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Close preview
          </button>
        </div>
      </form>
      {checked && (
        <p className="message" role="status">
          Preview answer checked
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
