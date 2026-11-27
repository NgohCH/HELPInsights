import { useState } from "react";
import type { SurveyDefinition } from "../../packages/survey-runtime/definition.ts";
import type {
  TemplatePreview,
  TemplateSummary,
} from "../../packages/survey-runtime/templates.ts";
import { api } from "./api.ts";

export function TemplateLibrary({
  token,
  workspaceId,
  pending,
  run,
  onClone,
}: {
  token: string;
  workspaceId: string;
  pending: boolean;
  run: (operation: () => Promise<void>) => Promise<void>;
  onClone: (
    draft: { id: string; etag: string },
    definition: SurveyDefinition,
  ) => void;
}) {
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);

  function browse() {
    return run(async () => {
      const { data } = await api<TemplateSummary[]>("/templates", { token });
      setTemplates(data);
    });
  }

  function loadPreview(id: string) {
    return run(async () => {
      const { data } = await api<TemplatePreview>("/templates/" + id, {
        token,
      });
      setPreview(data);
    });
  }

  function clone(template: TemplatePreview) {
    return run(async () => {
      const { data, etag } = await api<{ id: string; draft: SurveyDefinition }>(
        "/templates/" + template.id + "/clone",
        {
          token,
          method: "POST",
          body: { workspaceId, revision: template.revision },
        },
      );
      if (!etag) throw new Error("The draft revision is unavailable");
      onClone({ id: data.id, etag }, data.draft);
    });
  }

  return (
    <div>
      {templates === null ? (
        <button
          type="button"
          className="secondary"
          disabled={pending}
          onClick={browse}
        >
          Browse templates
        </button>
      ) : (
        <ul>
          {templates.map((template) => (
            <li key={template.id}>
              <p>{template.summary}</p>
              <button
                type="button"
                className="secondary"
                disabled={pending}
                onClick={() => loadPreview(template.id)}
              >
                Preview {template.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {preview && (
        <section aria-labelledby="template-preview">
          <h3 id="template-preview">Template preview</h3>
          <p>
            <strong>{preview.title}</strong>
          </p>
          <p>{preview.usage}</p>
          {preview.definition.pages.map((page) => (
            <div key={page.id}>
              {page.title && <h4>{page.title}</h4>}
              {page.questions.map((question) => (
                <div key={question.id}>
                  <p>{question.title}</p>
                  {question.type === "single_choice" && (
                    <ul>
                      {question.options.map((option) => (
                        <li key={option.code}>{option.label}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          ))}
          <button
            type="button"
            disabled={pending || !workspaceId}
            onClick={() => clone(preview)}
          >
            Use this template
          </button>
        </section>
      )}
    </div>
  );
}
