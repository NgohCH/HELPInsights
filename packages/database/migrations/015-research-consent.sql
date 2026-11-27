CREATE TABLE public.research_consent_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_version_id uuid NOT NULL UNIQUE
        REFERENCES public.distributions (survey_version_id) ON DELETE CASCADE,
    study_key text NOT NULL CHECK (study_key = 'synthetic-consent-study'),
    revision integer NOT NULL CHECK (revision > 0),
    notice text NOT NULL CHECK (length(btrim(notice)) BETWEEN 1 AND 2000)
);

CREATE TABLE public.research_consent_opt_ins (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    consent_version_id uuid NOT NULL REFERENCES public.research_consent_versions (id) ON DELETE CASCADE
);
CREATE INDEX research_consent_opt_ins_version ON public.research_consent_opt_ins (consent_version_id);

-- These rows exist only during a single authorised call and never commit.
CREATE TABLE public.research_consent_transactions (
    transaction_id text PRIMARY KEY,
    consent_version_id uuid NOT NULL
);

ALTER TABLE public.research_consent_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_consent_opt_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_consent_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY research_consent_metadata_scoped ON public.research_consent_versions
    FOR SELECT TO helpinsights_app
    USING (EXISTS (SELECT 1 FROM public.survey_versions v WHERE v.id = research_consent_versions.survey_version_id));

CREATE POLICY research_consent_insert_scoped ON public.research_consent_versions
    FOR INSERT TO helpinsights_app
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.survey_versions v
        JOIN public.surveys s ON s.id = v.survey_id
        WHERE v.id = research_consent_versions.survey_version_id
          AND v.version = research_consent_versions.revision
          AND v.published_at = transaction_timestamp()
          AND public.workspace_role(s.workspace_id) IN ('owner', 'editor')
    ));

GRANT SELECT ON public.research_consent_versions TO helpinsights_app;
GRANT INSERT (survey_version_id, study_key, revision, notice)
    ON public.research_consent_versions TO helpinsights_app;

CREATE FUNCTION public.validate_research_distribution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.distributions d
        JOIN public.survey_versions v ON v.id = d.survey_version_id
        WHERE d.survey_version_id = NEW.survey_version_id AND d.eligibility_mode = 'open'
          AND jsonb_path_exists(v.definition, '$.pages[*].questions[*] ? (@.type == "single_choice")')
          AND NOT EXISTS (
              SELECT 1 FROM jsonb_path_query(v.definition, '$.pages[*].questions[*]') item(question)
              WHERE item.question->>'type' IS DISTINCT FROM 'single_choice'
          )
    ) THEN
        RAISE EXCEPTION 'Research consent requires an open test distribution with choice questions' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER validate_research_distribution
    BEFORE INSERT ON public.research_consent_versions
    FOR EACH ROW EXECUTE FUNCTION public.validate_research_distribution();

REVOKE ALL ON FUNCTION public.validate_research_distribution() FROM PUBLIC;

CREATE FUNCTION public.resolve_research_consent(p_token_hash bytea)
RETURNS TABLE (id uuid, study_key text, revision integer, notice text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT c.id, c.study_key, c.revision, c.notice
    FROM public.distributions d
    JOIN public.research_consent_versions c ON c.survey_version_id = d.survey_version_id
    JOIN public.survey_versions v ON v.id = d.survey_version_id
    JOIN public.surveys s ON s.id = v.survey_id
    WHERE d.token_hash = p_token_hash AND s.status = 'published'
$$;

CREATE FUNCTION public.record_research_consent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_consent_id uuid;
BEGIN
    SELECT c.id INTO v_consent_id FROM public.research_consent_versions c
    WHERE c.survey_version_id = NEW.survey_version_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.research_consent_transactions t
        WHERE t.transaction_id = pg_current_xact_id()::text
          AND t.consent_version_id = v_consent_id
    ) THEN
        RAISE EXCEPTION 'Research consent is required' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.research_consent_opt_ins (consent_version_id) VALUES (v_consent_id);
    RETURN NEW;
END
$$;

CREATE TRIGGER record_research_consent AFTER INSERT ON public.responses
    FOR EACH ROW EXECUTE FUNCTION public.record_research_consent();

CREATE FUNCTION public.accept_research_response(
    p_token_hash bytea, p_survey_version uuid, p_retry_key_hash bytea,
    p_payload_hash bytea, p_answers jsonb, p_consent_version uuid
)
RETURNS TABLE (outcome text, receipt_id uuid, accepted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_transaction_id text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.distributions d
        JOIN public.research_consent_versions c ON c.survey_version_id = d.survey_version_id
        WHERE d.token_hash = p_token_hash AND d.survey_version_id = p_survey_version
          AND c.id = p_consent_version
    ) THEN
        RETURN QUERY SELECT 'consent_required'::text, NULL::uuid, NULL::timestamptz;
        RETURN;
    END IF;

    v_transaction_id := pg_current_xact_id()::text;
    INSERT INTO public.research_consent_transactions (transaction_id, consent_version_id)
    VALUES (v_transaction_id, p_consent_version);

    RETURN QUERY SELECT a.outcome, a.receipt_id, a.accepted_at
    FROM public.accept_response(p_token_hash, p_survey_version, p_retry_key_hash, p_payload_hash, p_answers) a;

    DELETE FROM public.research_consent_transactions t WHERE t.transaction_id = v_transaction_id;
END
$$;

REVOKE ALL ON FUNCTION public.resolve_research_consent(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_research_consent() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_research_response(bytea, uuid, bytea, bytea, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_research_consent(bytea) TO helpinsights_app;
GRANT EXECUTE ON FUNCTION public.accept_research_response(bytea, uuid, bytea, bytea, jsonb, uuid) TO helpinsights_app;
