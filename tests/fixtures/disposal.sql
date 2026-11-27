-- This fixture is excluded from the runtime image and normal migrations.
DO $fixture$
BEGIN
    IF current_database() !~ '^helpinsights_disposal_[a-f0-9]{12}$' THEN
        RAISE EXCEPTION 'Expected an owned disposal fixture database' USING ERRCODE = '42501';
    END IF;
END
$fixture$;

CREATE SCHEMA disposal_fixture;
REVOKE ALL ON SCHEMA disposal_fixture FROM PUBLIC;

CREATE TABLE disposal_fixture.run_scope (
    project text NOT NULL CHECK (project ~ '^helpinsights-test-[a-f0-9]{12}$'),
    database_name name NOT NULL CHECK (database_name = current_database()),
    marker uuid NOT NULL,
    survey_id uuid PRIMARY KEY
);

CREATE FUNCTION disposal_fixture.dispose(
    p_project text, p_marker uuid, p_survey uuid, p_replay_workspace uuid, p_replay_at timestamptz
)
RETURNS TABLE (outcome text)
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_workspace uuid;
    v_disposition text;
BEGIN
    IF current_database() !~ '^helpinsights_disposal_[a-f0-9]{12}$'
        OR NOT EXISTS (
            SELECT 1 FROM disposal_fixture.run_scope f
            WHERE f.project = p_project AND f.database_name = current_database()
                AND f.marker = p_marker AND f.survey_id = p_survey
        ) THEN
        RAISE EXCEPTION 'Disposal fixture target is outside this run' USING ERRCODE = '42501';
    END IF;
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Disposal fixture requires read committed transactions';
    END IF;
    IF (p_replay_workspace IS NULL) <> (p_replay_at IS NULL)
        OR (p_replay_at IS NOT NULL AND (NOT isfinite(p_replay_at) OR p_replay_at > clock_timestamp())) THEN
        RAISE EXCEPTION 'Invalid fixture tombstone';
    END IF;

    -- Serialize against hold approval and then block new exports on each version.
    SELECT s.workspace_id INTO v_workspace FROM public.surveys s
        WHERE s.id = p_survey FOR UPDATE;
    IF NOT FOUND THEN
        SELECT t.workspace_id INTO v_workspace FROM public.survey_disposal_tombstones t
            WHERE t.survey_id = p_survey;
        outcome := CASE
            WHEN NOT FOUND THEN 'not_found'
            WHEN p_replay_workspace IS NOT NULL AND p_replay_workspace <> v_workspace THEN 'workspace_mismatch'
            ELSE 'already_disposed'
        END;
        RETURN NEXT;
        RETURN;
    END IF;
    IF p_replay_workspace IS NOT NULL AND p_replay_workspace <> v_workspace THEN
        outcome := 'workspace_mismatch';
        RETURN NEXT;
        RETURN;
    END IF;

    PERFORM v.id FROM public.survey_versions v WHERE v.survey_id = p_survey ORDER BY v.id FOR UPDATE;
    PERFORM j.id FROM public.export_jobs j
        JOIN public.survey_versions v ON v.id = j.survey_version_id
        WHERE v.survey_id = p_survey ORDER BY j.id FOR UPDATE OF j;
    SELECT d.disposition INTO STRICT v_disposition
        FROM public.retention_disposal_check(p_survey, clock_timestamp()) d;
    IF v_disposition <> 'eligible' THEN
        outcome := v_disposition;
        RETURN NEXT;
        RETURN;
    END IF;

    DELETE FROM public.export_download_audit a USING public.export_jobs j, public.survey_versions v
        WHERE a.export_id = j.id AND j.survey_version_id = v.id AND v.survey_id = p_survey;
    DELETE FROM public.export_jobs j USING public.survey_versions v
        WHERE j.survey_version_id = v.id AND v.survey_id = p_survey;
    DELETE FROM public.distributions d USING public.survey_versions v
        WHERE d.survey_version_id = v.id AND v.survey_id = p_survey;
    DELETE FROM public.responses r USING public.survey_versions v
        WHERE r.survey_version_id = v.id AND v.survey_id = p_survey;
    DELETE FROM public.survey_versions WHERE survey_id = p_survey;
    DELETE FROM public.surveys WHERE id = p_survey;

    INSERT INTO public.survey_disposal_tombstones (survey_id, workspace_id, disposed_at)
        VALUES (p_survey, v_workspace, coalesce(p_replay_at, clock_timestamp()));
    outcome := 'disposed';
    RETURN NEXT;
END
$$;

REVOKE ALL ON FUNCTION disposal_fixture.dispose(text, uuid, uuid, uuid, timestamptz) FROM PUBLIC;
