import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  isUnconditionalChoice,
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
type MoveSelection = { pageId: string; beforeQuestionId: string };
type DragSource =
  | { kind: "page"; pageId: string }
  | { kind: "question"; pageId: string; questionId: string };
type DropPosition =
  | { kind: "page"; index: number }
  | { kind: "question"; pageId: string; index: number };
const draftDragType = "application/x-helpinsights-survey-reorder";

function indexAfterRemoval(insertionIndex: number, sourceIndex: number) {
  return sourceIndex < insertionIndex ? insertionIndex - 1 : insertionIndex;
}
const surveyTitle = "survey-title";
const pageTitle = (id: string) => "page-title-" + id;
const questionTitle = (id: string) => "question-title-" + id;
const optionLabel = (id: string, index: number) => "option-" + id + "-" + index;
const answerSourceField = (id: string) => "answer-source-" + id;
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
  const [activeAnswerSource, setActiveAnswerSource] = useState("");
  const [moveDestination, setMoveDestination] = useState<
    MoveSelection & { questionId: string }
  >();
  const [wording, setWording] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [dragKind, setDragKind] = useState<DragSource["kind"]>();
  const [activeDrop, setActiveDrop] = useState<string>();
  const dragSource = useRef<DragSource>(null);
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
      setMoveDestination(undefined);
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

  function movePage(page: Page, pageIndex: number, toIndex: number) {
    change(
      { kind: "move-page", pageId: page.id, toIndex },
      pageTitle(page.id),
      titleOf(page, pageIndex) +
        " moved to page position " +
        (toIndex + 1) +
        ".",
    );
  }

  function moveQuestion(
    pageId: string,
    questionId: string,
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
        pageId,
        questionId,
        toPageId,
        toIndex,
      },
      questionTitle(questionId),
      "Question moved to " +
        destinationLabel +
        ", position " +
        (toIndex + 1) +
        ".",
    );
  }

  function clearDrag() {
    dragSource.current = null;
    setDragKind(undefined);
    setActiveDrop(undefined);
  }

  function dragHandle(source: DragSource) {
    return (
      <span
        className="draft-drag-handle"
        draggable={!saving}
        aria-hidden="true"
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(draftDragType, source.kind);
          dragSource.current = source;
          setDragKind(source.kind);
        }}
        onDragEnd={clearDrag}
      >
        Drag {source.kind}
      </span>
    );
  }

  function canDrop(event: DragEvent, destination: DropPosition) {
    return (
      !saving &&
      dragSource.current?.kind === destination.kind &&
      event.dataTransfer.types.includes(draftDragType)
    );
  }

  function drop(event: DragEvent, destination: DropPosition) {
    const source = dragSource.current;
    if (!source || !canDrop(event, destination)) return;

    event.preventDefault();
    clearDrag();

    const pageIndex = draft.pages.findIndex(({ id }) => id === source.pageId);
    const page = draft.pages[pageIndex];
    if (!page) return;

    if (source.kind === "page" && destination.kind === "page") {
      const toIndex = indexAfterRemoval(destination.index, pageIndex);
      if (toIndex !== pageIndex) movePage(page, pageIndex, toIndex);
    }

    if (source.kind === "question" && destination.kind === "question") {
      const sourceIndex = page.questions.findIndex(
        ({ id }) => id === source.questionId,
      );
      if (sourceIndex < 0) return;
      const samePage = source.pageId === destination.pageId;
      const toIndex = samePage
        ? indexAfterRemoval(destination.index, sourceIndex)
        : destination.index;
      if (!samePage || toIndex !== sourceIndex) {
        moveQuestion(
          source.pageId,
          source.questionId,
          destination.pageId,
          toIndex,
        );
      }
    }
  }

  function dropSlot(id: string, destination: DropPosition) {
    return (
      <div
        className="draft-drop-slot"
        aria-hidden="true"
        data-testid={id}
        data-drop-kind={destination.kind}
        data-active={activeDrop === id || undefined}
        onDragOver={(event) => {
          if (!canDrop(event, destination)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setActiveDrop(id);
        }}
        onDragLeave={() =>
          setActiveDrop((current) => (current === id ? undefined : current))
        }
        onDrop={(event) => drop(event, destination)}
      />
    );
  }

  const orderedQuestions = draft.pages.flatMap((page, pageIndex) =>
    page.questions.map((question, questionIndex) => ({
      question,
      position: "Page " + (pageIndex + 1) + ", question " + (questionIndex + 1),
    })),
  );

  const precedingSources = new Map<string, number>();
  const answerSources: typeof orderedQuestions = [];
  for (const entry of orderedQuestions) {
    precedingSources.set(entry.question.id, answerSources.length);
    if (isUnconditionalChoice(entry.question)) answerSources.push(entry);
  }
  const sourcesById = new Map(
    answerSources.map((entry) => [entry.question.id, entry]),
  );
  function setAnswerSource(
    pageId: string,
    questionId: string,
    sourceId: string,
  ) {
    setError("");
    setAnnouncement("");
    nextFocus.current = answerSourceField(questionId);
    setDraft((current) => ({
      ...current,
      pages: current.pages.map((page) =>
        page.id !== pageId
          ? page
          : {
              ...page,
              questions: page.questions.map((question) =>
                question.id === questionId
                  ? { ...question, titleAnswerSourceId: sourceId || undefined }
                  : question,
              ),
            },
      ),
    }));
  }

  function answerSourceControl(page: Page, question: Question) {
    const count = precedingSources.get(question.id) ?? 0;
    if (!count) return null;
    const expanded = activeAnswerSource === question.id;
    const name = answerSourceField(question.id);
    const summary = sourcesById.get(question.titleAnswerSourceId ?? "");
    const summaryId = summary && !expanded ? name + "-summary" : undefined;
    const hintId = name + "-hint";
    return (
      <>
        <button
          type="button"
          className="secondary"
          aria-expanded={expanded}
          aria-controls={expanded ? name : undefined}
          aria-describedby={summaryId}
          onClick={() => setActiveAnswerSource(expanded ? "" : question.id)}
        >
          Edit answer label source
        </button>
        {summary && summaryId && (
          <small id={summaryId}>
            Using {summary.position} —{" "}
            {value(questionTitle(summary.question.id), summary.question.title)}
          </small>
        )}
        {expanded && (
          <>
            <label>
              Append answer label from
              <select
                id={name}
                name={name}
                value={question.titleAnswerSourceId ?? ""}
                aria-describedby={hintId}
                onChange={(event) =>
                  setAnswerSource(
                    page.id,
                    question.id,
                    event.currentTarget.value,
                  )
                }
              >
                <option value="">No answer label</option>
                {answerSources
                  .slice(0, count)
                  .map(({ question: source, position }) => (
                    <option key={source.id} value={source.id}>
                      {position} —{" "}
                      {value(questionTitle(source.id), source.title)}
                    </option>
                  ))}
              </select>
            </label>
            <small id={hintId}>
              If no option is selected, the question uses its own wording.
            </small>
          </>
        )}
      </>
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
      <fieldset
        className="creator-inputs"
        disabled={saving}
        data-dragging={dragKind}
      >
        <label>
          Saved survey title
          <input
            {...textField(surveyTitle, draft.title)}
            maxLength={200}
            required
          />
        </label>
        <p className="draft-drag-hint" aria-hidden="true">
          Drag a page or question by its handle, then drop on a highlighted
          line.
        </p>
        {draft.pages.map((page, pageIndex) => (
          <Fragment key={page.id}>
            {dropSlot("drop-page-before-" + page.id, {
              kind: "page",
              index: pageIndex,
            })}
            <fieldset>
              <legend>{titleOf(page, pageIndex)}</legend>
              <label>
                Page title
                <input
                  {...textField(pageTitle(page.id), page.title)}
                  maxLength={160}
                />
              </label>
              <div className="actions">
                {dragHandle({ kind: "page", pageId: page.id })}
                <OrderControls
                  item="page"
                  index={pageIndex}
                  count={draft.pages.length}
                  move={(toIndex) => movePage(page, pageIndex, toIndex)}
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
                <Fragment key={question.id}>
                  {dropSlot("drop-question-before-" + question.id, {
                    kind: "question",
                    pageId: page.id,
                    index,
                  })}
                  <fieldset>
                    <legend>Question {index + 1}</legend>
                    <label>
                      Question wording
                      <input
                        {...textField(
                          questionTitle(question.id),
                          question.title,
                        )}
                        maxLength={300}
                        required
                      />
                    </label>
                    {answerSourceControl(page, question)}
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
                      {dragHandle({
                        kind: "question",
                        pageId: page.id,
                        questionId: question.id,
                      })}
                      <OrderControls
                        item="question"
                        index={index}
                        count={page.questions.length}
                        move={(toIndex) =>
                          moveQuestion(page.id, question.id, page.id, toIndex)
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
                                  questions: target.questions,
                                },
                              ],
                        )}
                        selection={
                          moveDestination?.questionId === question.id
                            ? moveDestination
                            : undefined
                        }
                        onSelect={(selection) =>
                          setMoveDestination({
                            ...selection,
                            questionId: question.id,
                          })
                        }
                        questionWording={(target) =>
                          value(questionTitle(target.id), target.title)
                        }
                        move={(toPageId, toIndex) =>
                          moveQuestion(page.id, question.id, toPageId, toIndex)
                        }
                      />
                    )}
                  </fieldset>
                </Fragment>
              ))}
              {dropSlot("drop-questions-end-" + page.id, {
                kind: "question",
                pageId: page.id,
                index: page.questions.length,
              })}
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
          </Fragment>
        ))}
        {dropSlot("drop-pages-end", {
          kind: "page",
          index: draft.pages.length,
        })}
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
  selection,
  onSelect,
  questionWording,
  move,
}: {
  options: { id: string; title: string; questions: Question[] }[];
  selection?: MoveSelection;
  onSelect: (selection: MoveSelection) => void;
  questionWording: (question: Question) => string;
  move: (id: string, toIndex: number) => void;
}) {
  const target = options.find(({ id }) => id === selection?.pageId);
  const beforeQuestionId = selection?.beforeQuestionId ?? "";
  const toIndex =
    (beforeQuestionId
      ? target?.questions.findIndex(({ id }) => id === beforeQuestionId)
      : target?.questions.length) ?? -1;
  return (
    <>
      <label>
        Destination page
        <select
          value={target?.id ?? ""}
          onChange={(event) =>
            onSelect({
              pageId: event.currentTarget.value,
              beforeQuestionId: "",
            })
          }
        >
          <option value="">Choose a page</option>
          {options.map(({ id, title }) => (
            <option value={id} key={id}>
              {title}
            </option>
          ))}
        </select>
      </label>
      {target && target.questions.length > 0 && (
        <label>
          Position on destination page
          <select
            value={beforeQuestionId}
            onChange={(event) =>
              onSelect({
                pageId: target.id,
                beforeQuestionId: event.currentTarget.value,
              })
            }
          >
            <option value="">End of page</option>
            {target.questions.map((question, index) => (
              <option value={question.id} key={question.id}>
                Before question {index + 1} — {questionWording(question)}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        className="secondary"
        disabled={toIndex < 0}
        onClick={() => {
          if (target && toIndex >= 0) move(target.id, toIndex);
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
