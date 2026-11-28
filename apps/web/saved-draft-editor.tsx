import {
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  parseDefinition,
  type Question,
  type SurveyDefinition,
} from "../../packages/survey-runtime/definition.ts";
import {
  editSurveyStructure,
  type SurveyStructureChange,
} from "../../packages/survey-runtime/survey-structure.ts";

type Page = SurveyDefinition["pages"][number];
type QuestionType = Question["type"];
const surveyTitle = "survey-title";
const pageTitle = (id: string) => "page-title-" + id;
const questionTitle = (id: string) => "question-title-" + id;
const optionLabel = (id: string, index: number) => "option-" + id + "-" + index;
const newId = (prefix: string) =>
  prefix + crypto.randomUUID().replaceAll("-", "");

export function SavedDraftEditor({
  initial,
  canAuthorNps,
  saving,
  onSave,
  onCancel,
}: {
  initial: SurveyDefinition;
  canAuthorNps: boolean;
  saving: boolean;
  onSave: (definition: SurveyDefinition) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [wording, setWording] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const nextFocus = useRef(surveyTitle);

  useLayoutEffect(() => {
    const input = form.current?.elements.namedItem(nextFocus.current);
    if (input instanceof HTMLElement) input.focus();
  }, [draft]);

  function value(name: string, original = "") {
    return wording[name] ?? original;
  }

  function textField(name: string, original?: string) {
    return {
      name,
      value: value(name, original),
      onChange(event: ChangeEvent<HTMLInputElement>) {
        const text = event.currentTarget.value;
        setWording((current) => ({ ...current, [name]: text }));
      },
    };
  }

  function titleOf(page: Page, index: number) {
    return (
      value(pageTitle(page.id), page.title).trim() || "Page " + (index + 1)
    );
  }

  function change(
    action: SurveyStructureChange,
    focus: string,
    message: string,
  ) {
    setError("");
    setAnnouncement("");
    try {
      const updated = editSurveyStructure(draft, action);
      nextFocus.current = focus;
      setDraft(updated);
      setAnnouncement(message);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not change the draft.",
      );
    }
  }

  function addPage() {
    const id = newId("page_");
    change({ kind: "add-page", pageId: id }, pageTitle(id), "Page added.");
  }

  function moveQuestion(
    page: Page,
    question: Question,
    toPageId: string,
    toIndex: number,
  ) {
    const destinationIndex = draft.pages.findIndex(({ id }) => id === toPageId);
    const destination = draft.pages[destinationIndex];
    const pageNumber = "page " + (destinationIndex + 1);
    const destinationTitle = value(
      pageTitle(toPageId),
      destination?.title,
    ).trim();
    const destinationLabel = destinationTitle
      ? destinationTitle + " (" + pageNumber + ")"
      : pageNumber;
    change(
      {
        kind: "move-question",
        pageId: page.id,
        questionId: question.id,
        toPageId,
        toIndex,
      },
      questionTitle(question.id),
      "Question moved to " +
        destinationLabel +
        ", position " +
        (toIndex + 1) +
        ".",
    );
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const definition = parseDefinition({
        ...draft,
        title: value(surveyTitle, draft.title),
        pages: draft.pages.map(({ title, ...page }) => {
          const editedTitle = value(pageTitle(page.id), title).trim();
          return {
            ...page,
            ...(editedTitle ? { title: editedTitle } : {}),
            questions: page.questions.map((question) => ({
              ...question,
              title: value(questionTitle(question.id), question.title),
              ...(question.type === "single_choice"
                ? {
                    options: question.options.map((option, index) => ({
                      ...option,
                      label: value(
                        optionLabel(question.id, index),
                        option.label,
                      ),
                    })),
                  }
                : {}),
            })),
          };
        }),
      });
      void onSave(definition);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not check the draft.",
      );
    }
  }

  return (
    <form ref={form} onSubmit={save} aria-busy={saving}>
      <fieldset className="creator-inputs" disabled={saving}>
        <label>
          Saved survey title
          <input
            {...textField(surveyTitle, draft.title)}
            maxLength={200}
            required
          />
        </label>
        {draft.pages.map((page, pageIndex) => (
          <fieldset key={page.id}>
            <legend>{titleOf(page, pageIndex)}</legend>
            <label>
              Page title
              <input
                {...textField(pageTitle(page.id), page.title)}
                maxLength={160}
              />
            </label>
            <div className="actions">
              <OrderControls
                item="page"
                index={pageIndex}
                count={draft.pages.length}
                move={(toIndex) =>
                  change(
                    { kind: "move-page", pageId: page.id, toIndex },
                    pageTitle(page.id),
                    titleOf(page, pageIndex) +
                      " moved to page position " +
                      (toIndex + 1) +
                      ".",
                  )
                }
              />
              <button
                type="button"
                className="secondary"
                disabled={draft.pages.length === 1}
                onClick={() =>
                  change(
                    { kind: "remove-page", pageId: page.id },
                    pageTitle(
                      draft.pages[pageIndex === 0 ? 1 : pageIndex - 1].id,
                    ),
                    "Page removed.",
                  )
                }
              >
                Remove page
              </button>
            </div>
            {page.questions.map((question, index) => (
              <fieldset key={question.id}>
                <legend>Question {index + 1}</legend>
                <label>
                  Question wording
                  <input
                    {...textField(questionTitle(question.id), question.title)}
                    maxLength={300}
                    required
                  />
                </label>
                {question.type === "single_choice" &&
                  question.options.map((option, optionIndex) => (
                    <label key={option.code}>
                      Option {optionIndex + 1} wording
                      <input
                        {...textField(
                          optionLabel(question.id, optionIndex),
                          option.label,
                        )}
                        maxLength={160}
                        required
                      />
                    </label>
                  ))}
                <div className="actions">
                  <OrderControls
                    item="question"
                    index={index}
                    count={page.questions.length}
                    move={(toIndex) =>
                      moveQuestion(page, question, page.id, toIndex)
                    }
                  />
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      change(
                        {
                          kind: "remove-question",
                          pageId: page.id,
                          questionId: question.id,
                        },
                        pageTitle(page.id),
                        "Question removed.",
                      )
                    }
                  >
                    Remove question
                  </button>
                </div>
                {draft.pages.length > 1 && (
                  <MoveDestination
                    options={draft.pages.flatMap((target, targetIndex) =>
                      target.id === page.id
                        ? []
                        : [
                            {
                              id: target.id,
                              title: titleOf(target, targetIndex),
                              length: target.questions.length,
                            },
                          ],
                    )}
                    move={(toPageId, toIndex) =>
                      moveQuestion(page, question, toPageId, toIndex)
                    }
                  />
                )}
              </fieldset>
            ))}
            <QuestionAdder
              canAuthorNps={canAuthorNps}
              add={(question) =>
                change(
                  { kind: "add-question", pageId: page.id, question },
                  questionTitle(question.id),
                  "Question added.",
                )
              }
            />
          </fieldset>
        ))}
        <button type="button" className="secondary" onClick={addPage}>
          Add page
        </button>
        <div className="actions">
          <button>{saving ? "Saving edits…" : "Save edits"}</button>
          <button className="secondary" type="button" onClick={onCancel}>
            Cancel edits
          </button>
        </div>
      </fieldset>
      <div aria-live="polite">{announcement}</div>
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
    </form>
  );
}

