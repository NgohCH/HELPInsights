ALTER TABLE public.surveys
    ADD COLUMN closed_at timestamptz,
    ADD COLUMN retention_hold_revision bigint NOT NULL DEFAULT 0;

-- Historical close deadlines remain intact. New closures use the policy in force at closure.
CREATE FUNCTION public.stamp_survey_retention_deadline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_days integer;
BEGIN
    IF NEW.status = OLD.status THEN RETURN NEW; END IF;
    IF OLD.status = 'closed' OR (NEW.status = 'closed' AND OLD.status <> 'published') THEN
        RAISE EXCEPTION 'Survey retention prevents this status change' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'closed' THEN
        SELECT days_after_close INTO STRICT v_days
        FROM public.retention_policies
        WHERE id = NEW.retention_policy_id AND workspace_id = NEW.workspace_id;
        NEW.closed_at := statement_timestamp();
        NEW.expiry_at := NEW.closed_at + make_interval(hours => 24 * v_days);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER stamp_survey_retention_deadline BEFORE UPDATE OF status ON public.surveys
    FOR EACH ROW EXECUTE FUNCTION public.stamp_survey_retention_deadline();

REVOKE UPDATE (expiry_at) ON public.surveys FROM helpinsights_app;

CREATE TABLE public.retention_hold_approvers (
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    PRIMARY KEY (workspace_id, user_id),
    FOREIGN KEY (workspace_id, user_id)
        REFERENCES public.workspace_memberships (workspace_id, user_id) ON DELETE CASCADE
);

CREATE TABLE public.retention_holds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Keep minimal audit attribution when core survey records are eventually disposed.
    survey_id uuid NOT NULL,
    approved_by uuid NOT NULL REFERENCES public.users (id),
    reason text NOT NULL CHECK (reason IN ('legal', 'research')),
    evidence_reference uuid NOT NULL,
    applied_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (isfinite(expires_at) AND expires_at > applied_at),
    UNIQUE (survey_id, evidence_reference)
);

CREATE INDEX retention_holds_by_deadline
    ON public.retention_holds (survey_id, expires_at DESC);

ALTER TABLE public.retention_hold_approvers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_holds ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.retention_disposition(p_survey uuid, p_at timestamptz)
RETURNS TABLE (disposition text, expiry_at timestamptz, protected_until timestamptz)
LANGUAGE sql STABLE STRICT
SET search_path = pg_catalog, public
AS $$
    SELECT CASE
        WHEN hold.protected_until IS NOT NULL THEN 'held'
        WHEN s.status <> 'closed' THEN 'not_closed'
        WHEN s.expiry_at IS NULL OR NOT isfinite(s.expiry_at) THEN 'missing_deadline'
        WHEN p_at < s.expiry_at THEN 'scheduled'
        ELSE 'eligible'
    END, s.expiry_at, hold.protected_until
    FROM public.surveys s
    CROSS JOIN LATERAL (
        SELECT max(h.expires_at) AS protected_until
        FROM public.retention_holds h
        WHERE h.survey_id = s.id AND h.applied_at <= p_at AND p_at < h.expires_at
    ) hold
    WHERE s.id = p_survey
$$;

