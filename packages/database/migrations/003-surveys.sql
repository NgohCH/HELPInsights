CREATE TABLE public.retention_policies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces (id),
    days_after_close integer NOT NULL CHECK (days_after_close BETWEEN 1 AND 3650),
    UNIQUE (workspace_id, id)
);

CREATE TABLE public.surveys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces (id),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    privacy_mode text NOT NULL CHECK (privacy_mode = 'anonymous'),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
    retention_policy_id uuid NOT NULL,
    expiry_at timestamptz,
    draft jsonb,
    draft_revision integer NOT NULL DEFAULT 1 CHECK (draft_revision >= 1),
    FOREIGN KEY (workspace_id, retention_policy_id)
        REFERENCES public.retention_policies (workspace_id, id)
);

CREATE INDEX surveys_workspace ON public.surveys (workspace_id, id);

CREATE TABLE public.survey_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id uuid NOT NULL REFERENCES public.surveys (id),
    version integer NOT NULL CHECK (version > 0),
    definition jsonb NOT NULL,
    hash text NOT NULL CHECK (length(hash) = 64),
    published_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (survey_id, version)
);

CREATE TABLE public.distributions (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    survey_version_id uuid NOT NULL UNIQUE REFERENCES public.survey_versions (id)
);

CREATE FUNCTION public.workspace_role(p_workspace uuid)
RETURNS text LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT role FROM public.workspace_memberships WHERE workspace_id = p_workspace
$$;

CREATE FUNCTION public.resolve_distribution(p_token_hash bytea)
RETURNS TABLE (id uuid, definition jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT v.id, v.definition
    FROM public.distributions d
    JOIN public.survey_versions v ON v.id = d.survey_version_id
    JOIN public.surveys s ON s.id = v.survey_id
    WHERE d.token_hash = p_token_hash AND s.status = 'published'
$$;

ALTER TABLE public.retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY read_retention_policy ON public.retention_policies FOR SELECT TO helpinsights_app
    USING (public.workspace_role(workspace_id) IS NOT NULL);
CREATE POLICY read_surveys ON public.surveys FOR SELECT TO helpinsights_app
    USING (public.workspace_role(workspace_id) IS NOT NULL);
CREATE POLICY create_surveys ON public.surveys FOR INSERT TO helpinsights_app
    WITH CHECK (public.workspace_role(workspace_id) IN ('owner', 'editor'));
CREATE POLICY edit_surveys ON public.surveys FOR UPDATE TO helpinsights_app
    USING (public.workspace_role(workspace_id) IN ('owner', 'editor'))
    WITH CHECK (public.workspace_role(workspace_id) IN ('owner', 'editor'));
CREATE POLICY read_versions ON public.survey_versions FOR SELECT TO helpinsights_app
    USING (EXISTS (SELECT 1 FROM public.surveys s WHERE s.id = survey_id));
CREATE POLICY publish_versions ON public.survey_versions FOR INSERT TO helpinsights_app
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.surveys s WHERE s.id = survey_id
        AND public.workspace_role(s.workspace_id) IN ('owner', 'editor')
    ));
CREATE POLICY create_distributions ON public.distributions FOR INSERT TO helpinsights_app
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.survey_versions v JOIN public.surveys s ON s.id = v.survey_id
      WHERE v.id = survey_version_id AND public.workspace_role(s.workspace_id) IN ('owner', 'editor')
    ));

REVOKE ALL ON FUNCTION public.resolve_distribution(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_distribution(bytea) TO helpinsights_app;
GRANT SELECT ON public.retention_policies, public.surveys, public.survey_versions TO helpinsights_app;
GRANT INSERT (workspace_id, title, privacy_mode, retention_policy_id) ON public.surveys TO helpinsights_app;
GRANT UPDATE (title, draft, draft_revision, expiry_at, status) ON public.surveys TO helpinsights_app;
GRANT INSERT ON public.survey_versions, public.distributions TO helpinsights_app;
