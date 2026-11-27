import {
  InvalidInput,
  isQuestionVisible,
  label,
  object,
  type SurveyDefinition,
} from "./definition.ts";

export type Answer = { questionId: string; value: string | number };

export function parseAnswers(
  definition: SurveyDefinition,
  value: unknown,
): Answer[] {
  const questions = definition.pages.flatMap((page) => page.questions);
  if (!Array.isArray(value) || value.length > questions.length)
    throw new InvalidInput("Invalid answer array");
  const byId = new Map<string, unknown>();
  for (const input of value) {
    const entry = object(input, ["questionId", "value"]);
    if (typeof entry.questionId !== "string" || byId.has(entry.questionId)) {
      throw new InvalidInput("Question IDs must be unique");
    }
    if (!questions.some((question) => question.id === entry.questionId)) {
      throw new InvalidInput("An answer references an unknown question");
    }
    byId.set(entry.questionId, entry.value);
  }

  const answers: Answer[] = [];
  for (const question of questions) {
    if (!isQuestionVisible(question, byId)) {
      if (byId.has(question.id))
        throw new InvalidInput("An answer references a hidden question");
      continue;
    }
    if (!byId.has(question.id)) {
      if (question.required)
        throw new InvalidInput("Answer every required question");
      continue;
    }
    const input = byId.get(question.id);
    switch (question.type) {
      case "single_choice":
        if (
          typeof input !== "string" ||
          !question.options.some((option) => option.code === input)
        ) {
          throw new InvalidInput("Select a listed answer");
        }
        answers.push({ questionId: question.id, value: input });
        break;
      case "short_text":
        answers.push({
          questionId: question.id,
          value: label(input, "Answer", 500),
        });
        break;
      case "number":
        if (typeof input !== "number" || !Number.isFinite(input))
          throw new InvalidInput("Enter a finite number");
        answers.push({ questionId: question.id, value: input });
        break;
    }
  }
  return answers;
}
