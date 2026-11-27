CREATE TABLE public.case_handoff_reviewers (
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    PRIMARY KEY (workspace_id, user_id),
    FOREIGN KEY (workspace_id, user_id)
        REFERENCES public.workspace_memberships (workspace_id, user_id) ON DELETE CASCADE
);

CREATE TABLE public.case_handoff_basis (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces (id),
    survey_version_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind = 'synthetic_fixture'),
    approved_at timestamptz NOT NULL CHECK (isfinite(approved_at)),
    expires_at timestamptz NOT NULL CHECK (isfinite(expires_at) AND expires_at > approved_at),
    revoked_at timestamptz
);

CREATE TABLE public.case_handoff_events (
    event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces (id),
    organisation_id uuid NOT NULL REFERENCES public.organisations (id),
    survey_id uuid NOT NULL,
    survey_version_id uuid NOT NULL,
    approved_by uuid NOT NULL REFERENCES public.users (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    category text NOT NULL CHECK (category IN ('course_materials', 'campus_facilities', 'service_process')),
    priority text NOT NULL CHECK (priority IN ('normal', 'high')),
    sanitised_summary text GENERATED ALWAYS AS (
        CASE category
            WHEN 'course_materials' THEN 'Review a course materials concern identified in the synthetic exercise.'
            WHEN 'campus_facilities' THEN 'Review a campus facilities concern identified in the synthetic exercise.'
            WHEN 'service_process' THEN 'Review a service process concern identified in the synthetic exercise.'
        END
    ) STORED NOT NULL,
    basis_id uuid NOT NULL REFERENCES public.case_handoff_basis (id),
    origin_mode text NOT NULL DEFAULT 'anonymous_aggregate' CHECK (origin_mode = 'anonymous_aggregate'),
    status text NOT NULL DEFAULT 'queued' CHECK (status = 'queued'),
    idempotency_key uuid NOT NULL,
    UNIQUE (workspace_id, approved_by, idempotency_key)
);

ALTER TABLE public.case_handoff_reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_handoff_basis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_handoff_events ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.queue_synthetic_case_handoff(
    p_survey uuid, p_version uuid, p_basis uuid, p_key uuid,
    p_category text, p_priority text, p_approved boolean
)
RETURNS TABLE (outcome text, receipt jsonb)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor uuid := nullif(current_setting('helpinsights.actor_id', true), '')::uuid;
    v_workspace uuid;
    v_organisation uuid;
    v_now timestamptz;
    v_basis public.case_handoff_basis%ROWTYPE;
    v_event public.case_handoff_events%ROWTYPE;
BEGIN
    SELECT s.workspace_id, w.organisation_id INTO v_workspace, v_organisation
    FROM public.surveys s
    JOIN public.workspaces w ON w.id = s.workspace_id
    JOIN public.survey_versions v ON v.survey_id = s.id
    JOIN public.workspace_memberships m ON m.workspace_id = s.workspace_id AND m.user_id = v_actor
    WHERE s.id = p_survey AND v.id = p_version AND s.privacy_mode = 'anonymous'
        AND s.status IN ('published', 'closed')
    FOR SHARE OF s, m;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'not_found'::text, NULL::jsonb;
        RETURN;
    END IF;
    PERFORM 1 FROM public.case_handoff_reviewers a
    WHERE a.workspace_id = v_workspace AND a.user_id = v_actor
    FOR SHARE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'forbidden'::text, NULL::jsonb;
        RETURN;
    END IF;
    IF p_approved IS DISTINCT FROM true OR p_key IS NULL
        OR p_category IS NULL OR p_category NOT IN ('course_materials', 'campus_facilities', 'service_process')
        OR p_priority IS NULL OR p_priority NOT IN ('normal', 'high') THEN
        RETURN QUERY SELECT 'invalid'::text, NULL::jsonb;
        RETURN;
    END IF;

    SELECT b.* INTO v_basis FROM public.case_handoff_basis b
    WHERE b.id = p_basis AND b.workspace_id = v_workspace AND b.survey_version_id = p_version
        AND b.kind = 'synthetic_fixture'
    FOR SHARE;
    v_now := clock_timestamp();
    IF v_basis.id IS NULL OR v_basis.revoked_at IS NOT NULL
        OR v_now < v_basis.approved_at OR v_now >= v_basis.expires_at THEN
        RETURN QUERY SELECT 'basis_required'::text, NULL::jsonb;
        RETURN;
    END IF;

    INSERT INTO public.case_handoff_events AS e
        (workspace_id, organisation_id, survey_id, survey_version_id, approved_by, category, priority, basis_id, idempotency_key)
    VALUES (v_workspace, v_organisation, p_survey, p_version, v_actor, p_category, p_priority, p_basis, p_key)
    ON CONFLICT (workspace_id, approved_by, idempotency_key) DO NOTHING
    RETURNING e.* INTO v_event;

    IF NOT FOUND THEN
        SELECT e.* INTO STRICT v_event FROM public.case_handoff_events e
        WHERE e.workspace_id = v_workspace AND e.approved_by = v_actor AND e.idempotency_key = p_key;
        IF (v_event.survey_id, v_event.survey_version_id, v_event.category, v_event.priority, v_event.basis_id)
            IS DISTINCT FROM (p_survey, p_version, p_category, p_priority, p_basis) THEN
            RETURN QUERY SELECT 'conflict'::text, NULL::jsonb;
            RETURN;
        END IF;
    END IF;
    RETURN QUERY SELECT 'queued'::text, jsonb_build_object(
        'eventId', v_event.event_id,
        'eventType', 'survey.action.requested.v1',
        'organisationId', v_event.organisation_id,
        'surveyId', v_event.survey_id,
        'surveyVersionId', v_event.survey_version_id,
        'createdAt', v_event.created_at,
        'category', v_event.category,
        'priority', v_event.priority,
        'sanitisedSummary', v_event.sanitised_summary,
        'consentOrLawfulBasisRef', v_event.basis_id,
        'originMode', v_event.origin_mode,
        'idempotencyKey', v_event.idempotency_key,
        'status', v_event.status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.queue_synthetic_case_handoff(uuid, uuid, uuid, uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.queue_synthetic_case_handoff(uuid, uuid, uuid, uuid, text, text, boolean) TO helpinsights_app;
