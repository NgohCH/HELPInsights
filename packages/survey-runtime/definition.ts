export type Option = { code: string; label: string };
export type QuestionVisibility = { questionId: string; optionCode: string };
export type Question = {
  id: string;
  code: string;
  title: string;
  required: boolean;
  visibleWhen?: QuestionVisibility;
} & (
  | { type: "single_choice"; options: Option[] }
  | { type: "short_text" | "number" | "nps" }
);
export type SurveyDefinition = {
  schemaVersion: "1";
  title: string;
  description?: string;
  pages: Array<{ id: string; title?: string; questions: Question[] }>;
};

export class InvalidInput extends Error {}

export function object(
  value: unknown,
  keys: string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidInput("Expected a JSON object");
  }
  const properties = Object.keys(value);
  if (properties.some((key) => !keys.includes(key)))
    throw new InvalidInput("Unexpected field");
  return value as Record<string, unknown>;
}

export function label(value: unknown, name: string, max: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    value.includes("\0")
  ) {
    throw new InvalidInput(
      name + " must contain from 1 to " + max + " characters",
    );
  }
  return value.trim();
}

export function uuid(value: unknown, name: string) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
  ) {
    throw new InvalidInput(name + " must be a UUID");
  }
  return value.toLowerCase();
}

function collection(value: unknown, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new InvalidInput("An item collection exceeds its allowed size");
  }
  return value;
}

function code(value: unknown, options = false): string {
  const pattern = options
    ? /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
    : /^[a-z][a-z0-9_]{0,63}$/;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new InvalidInput("Use a stable machine-readable identifier");
  }
  return value;
}

function unique(values: string[], name: string) {
  if (new Set(values).size !== values.length)
    throw new InvalidInput(name + " must be unique");
}

function parseVisibility(value: unknown): QuestionVisibility {
  const condition = object(value, ["questionId", "optionCode"]);
  return {
    questionId: code(condition.questionId, true),
    optionCode: code(condition.optionCode, true),
  };
}

export function isQuestionVisible(
  question: Question,
  answers: ReadonlyMap<string, unknown>,
): boolean {
  const condition = question.visibleWhen;
  return (
    !condition || answers.get(condition.questionId) === condition.optionCode
  );
}

export function parseDefinition(value: unknown): SurveyDefinition {
  const input = object(value, [
    "schemaVersion",
    "title",
    "description",
    "pages",
  ]);
  if (input.schemaVersion !== "1")
    throw new InvalidInput("Unsupported definition schema version");
  const pages = collection(input.pages, 1, 20).map((page) => {
    const item = object(page, ["id", "title", "questions"]);
    const questions = collection(item.questions, 0, 50).map(
      (question): Question => {
        const q = object(question, [
          "id",
          "code",
          "type",
          "title",
          "required",
          "options",
          "visibleWhen",
        ]);
        if (typeof q.required !== "boolean")
          throw new InvalidInput("Question required must be a boolean");
        const base = {
          id: code(q.id, true),
          code: code(q.code),
          title: label(q.title, "Question title", 300),
          required: q.required,
          ...(q.visibleWhen === undefined
            ? {}
            : { visibleWhen: parseVisibility(q.visibleWhen) }),
        };
        if (q.type === "single_choice") {
          const options = collection(q.options, 2, 20).map((option) => {
            const o = object(option, ["code", "label"]);
            return {
              code: code(o.code, true),
              label: label(o.label, "Option label", 160),
            };
          });
          unique(
            options.map((option) => option.code),
            "Option codes",
          );
          return { ...base, type: "single_choice", options };
        }
        if (
          (q.type === "short_text" ||
            q.type === "number" ||
            q.type === "nps") &&
          q.options === undefined
        ) {
          return { ...base, type: q.type };
        }
        throw new InvalidInput("Unsupported question type");
      },
    );
    return {
      id: code(item.id, true),
      ...(item.title === undefined
        ? {}
        : { title: label(item.title, "Page title", 160) }),
      questions,
    };
  });
  const questions = pages.flatMap((page) => page.questions);
  unique(
    pages.map((page) => page.id),
    "Page IDs",
  );
  unique(
    questions.map((question) => question.id),
    "Question IDs",
  );
  unique(
    questions.map((question) => question.code),
    "Question codes",
  );
  const controllers = new Map<string, Set<string>>();
  for (const question of questions) {
    if (question.visibleWhen) {
      const { questionId, optionCode } = question.visibleWhen;
      if (!controllers.get(questionId)?.has(optionCode))
        throw new InvalidInput(
          "Visibility requires an earlier unconditional choice and one of its options",
        );
    } else if (question.type === "single_choice") {
      controllers.set(
        question.id,
        new Set(question.options.map((option) => option.code)),
      );
    }
  }
  return {
    schemaVersion: "1",
    title: label(input.title, "Survey title", 200),
    ...(input.description === undefined
      ? {}
      : { description: label(input.description, "Description", 5000) }),
    pages,
  };
}
