ALTER TABLE public.distributions ADD COLUMN eligibility_mode text NOT NULL DEFAULT 'open'
    CHECK (eligibility_mode IN ('open', 'registry-synthetic'));

CREATE FUNCTION public.resolve_collection_distribution(p_token_hash bytea)
RETURNS TABLE (id uuid, definition jsonb, eligibility_mode text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT v.id, v.definition, d.eligibility_mode
    FROM public.resolve_distribution(p_token_hash) v
    JOIN public.distributions d ON d.token_hash = p_token_hash AND d.survey_version_id = v.id
$$;

REVOKE ALL ON FUNCTION public.resolve_distribution(bytea) FROM helpinsights_app;
REVOKE ALL ON FUNCTION public.resolve_collection_distribution(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_collection_distribution(bytea) TO helpinsights_app;

ALTER FUNCTION public.accept_response(bytea, uuid, bytea, bytea, jsonb) RENAME TO accept_response_internal;
REVOKE ALL ON FUNCTION public.accept_response_internal(bytea, uuid, bytea, bytea, jsonb) FROM helpinsights_app;

CREATE FUNCTION public.accept_response(
    p_token_hash bytea, p_version uuid, p_retry_key_hash bytea, p_payload_hash bytea,
    p_answers jsonb, p_registry_allowed boolean DEFAULT false
)
RETURNS TABLE (outcome text, receipt_id uuid, accepted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    -- The trusted API runtime verifies the capability, then supplies only its yes/no result.
    IF NOT EXISTS (
        SELECT 1 FROM public.distributions d
        WHERE d.token_hash = p_token_hash AND d.survey_version_id = p_version
          AND (d.eligibility_mode = 'open' OR p_registry_allowed IS TRUE)
    ) THEN
        RETURN QUERY SELECT 'closed'::text, NULL::uuid, NULL::timestamptz;
        RETURN;
    END IF;

    RETURN QUERY SELECT a.outcome, a.receipt_id, a.accepted_at
    FROM public.accept_response_internal(p_token_hash, p_version, p_retry_key_hash, p_payload_hash, p_answers) a;
END
$$;

REVOKE ALL ON FUNCTION public.accept_response(bytea, uuid, bytea, bytea, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_response(bytea, uuid, bytea, bytea, jsonb, boolean) TO helpinsights_app;
