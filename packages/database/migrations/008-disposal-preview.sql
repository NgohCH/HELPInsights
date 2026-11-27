CREATE TABLE public.survey_disposal_tombstones (
    survey_id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    disposed_at timestamptz NOT NULL CHECK (isfinite(disposed_at))
);

ALTER TABLE public.survey_disposal_tombstones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.survey_disposal_tombstones FROM PUBLIC;

CREATE INDEX export_jobs_version ON public.export_jobs (survey_version_id);
CREATE INDEX export_download_audit_job ON public.export_download_audit (export_id);

CREATE FUNCTION public.retention_disposal_check(p_survey uuid, p_at timestamptz)
RETURNS TABLE (disposition text, expiry_at timestamptz, protected_until timestamptz)
LANGUAGE sql STABLE STRICT
SET search_path = pg_catalog, public
AS $$
    SELECT CASE WHEN d.disposition = 'eligible' AND EXISTS (
        SELECT 1 FROM public.export_jobs j
        JOIN public.survey_versions v ON v.id = j.survey_version_id
        WHERE v.survey_id = p_survey AND j.status = 'queued'
    ) THEN 'export_pending' ELSE d.disposition END, d.expiry_at, d.protected_until
    FROM public.retention_disposition(p_survey, p_at) d
$$;

CREATE FUNCTION public.read_disposal_preview(p_survey uuid)
RETURNS TABLE (outcome text, disposition text, expiry_at timestamptz, protected_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT CASE WHEN a.user_id IS NULL THEN 'forbidden' ELSE 'preview' END,
        d.disposition, d.expiry_at, d.protected_until
    FROM public.surveys s
    JOIN public.workspace_memberships m ON m.workspace_id = s.workspace_id
        AND m.user_id = nullif(current_setting('helpinsights.actor_id', true), '')::uuid
    LEFT JOIN public.retention_hold_approvers a
        ON a.workspace_id = m.workspace_id AND a.user_id = m.user_id
    LEFT JOIN LATERAL public.retention_disposal_check(s.id, statement_timestamp()) d
        ON a.user_id IS NOT NULL
    WHERE s.id = p_survey
$$;

REVOKE ALL ON FUNCTION public.retention_disposal_check(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.read_disposal_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_disposal_preview(uuid) TO helpinsights_app;
