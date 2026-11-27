import type { SurveyDefinition } from "./definition.ts";

export type TemplateSummary = {
  id: string;
  revision: number;
  title: string;
  summary: string;
  visibility: "global";
  publisher: string;
  usage: string;
};

export type TemplatePreview = TemplateSummary & {
  definition: SurveyDefinition;
};
