ALTER TABLE public.live_sessions
    DROP CONSTRAINT live_sessions_state_check,
    DROP CONSTRAINT live_sessions_revision_check,
    ADD CONSTRAINT live_sessions_state_check
        CHECK (state IN ('lobby', 'running', 'paused', 'ended', 'archived')),
    ADD CONSTRAINT live_sessions_revision_check CHECK (revision >= 1);

CREATE FUNCTION public.command_live_session(
    p_token_hash bytea,
    p_session uuid,
    p_expected_revision integer,
    p_command text
)
RETURNS TABLE (
    result text, id uuid, mode text, state text, revision integer, "quizVersionId" uuid
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    actor_id uuid;
    room public.live_sessions%ROWTYPE;
    next_state text;
BEGIN
    SELECT a.id INTO actor_id FROM public.resolve_session(p_token_hash) a;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'unauthorised'::text, NULL::uuid, NULL::text, NULL::text, NULL::integer, NULL::uuid;
        RETURN;
    END IF;

    SELECT s.* INTO room
    FROM public.live_sessions s
    JOIN public.survey_versions v ON v.id = s.quiz_version_id
    JOIN public.surveys survey ON survey.id = v.survey_id
    JOIN public.workspace_memberships m ON m.workspace_id = survey.workspace_id AND m.user_id = actor_id
    WHERE s.id = p_session AND s.host_id = actor_id AND m.role IN ('owner', 'editor')
    FOR UPDATE OF s FOR SHARE OF m;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'forbidden'::text, NULL::uuid, NULL::text, NULL::text, NULL::integer, NULL::uuid;
        RETURN;
    END IF;

    next_state := CASE
        WHEN p_command = 'start' AND room.state = 'lobby' THEN 'running'
        WHEN p_command = 'pause' AND room.state = 'running' THEN 'paused'
        WHEN p_command = 'resume' AND room.state = 'paused' THEN 'running'
        WHEN p_command = 'end' AND room.state IN ('lobby', 'running', 'paused') THEN 'ended'
        WHEN p_command = 'archive' AND room.state = 'ended' THEN 'archived'
    END;

    IF room.revision IS DISTINCT FROM p_expected_revision OR next_state IS NULL THEN
        RETURN QUERY SELECT 'conflict'::text, NULL::uuid, NULL::text, NULL::text, NULL::integer, NULL::uuid;
        RETURN;
    END IF;

    RETURN QUERY
    UPDATE public.live_sessions stored
    SET state = next_state, revision = stored.revision + 1
    WHERE stored.id = room.id
    RETURNING 'accepted'::text, stored.id, stored.mode, stored.state, stored.revision, stored.quiz_version_id;
END
$$;

REVOKE ALL ON FUNCTION public.command_live_session(bytea, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.command_live_session(bytea, uuid, integer, text) TO helpinsights_app;

CREATE OR REPLACE FUNCTION public.join_live_lobby(p_pin_hash bytea, p_token_hash bytea)
RETURNS TABLE (id uuid, mode text, state text, revision integer)
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    WITH eligible_room AS MATERIALIZED (
        SELECT s.id
        FROM public.live_sessions s
        WHERE s.pin_hash = p_pin_hash AND s.pin_expires_at > now() AND s.state = 'lobby'
        FOR SHARE OF s
    ), admitted AS (
        INSERT INTO public.live_participants (session_id, token_hash)
        SELECT eligible_room.id, p_token_hash FROM eligible_room
        RETURNING session_id
    )
    SELECT s.id, s.mode, s.state, s.revision FROM public.live_sessions s
    JOIN admitted a ON a.session_id = s.id
$$;
