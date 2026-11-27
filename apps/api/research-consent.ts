import type { SurveyDefinition } from "../../packages/survey-runtime/definition.ts";

export type ResearchConsent = {
  id: string;
  studyKey: string;
  revision: number;
  notice: string;
};

export const syntheticStudyKey = "synthetic-consent-study";
export const syntheticConsentNotice =
  "Participation is voluntary. This study is for local testing with synthetic data. If you agree, your anonymous sample answer and a separate opt-in record will be stored in the disposable test database.";

export function syntheticConsentEnabled(env: NodeJS.ProcessEnv) {
  return (
    env.NODE_ENV === "test" &&
    env.HELPINSIGHTS_DEV_RESEARCH_CONSENT === "synthetic"
  );
}

export function supportsSyntheticConsent(definition: SurveyDefinition) {
  const questions = definition.pages.flatMap((page) => page.questions);
  return (
    questions.length > 0 &&
    questions.every((item) => item.type === "single_choice")
  );
}
