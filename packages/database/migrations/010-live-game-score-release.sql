ALTER TABLE public.live_game_rules ADD COLUMN scores_released_at timestamptz;

CREATE FUNCTION public.release_live_game_scores(
    p_proof bytea, p_session uuid, p_revision integer, p_game_enabled boolean
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    room public.live_sessions%ROWTYPE;
BEGIN
    IF p_game_enabled IS NOT TRUE THEN RETURN 'forbidden'; END IF;

    SELECT s.* INTO room
    FROM public.live_sessions s
    JOIN public.resolve_session(p_proof) actor ON actor.id = s.host_id
    JOIN public.survey_versions v ON v.id = s.quiz_version_id
    JOIN public.surveys survey ON survey.id = v.survey_id
    JOIN public.workspace_memberships m
        ON m.workspace_id = survey.workspace_id AND m.user_id = actor.id
    WHERE s.id = p_session AND s.mode = 'game_show' AND m.role IN ('owner', 'editor')
      AND public.live_version_is_open(s.quiz_version_id)
    FOR UPDATE OF s FOR SHARE OF m;

    IF NOT FOUND THEN RETURN 'forbidden'; END IF;
    IF room.state <> 'ended' OR room.revision IS DISTINCT FROM p_revision THEN
        RETURN 'conflict';
    END IF;

    UPDATE public.live_game_rules g SET scores_released_at = clock_timestamp()
    WHERE g.session_id = room.id AND g.quiz_version_id = room.quiz_version_id
        AND g.scores_released_at IS NULL;
    IF NOT FOUND THEN RETURN 'conflict'; END IF;

    UPDATE public.live_sessions s SET revision = s.revision + 1 WHERE s.id = room.id;
    RETURN 'accepted';
END
$$;

CREATE FUNCTION public.read_live_game_score(p_session uuid, p_proof bytea, p_game_enabled boolean)
RETURNS TABLE (result text, points integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    guest uuid;
    game_state text;
    released timestamptz;
BEGIN
    IF p_game_enabled IS NOT TRUE THEN result := 'forbidden'; RETURN NEXT; RETURN; END IF;

    SELECT p.id, s.state, g.scores_released_at INTO guest, game_state, released
    FROM public.live_participants p
    JOIN public.live_sessions s ON s.id = p.session_id AND s.mode = 'game_show'
    JOIN public.live_game_rules g ON g.session_id = s.id AND g.quiz_version_id = s.quiz_version_id
    WHERE s.id = p_session AND p.token_hash = p_proof AND p.expires_at > statement_timestamp()
      AND public.live_version_is_open(s.quiz_version_id);
    IF NOT FOUND THEN result := 'forbidden'; RETURN NEXT; RETURN; END IF;

    IF released IS NULL OR game_state NOT IN ('ended', 'archived') THEN
        result := 'unreleased'; RETURN NEXT; RETURN;
    END IF;

    SELECT sum(a.points)::integer INTO points
    FROM public.live_game_attempts a WHERE a.session_id = p_session AND a.participant_id = guest;
    result := CASE WHEN points IS NULL THEN 'missing' ELSE 'released' END;
    RETURN NEXT;
END
$$;

CREATE OR REPLACE FUNCTION public.read_live_room_snapshot(p_session uuid, p_proof bytea, p_host boolean, p_game_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER STRICT
SET search_path = pg_catalog, public
AS $$
DECLARE
    state_snapshot jsonb;
    active_question jsonb;
    deadline timestamptz;
    released boolean;
BEGIN
    state_snapshot := public.read_live_poll_question(p_session, p_proof, p_host);
    IF state_snapshot IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.live_sessions s WHERE s.id = p_session AND public.live_version_is_open(s.quiz_version_id)
    ) THEN
        RETURN NULL;
    END IF;
    IF state_snapshot->>'mode' <> 'game_show' THEN RETURN state_snapshot; END IF;
    IF p_game_enabled IS NOT TRUE THEN RETURN NULL; END IF;
    SELECT g.deadline_at, g.scores_released_at IS NOT NULL INTO deadline, released
    FROM public.live_game_rules g WHERE g.session_id = p_session;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF p_host AND released THEN
        state_snapshot := state_snapshot || jsonb_build_object('scoresReleased', true);
    END IF;
    IF NOT state_snapshot ? 'question' THEN RETURN state_snapshot; END IF;

    active_question := state_snapshot->'question' || jsonb_build_object(
        'closesAt', deadline, 'open', (state_snapshot->'question'->>'open')::boolean AND deadline > statement_timestamp()
    );
    state_snapshot := state_snapshot - ARRAY['results', 'turnout', 'hasVoted'] || jsonb_build_object('question', active_question);
    IF p_host THEN RETURN state_snapshot; END IF;
    RETURN state_snapshot || jsonb_build_object('hasVoted', EXISTS (
        SELECT 1 FROM public.live_game_attempts a
        JOIN public.live_participants p ON p.session_id = a.session_id AND p.id = a.participant_id
        WHERE a.session_id = p_session AND p.token_hash = p_proof AND a.question_id = active_question->>'id'
    ));
END
$$;

REVOKE ALL ON FUNCTION public.release_live_game_scores(bytea, uuid, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.read_live_game_score(uuid, bytea, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_live_game_scores(bytea, uuid, integer, boolean) TO helpinsights_app;
GRANT EXECUTE ON FUNCTION public.read_live_game_score(uuid, bytea, boolean) TO helpinsights_app;