CREATE FUNCTION public.read_survey_retention(p_survey uuid)
RETURNS TABLE (disposition text, expiry_at timestamptz, protected_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT d.disposition, d.expiry_at, d.protected_until
    FROM public.surveys s
    CROSS JOIN LATERAL public.retention_disposition(s.id, statement_timestamp()) d
    WHERE s.id = p_survey AND EXISTS (
        SELECT 1 FROM public.workspace_memberships m
        WHERE m.workspace_id = s.workspace_id
            AND m.user_id = nullif(current_setting('helpinsights.actor_id', true), '')::uuid
    )
$$;

CREATE FUNCTION public.approve_retention_hold(
    p_survey uuid, p_reason text, p_evidence uuid, p_expiry timestamptz
)
RETURNS TABLE (
    outcome text, hold_id uuid, reason text, applied_at timestamptz, expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_workspace uuid;
    v_actor uuid := nullif(current_setting('helpinsights.actor_id', true), '')::uuid;
    v_now timestamptz;
BEGIN
    -- Share the core survey row lock with disposal guards so a successful hold protects the data.
    SELECT s.workspace_id INTO v_workspace
    FROM public.surveys s
    WHERE s.id = p_survey AND EXISTS (
        SELECT 1 FROM public.workspace_memberships m
        WHERE m.workspace_id = s.workspace_id AND m.user_id = v_actor
        FOR SHARE OF m
    )
    FOR UPDATE OF s;

    IF NOT FOUND THEN
        outcome := 'not_found';
    ELSIF NOT EXISTS (
        SELECT 1 FROM public.retention_hold_approvers a
        WHERE a.workspace_id = v_workspace AND a.user_id = v_actor
        FOR SHARE OF a
    ) THEN
        outcome := 'forbidden';
    ELSE
        v_now := clock_timestamp();
        IF p_expiry IS NULL OR NOT isfinite(p_expiry) OR p_expiry <= v_now
            OR p_reason IS NULL OR p_reason NOT IN ('legal', 'research') OR p_evidence IS NULL THEN
            outcome := 'invalid';
        ELSE
            INSERT INTO public.retention_holds AS h (survey_id, approved_by, reason, evidence_reference, applied_at, expires_at)
            VALUES (p_survey, v_actor, p_reason, p_evidence, v_now, p_expiry)
            ON CONFLICT (survey_id, evidence_reference) DO NOTHING
            RETURNING h.id, h.reason, h.applied_at, h.expires_at
                INTO hold_id, reason, applied_at, expires_at;
            IF FOUND THEN
                -- Advance the row version so an older repeatable-read deletion fails closed.
                UPDATE public.surveys SET retention_hold_revision = retention_hold_revision + 1
                WHERE id = p_survey;
                outcome := 'approved';
            ELSE
                outcome := 'duplicate';
            END IF;
        END IF;
    END IF;
    RETURN NEXT;
END;
$$;

CREATE FUNCTION public.guard_core_survey_deletion()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_survey uuid;
    v_disposition text;
BEGIN
    IF TG_TABLE_NAME = 'surveys' THEN
        v_survey := OLD.id;
    ELSIF TG_TABLE_NAME = 'survey_versions' THEN
        v_survey := OLD.survey_id;
    ELSE
        SELECT v.survey_id INTO v_survey
        FROM public.survey_versions v WHERE v.id = OLD.survey_version_id;
    END IF;

    -- A survey DELETE already locks its own row before processing the row trigger.
    IF TG_TABLE_NAME <> 'surveys' THEN
        PERFORM 1 FROM public.surveys s WHERE s.id = v_survey FOR UPDATE;
    END IF;
    SELECT d.disposition INTO v_disposition
    FROM public.retention_disposition(v_survey, clock_timestamp()) d;

    IF v_disposition IS DISTINCT FROM 'eligible' THEN
        RAISE EXCEPTION 'Survey retention prevents deletion' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER guard_survey_retention BEFORE DELETE ON public.surveys
    FOR EACH ROW EXECUTE FUNCTION public.guard_core_survey_deletion();
CREATE TRIGGER guard_survey_version_retention BEFORE DELETE ON public.survey_versions
    FOR EACH ROW EXECUTE FUNCTION public.guard_core_survey_deletion();
CREATE TRIGGER guard_survey_response_retention BEFORE DELETE ON public.responses
    FOR EACH ROW EXECUTE FUNCTION public.guard_core_survey_deletion();

REVOKE ALL ON FUNCTION public.stamp_survey_retention_deadline() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retention_disposition(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.read_survey_retention(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_retention_hold(uuid, text, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_core_survey_deletion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_survey_retention(uuid) TO helpinsights_app;
GRANT EXECUTE ON FUNCTION public.approve_retention_hold(uuid, text, uuid, timestamptz) TO helpinsights_app;
