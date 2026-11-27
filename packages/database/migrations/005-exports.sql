DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helpinsights_exporter') THEN
        CREATE ROLE helpinsights_exporter NOLOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
END
$$;

CREATE FUNCTION public.can_report_version(p_version uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.survey_versions v
      JOIN public.surveys s ON s.id = v.survey_id
      WHERE v.id = p_version AND public.workspace_role(s.workspace_id) IN ('owner', 'analyst')
    )
$$;

CREATE POLICY reporting_responses ON public.responses FOR SELECT TO helpinsights_app
    USING (public.can_report_version(survey_version_id));
GRANT SELECT (survey_version_id, answers) ON public.responses TO helpinsights_app;

CREATE TABLE public.export_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_version_id uuid NOT NULL REFERENCES public.survey_versions (id),
    requested_by uuid NOT NULL REFERENCES public.users (id),
    format text NOT NULL CHECK (format IN ('csv_bundle', 'jasp_csv_bundle')),
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'completed', 'failed', 'expired')),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    archive bytea,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'completed') = (archive IS NOT NULL))
);

CREATE INDEX queued_exports ON public.export_jobs (next_attempt_at, created_at, id) WHERE status = 'queued';
CREATE INDEX expiring_exports ON public.export_jobs (expires_at) WHERE status = 'completed';

ALTER TABLE public.export_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY own_export_read ON public.export_jobs FOR SELECT TO helpinsights_app
    USING (
      requested_by = nullif(current_setting('helpinsights.actor_id', true), '')::uuid
      AND public.can_report_version(survey_version_id)
    );
CREATE POLICY own_export_queue ON public.export_jobs FOR INSERT TO helpinsights_app
    WITH CHECK (
      requested_by = nullif(current_setting('helpinsights.actor_id', true), '')::uuid
      AND public.can_report_version(survey_version_id)
    );
CREATE POLICY worker_read_exports ON public.export_jobs FOR SELECT TO helpinsights_exporter
    USING (true);
CREATE POLICY worker_write_exports ON public.export_jobs FOR UPDATE TO helpinsights_exporter
    USING (status IN ('queued', 'completed')) WITH CHECK (status IN ('queued', 'completed', 'failed', 'expired'));

GRANT SELECT (id, status, expires_at, archive),
      INSERT (survey_version_id, requested_by, format) ON public.export_jobs TO helpinsights_app;
GRANT SELECT (id, status, created_at, expires_at, attempts, next_attempt_at),
      UPDATE (status, expires_at, archive, attempts, next_attempt_at) ON public.export_jobs TO helpinsights_exporter;

CREATE FUNCTION public.export_source(p_job uuid)
RETURNS TABLE (
    version_id uuid, survey_id uuid, version integer, definition jsonb,
    requested_at timestamptz, format text, over_limit boolean, answers jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    WITH authorized_job AS (
      SELECT v.id AS version_id, v.survey_id, v.version, v.definition, j.created_at, j.format
      FROM public.export_jobs j
      JOIN public.survey_versions v ON v.id = j.survey_version_id
      JOIN public.surveys s ON s.id = v.survey_id
      JOIN public.workspace_memberships m ON m.workspace_id = s.workspace_id AND m.user_id = j.requested_by
      WHERE j.id = p_job AND j.status = 'queued' AND m.role IN ('owner', 'analyst')
    ), selected AS MATERIALIZED (
      SELECT r.accepted_at, r.id, r.answers
      FROM public.responses r JOIN authorized_job j ON j.version_id = r.survey_version_id
      WHERE r.accepted_at <= j.created_at
      ORDER BY r.id LIMIT 10001
    ), sizes AS (
      SELECT count(*) > 10000 OR coalesce(sum(octet_length(selected.answers::text)), 0) > 5000000 AS too_large
      FROM selected
    )
    SELECT j.version_id, j.survey_id, j.version, j.definition, j.created_at, j.format, sizes.too_large,
      CASE WHEN sizes.too_large THEN '[]'::jsonb ELSE coalesce((
        SELECT jsonb_agg(selected.answers ORDER BY selected.id) FROM selected
      ), '[]'::jsonb) END
    FROM authorized_job j CROSS JOIN sizes
$$;

REVOKE ALL ON FUNCTION public.export_source(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.export_source(uuid) TO helpinsights_exporter;

CREATE TABLE public.export_download_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    export_id uuid NOT NULL REFERENCES public.export_jobs (id),
    requested_by uuid NOT NULL REFERENCES public.users (id),
    authorized_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.export_download_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_own_export_download ON public.export_download_audit FOR INSERT TO helpinsights_app
    WITH CHECK (
      requested_by = nullif(current_setting('helpinsights.actor_id', true), '')::uuid
      AND EXISTS (
        SELECT 1 FROM public.export_jobs j
        WHERE j.id = export_id AND j.status = 'completed' AND j.expires_at > now()
      )
    );
GRANT INSERT (export_id, requested_by) ON public.export_download_audit TO helpinsights_app;
