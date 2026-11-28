CREATE TABLE public.university_eligibility_policies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces (id),
    code text NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 80),
    version integer NOT NULL CHECK (version > 0),
    approved_at timestamptz,
    withdrawn_at timestamptz,
    UNIQUE (workspace_id, code, version)
);

CREATE FUNCTION public.preserve_university_policy_version()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF ROW(OLD.workspace_id, OLD.code, OLD.version) IS DISTINCT FROM ROW(NEW.workspace_id, NEW.code, NEW.version) THEN
        RAISE EXCEPTION 'Create a new version to change an eligibility policy' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER preserve_university_policy_version
    BEFORE UPDATE ON public.university_eligibility_policies FOR EACH ROW
    EXECUTE FUNCTION public.preserve_university_policy_version();

REVOKE ALL ON FUNCTION public.preserve_university_policy_version() FROM PUBLIC;

CREATE TABLE public.university_eligibility_grants (
    policy_id uuid NOT NULL REFERENCES public.university_eligibility_policies (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
    PRIMARY KEY (policy_id, user_id)
);
CREATE INDEX university_eligibility_grants_user ON public.university_eligibility_grants (user_id);

ALTER TABLE public.university_eligibility_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.university_eligibility_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY view_workspace_eligibility ON public.university_eligibility_policies
    FOR SELECT TO helpinsights_app USING (public.workspace_role(workspace_id) IN ('owner', 'editor'));
REVOKE ALL ON TABLE public.university_eligibility_grants FROM PUBLIC, helpinsights_app;
GRANT SELECT ON public.university_eligibility_policies TO helpinsights_app;

ALTER TABLE public.distributions DROP CONSTRAINT distributions_eligibility_mode_check;
ALTER TABLE public.distributions ADD COLUMN university_policy_id uuid
    REFERENCES public.university_eligibility_policies (id);
ALTER TABLE public.distributions ADD CONSTRAINT distributions_eligibility_mode_check CHECK (
    (eligibility_mode IN ('open', 'registry-synthetic') AND university_policy_id IS NULL)
    OR (eligibility_mode = 'university' AND university_policy_id IS NOT NULL)
);
CREATE INDEX distributions_university_policy ON public.distributions (university_policy_id)
    WHERE university_policy_id IS NOT NULL;

CREATE FUNCTION public.validate_university_distribution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.survey_versions v
        JOIN public.surveys s ON s.id = v.survey_id
        JOIN public.university_eligibility_policies p ON p.workspace_id = s.workspace_id
        WHERE v.id = NEW.survey_version_id AND p.id = NEW.university_policy_id
          AND p.approved_at <= statement_timestamp() AND p.withdrawn_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Approved workspace eligibility policy required' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER validate_university_distribution
    BEFORE INSERT ON public.distributions FOR EACH ROW
    WHEN (NEW.eligibility_mode = 'university') EXECUTE FUNCTION public.validate_university_distribution();

REVOKE ALL ON FUNCTION public.validate_university_distribution() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.resolve_collection_distribution(p_token_hash bytea)
RETURNS TABLE (id uuid, definition jsonb, eligibility_mode text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT v.id, CASE WHEN d.eligibility_mode <> 'university' THEN v.definition END, d.eligibility_mode
    FROM public.resolve_distribution(p_token_hash) v
    JOIN public.distributions d ON d.token_hash = p_token_hash AND d.survey_version_id = v.id
$$;

CREATE FUNCTION public.university_distribution_allowed(p_token_hash bytea, p_version uuid, p_session_hash bytea)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.distributions d
        JOIN public.survey_versions v ON v.id = d.survey_version_id
        JOIN public.surveys survey ON survey.id = v.survey_id
        JOIN public.university_eligibility_policies p ON p.id = d.university_policy_id AND p.workspace_id = survey.workspace_id
        JOIN public.university_eligibility_grants g ON g.policy_id = p.id
        JOIN public.sessions s ON s.user_id = g.user_id AND s.token_hash = p_session_hash
        JOIN public.resolve_session(p_session_hash) a ON a.id = s.user_id
        WHERE d.token_hash = p_token_hash AND d.survey_version_id = p_version
          AND d.eligibility_mode = 'university' AND s.institutional_issuer IS NOT NULL
          AND p.approved_at <= statement_timestamp() AND p.withdrawn_at IS NULL
          AND g.expires_at > statement_timestamp()
    )
$$;

REVOKE ALL ON FUNCTION public.university_distribution_allowed(bytea, uuid, bytea) FROM PUBLIC;
CREATE FUNCTION public.resolve_university_definition(p_token_hash bytea, p_version uuid, p_session_hash bytea)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT v.definition FROM public.resolve_distribution(p_token_hash) v
    WHERE v.id = p_version AND public.university_distribution_allowed(p_token_hash, p_version, p_session_hash)
$$;

REVOKE ALL ON FUNCTION public.resolve_university_definition(bytea, uuid, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_university_definition(bytea, uuid, bytea) TO helpinsights_app;

CREATE OR REPLACE FUNCTION public.accept_response(
    p_token_hash bytea, p_version uuid, p_retry_key_hash bytea, p_payload_hash bytea,
    p_answers jsonb, p_registry_allowed boolean DEFAULT false
)
RETURNS TABLE (outcome text, receipt_id uuid, accepted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.distributions d
        WHERE d.token_hash = p_token_hash AND d.survey_version_id = p_version
          AND (d.eligibility_mode = 'open' OR (d.eligibility_mode = 'registry-synthetic' AND p_registry_allowed IS TRUE))
    ) THEN
        RETURN QUERY SELECT 'closed'::text, NULL::uuid, NULL::timestamptz;
        RETURN;
    END IF;

    RETURN QUERY SELECT a.outcome, a.receipt_id, a.accepted_at
    FROM public.accept_response_internal(p_token_hash, p_version, p_retry_key_hash, p_payload_hash, p_answers) a;
END
$$;

CREATE FUNCTION public.accept_university_response(
    p_token_hash bytea, p_version uuid, p_retry_key_hash bytea, p_payload_hash bytea,
    p_answers jsonb, p_session_hash bytea
)
RETURNS TABLE (outcome text, receipt_id uuid, accepted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NOT public.university_distribution_allowed(p_token_hash, p_version, p_session_hash) THEN
        RETURN QUERY SELECT 'eligibility_required'::text, NULL::uuid, NULL::timestamptz;
        RETURN;
    END IF;

    RETURN QUERY SELECT a.outcome, a.receipt_id, a.accepted_at
    FROM public.accept_response_internal(p_token_hash, p_version, p_retry_key_hash, p_payload_hash, p_answers) a;
END
$$;

REVOKE ALL ON FUNCTION public.accept_university_response(bytea, uuid, bytea, bytea, jsonb, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_university_response(bytea, uuid, bytea, bytea, jsonb, bytea) TO helpinsights_app;