function OrderControls({
  item,
  index,
  count,
  move,
}: {
  item: "page" | "question";
  index: number;
  count: number;
  move: (index: number) => void;
}) {
  return (
    <>
      <button
        type="button"
        className="secondary"
        disabled={index === 0}
        onClick={() => move(index - 1)}
      >
        Move {item} up
      </button>
      <button
        type="button"
        className="secondary"
        disabled={index === count - 1}
        onClick={() => move(index + 1)}
      >
        Move {item} down
      </button>
    </>
  );
}

function MoveDestination({
  options,
  move,
}: {
  options: { id: string; title: string; length: number }[];
  move: (id: string, toIndex: number) => void;
}) {
  const [chosen, setChosen] = useState("");
  const target = options.find(({ id }) => id === chosen);
  return (
    <>
      <label>
        Destination page
        <select
          value={target?.id ?? ""}
          onChange={(event) => setChosen(event.currentTarget.value)}
        >
          <option value="">Choose a page</option>
          {options.map(({ id, title }) => (
            <option value={id} key={id}>
              {title}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="secondary"
        disabled={!target}
        onClick={() => {
          if (target) move(target.id, target.length);
        }}
      >
        Move to page
      </button>
    </>
  );
}

function QuestionAdder({
  canAuthorNps,
  add,
}: {
  canAuthorNps: boolean;
  add: (question: Question) => void;
}) {
  const [chosen, setChosen] = useState<QuestionType>("single_choice");
  const type = chosen === "nps" && !canAuthorNps ? "single_choice" : chosen;
  return (
    <>
      <label>
        Question type to add
        <select
          value={type}
          onChange={(event) =>
            setChosen(event.currentTarget.value as QuestionType)
          }
        >
          <option value="single_choice">Single choice</option>
          <option value="short_text">Short text</option>
          <option value="number">Number</option>
          {canAuthorNps && <option value="nps">NPS (0–10)</option>}
        </select>
      </label>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          const id = newId("question_");
          add({
            id,
            code: id,
            title: "New question",
            required: true,
            ...(type === "single_choice"
              ? {
                  type,
                  options: [
                    { code: "option_1", label: "Option 1" },
                    { code: "option_2", label: "Option 2" },
                  ],
                }
              : { type }),
          });
        }}
      >
        Add question
      </button>
    </>
  );
}
