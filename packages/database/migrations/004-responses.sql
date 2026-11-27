CREATE TABLE public.responses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_version_id uuid NOT NULL REFERENCES public.survey_versions (id),
    answers jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'array'),
    retry_key_hash bytea NOT NULL CHECK (octet_length(retry_key_hash) = 32),
    payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
    accepted_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (survey_version_id, retry_key_hash)
);

ALTER TABLE public.responses ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.accept_response(
    p_token_hash bytea, p_version uuid, p_retry_key_hash bytea, p_payload_hash bytea, p_answers jsonb
)
RETURNS TABLE (outcome text, receipt_id uuid, accepted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_open_version uuid;
    v_response public.responses%ROWTYPE;
BEGIN
    SELECT v.id INTO v_open_version
    FROM public.distributions d
    JOIN public.survey_versions v ON v.id = d.survey_version_id
    JOIN public.surveys s ON s.id = v.survey_id
    WHERE d.token_hash = p_token_hash AND s.status = 'published'
    FOR SHARE OF s;

    IF v_open_version IS DISTINCT FROM p_version THEN
        RETURN QUERY SELECT 'closed'::text, NULL::uuid, NULL::timestamptz;
        RETURN;
    END IF;

    INSERT INTO public.responses AS r (survey_version_id, retry_key_hash, payload_hash, answers)
    VALUES (p_version, p_retry_key_hash, p_payload_hash, p_answers)
    ON CONFLICT (survey_version_id, retry_key_hash) DO NOTHING
    RETURNING r.* INTO v_response;

    IF FOUND THEN
        RETURN QUERY SELECT 'accepted'::text, v_response.id, v_response.accepted_at;
        RETURN;
    END IF;

    SELECT r.* INTO STRICT v_response FROM public.responses r
    WHERE r.survey_version_id = p_version AND r.retry_key_hash = p_retry_key_hash;
    IF v_response.payload_hash = p_payload_hash AND v_response.answers = p_answers THEN
        RETURN QUERY SELECT 'retry'::text, v_response.id, v_response.accepted_at;
    ELSE
        RETURN QUERY SELECT 'conflict'::text, NULL::uuid, NULL::timestamptz;
    END IF;
END
$$;

REVOKE ALL ON FUNCTION public.accept_response(bytea, uuid, bytea, bytea, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_response(bytea, uuid, bytea, bytea, jsonb) TO helpinsights_app;
