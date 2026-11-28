import {
  InvalidInput,
  parseDefinition,
  type Question,
  type SurveyDefinition,
} from "./definition.ts";

export type SurveyStructureChange =
  | { kind: "add-page"; pageId: string }
  | { kind: "remove-page"; pageId: string }
  | { kind: "move-page"; pageId: string; toIndex: number }
  | { kind: "add-question"; pageId: string; question: Question }
  | { kind: "remove-question"; pageId: string; questionId: string }
  | {
      kind: "move-question";
      pageId: string;
      questionId: string;
      toPageId: string;
      toIndex: number;
    };

function findPage(pages: SurveyDefinition["pages"], id: string): number {
  const index = pages.findIndex((page) => page.id === id);
  if (index === -1)
    throw new InvalidInput("This page is no longer in the draft.");
  return index;
}

function insert<T>(items: T[], index: number, item: T): T[] {
  if (!Number.isInteger(index) || index < 0 || index > items.length) {
    throw new InvalidInput("Choose a position within the destination.");
  }
  return [...items.slice(0, index), item, ...items.slice(index)];
}

export function editSurveyStructure(
  draft: SurveyDefinition,
  change: SurveyStructureChange,
): SurveyDefinition {
  if (change.kind === "add-page") {
    return parseDefinition({
      ...draft,
      pages: [...draft.pages, { id: change.pageId, questions: [] }],
    });
  }

  let pages = [...draft.pages];
  const pageIndex = findPage(pages, change.pageId);
  const page = pages[pageIndex];
  switch (change.kind) {
    case "remove-page": {
      if (pages.length === 1)
        throw new InvalidInput("The draft must keep at least one page.");
      pages.splice(pageIndex, 1);
      break;
    }
    case "move-page": {
      pages.splice(pageIndex, 1);
      pages = insert(pages, change.toIndex, page);
      break;
    }
    case "add-question": {
      pages[pageIndex] = {
        ...page,
        questions: [...page.questions, change.question],
      };
      break;
    }
    case "remove-question":
    case "move-question": {
      const question = page.questions.find(
        ({ id }) => id === change.questionId,
      );
      if (!question)
        throw new InvalidInput(
          "This question is no longer on the selected page.",
        );
      pages[pageIndex] = {
        ...page,
        questions: page.questions.filter(({ id }) => id !== question.id),
      };
      if (change.kind === "move-question") {
        const targetIndex = findPage(pages, change.toPageId);
        const target = pages[targetIndex];
        pages[targetIndex] = {
          ...target,
          questions: insert(target.questions, change.toIndex, question),
        };
      }
      break;
    }
  }

  return parseDefinition({ ...draft, pages });
}
