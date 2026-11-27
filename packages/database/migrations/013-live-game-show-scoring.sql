ALTER TABLE public.live_sessions
    DROP CONSTRAINT live_sessions_mode_check,
    ADD CONSTRAINT live_sessions_mode_check CHECK (mode IN ('live_poll', 'game_show'));

CREATE TABLE public.live_game_rules (
    session_id uuid PRIMARY KEY REFERENCES public.live_sessions (id) ON DELETE CASCADE,
    quiz_version_id uuid NOT NULL REFERENCES public.survey_versions (id),
    correct_option_code text NOT NULL,
    duration_seconds integer NOT NULL CHECK (duration_seconds BETWEEN 5 AND 120),
    rule_version text NOT NULL DEFAULT 'accuracy_v1' CHECK (rule_version = 'accuracy_v1'),
    opened_at timestamptz,
    deadline_at timestamptz,
    CHECK (
        (opened_at IS NULL AND deadline_at IS NULL)
        OR (opened_at IS NOT NULL AND deadline_at IS NOT NULL AND opened_at < deadline_at)
    )
);

CREATE TABLE public.live_game_attempts (
    session_id uuid NOT NULL REFERENCES public.live_game_rules (session_id) ON DELETE CASCADE,
    participant_id uuid NOT NULL,
    quiz_version_id uuid NOT NULL REFERENCES public.survey_versions (id),
    question_id text NOT NULL,
    opened_revision integer NOT NULL CHECK (opened_revision > 0),
    option_code text NOT NULL,
    idempotency_key uuid NOT NULL,
    accepted_at timestamptz NOT NULL,
    points integer NOT NULL CHECK (points IN (0, 1000)),
    rule_version text NOT NULL CHECK (rule_version = 'accuracy_v1'),
    PRIMARY KEY (session_id, participant_id, question_id),
    UNIQUE (session_id, participant_id, idempotency_key),
    FOREIGN KEY (session_id, participant_id)
        REFERENCES public.live_participants (session_id, id) ON DELETE CASCADE
);

ALTER TABLE public.live_game_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_game_attempts ENABLE ROW LEVEL SECURITY;

-- The standalone schema stores only the public distribution link. Known
-- Registry eligibility values other than open fail closed.
CREATE FUNCTION public.live_version_is_open(p_version uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.distributions d
        WHERE d.survey_version_id = p_version
          AND (NOT (to_jsonb(d) ? 'eligibility_mode') OR to_jsonb(d)->>'eligibility_mode' = 'open')
    ) THEN
        RETURN false;
    END IF;

    -- Research consent is a separate policy keyed by the frozen version.
    -- The standalone Live branch does not install the research subsystem.
    IF to_regclass('public.research_consent_versions') IS NOT NULL THEN
        RETURN NOT EXISTS (
            SELECT 1 FROM public.research_consent_versions c WHERE c.survey_version_id = p_version
        );
    END IF;
    RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.live_version_is_open(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.live_version_is_open(uuid) TO helpinsights_app;

ALTER POLICY create_hosted_lobbies ON public.live_sessions
    WITH CHECK (
        public.live_version_is_open(quiz_version_id) AND
        host_id = nullif(current_setting('helpinsights.actor_id', true), '')::uuid
        AND EXISTS (
            SELECT 1 FROM public.survey_versions v JOIN public.surveys s ON s.id = v.survey_id
            WHERE v.id = quiz_version_id AND s.status = 'published'
              AND public.workspace_role(s.workspace_id) IN ('owner', 'editor')
        )
    );

CREATE FUNCTION public.configure_live_game(p_session uuid, p_token_hash bytea, p_correct text, p_seconds integer)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    WITH configured AS (
        INSERT INTO public.live_game_rules (session_id, quiz_version_id, correct_option_code, duration_seconds)
        SELECT s.id, s.quiz_version_id, p_correct, p_seconds
        FROM public.live_sessions s
        JOIN public.resolve_session(p_token_hash) actor ON actor.id = s.host_id
        JOIN public.survey_versions v ON v.id = s.quiz_version_id
        JOIN public.surveys survey ON survey.id = v.survey_id
        JOIN public.workspace_memberships m ON m.workspace_id = survey.workspace_id AND m.user_id = actor.id
        WHERE s.id = p_session AND s.mode = 'game_show' AND s.state = 'lobby'
          AND m.role IN ('owner', 'editor') AND public.live_version_is_open(s.quiz_version_id)
          AND (SELECT count(*) FROM public.live_poll_questions(s.quiz_version_id)) = 1
          AND EXISTS (
            SELECT 1 FROM public.live_poll_questions(s.quiz_version_id) item
            CROSS JOIN LATERAL jsonb_array_elements(item.question->'options') AS opt(document)
            WHERE opt.document->>'code' = p_correct
          )
        ON CONFLICT DO NOTHING RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM configured)
$$;

CREATE FUNCTION public.join_live_room(p_pin_hash bytea, p_token_hash bytea, p_game_enabled boolean)
RETURNS TABLE (id uuid, mode text, state text, revision integer)
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    WITH eligible_room AS MATERIALIZED (
        SELECT s.id FROM public.live_sessions s
        WHERE s.pin_hash = p_pin_hash AND s.pin_expires_at > now() AND s.state = 'lobby'
          AND public.live_version_is_open(s.quiz_version_id)
          AND (s.mode <> 'game_show' OR (p_game_enabled IS TRUE AND EXISTS (SELECT 1 FROM public.live_game_rules g WHERE g.session_id = s.id)))
        FOR SHARE OF s
    ), admitted AS (
        INSERT INTO public.live_participants (session_id, token_hash)
        SELECT eligible_room.id, p_token_hash FROM eligible_room RETURNING session_id
    )
    SELECT s.id, s.mode, s.state, s.revision FROM public.live_sessions s
    JOIN admitted a ON a.session_id = s.id
$$;

CREATE FUNCTION public.command_live_room(p_proof bytea, p_session uuid, p_revision integer, p_command text, p_game_enabled boolean)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    outcome text;
    opening timestamptz;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.live_sessions s
        WHERE s.id = p_session AND public.live_version_is_open(s.quiz_version_id)
          AND (s.mode <> 'game_show' OR (p_game_enabled IS TRUE AND EXISTS (SELECT 1 FROM public.live_game_rules g WHERE g.session_id = s.id)))
    ) THEN
        RETURN 'forbidden';
    END IF;
    SELECT step.result INTO outcome FROM public.command_live_session(p_proof, p_session, p_revision, p_command) step;
    IF outcome = 'accepted' AND p_command = 'next_question' THEN
        opening := clock_timestamp();
        UPDATE public.live_game_rules
        SET opened_at = opening, deadline_at = opening + make_interval(secs => duration_seconds)
        WHERE session_id = p_session AND opened_at IS NULL;
    END IF;
    RETURN outcome;
END
$$;

CREATE FUNCTION public.read_live_room_snapshot(p_session uuid, p_proof bytea, p_host boolean, p_game_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER STRICT
SET search_path = pg_catalog, public
AS $$
DECLARE
    state_snapshot jsonb;
    active_question jsonb;
    deadline timestamptz;
BEGIN
    state_snapshot := public.read_live_poll_question(p_session, p_proof, p_host);
    IF state_snapshot IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.live_sessions s WHERE s.id = p_session AND public.live_version_is_open(s.quiz_version_id)
    ) THEN
        RETURN NULL;
    END IF;
    IF state_snapshot->>'mode' <> 'game_show' THEN RETURN state_snapshot; END IF;
    IF p_game_enabled IS NOT TRUE THEN RETURN NULL; END IF;
    SELECT g.deadline_at INTO deadline FROM public.live_game_rules g WHERE g.session_id = p_session;
    IF NOT FOUND THEN RETURN NULL; END IF;
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

CREATE FUNCTION public.submit_live_game_answer(
    p_session uuid, p_proof bytea, p_question text, p_revision integer, p_option text, p_key uuid
)
RETURNS TABLE (result text, "questionId" text, "acceptedAt" timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    guest uuid;
    room public.live_sessions%ROWTYPE;
    scoring public.live_game_rules%ROWTYPE;
    item jsonb;
    recorded public.live_game_attempts%ROWTYPE;
    accepted timestamptz;
BEGIN
    SELECT p.id INTO guest FROM public.live_participants p
    WHERE p.session_id = p_session AND p.token_hash = p_proof AND p.expires_at > clock_timestamp();
    IF NOT FOUND THEN result := 'forbidden'; RETURN NEXT; RETURN; END IF;

    SELECT s.* INTO room FROM public.live_sessions s WHERE s.id = p_session AND s.mode = 'game_show' FOR SHARE OF s;
    IF NOT FOUND THEN result := 'forbidden'; RETURN NEXT; RETURN; END IF;
    PERFORM 1 FROM public.live_participants p WHERE p.session_id = p_session AND p.id = guest
        AND p.token_hash = p_proof AND p.expires_at > clock_timestamp() FOR SHARE OF p;
    IF NOT FOUND THEN result := 'forbidden'; RETURN NEXT; RETURN; END IF;

    SELECT g.* INTO scoring FROM public.live_game_rules g WHERE g.session_id = p_session AND g.quiz_version_id = room.quiz_version_id;
    IF NOT FOUND THEN result := 'forbidden'; RETURN NEXT; RETURN; END IF;

    SELECT a.* INTO recorded FROM public.live_game_attempts a
    WHERE a.session_id = p_session AND a.participant_id = guest AND a.idempotency_key = p_key;
    IF NOT FOUND THEN
        accepted := clock_timestamp();
        IF room.state <> 'running' OR room.question_closed OR scoring.deadline_at IS NULL
            OR accepted >= scoring.deadline_at OR room.question_revision IS DISTINCT FROM p_revision THEN
            result := 'conflict'; RETURN NEXT; RETURN;
        END IF;
        SELECT q.question INTO item FROM public.live_poll_questions(room.quiz_version_id) q
        WHERE q.question_index = room.question_position;
        IF item->>'id' IS DISTINCT FROM p_question THEN result := 'conflict'; RETURN NEXT; RETURN; END IF;
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(item->'options') AS opt(document) WHERE opt.document->>'code' = p_option) THEN
            result := 'invalid'; RETURN NEXT; RETURN;
        END IF;

        INSERT INTO public.live_game_attempts AS a
            (session_id, participant_id, quiz_version_id, question_id, opened_revision,
             option_code, idempotency_key, accepted_at, points, rule_version)
        VALUES (p_session, guest, room.quiz_version_id, p_question, p_revision, p_option, p_key, accepted,
                CASE WHEN p_option = scoring.correct_option_code THEN 1000 ELSE 0 END, scoring.rule_version)
        ON CONFLICT DO NOTHING RETURNING a.* INTO recorded;
        IF FOUND THEN RETURN QUERY SELECT 'accepted'::text, recorded.question_id, recorded.accepted_at; RETURN; END IF;
        SELECT a.* INTO recorded FROM public.live_game_attempts a
        WHERE a.session_id = p_session AND a.participant_id = guest AND a.idempotency_key = p_key;
    END IF;
    IF recorded.idempotency_key IS NOT NULL
        AND recorded.question_id IS NOT DISTINCT FROM p_question
        AND recorded.opened_revision IS NOT DISTINCT FROM p_revision
        AND recorded.option_code IS NOT DISTINCT FROM p_option THEN
        RETURN QUERY SELECT 'replayed'::text, recorded.question_id, recorded.accepted_at;
        RETURN;
    END IF;
    result := 'conflict';
    RETURN NEXT;
END
$$;

CREATE FUNCTION public.submit_live_room_answer(
    p_session uuid, p_proof bytea, p_question text, p_revision integer, p_option text, p_key uuid, p_game_enabled boolean
)
RETURNS TABLE (result text, "questionId" text, "acceptedAt" timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    room_mode text;
BEGIN
    SELECT s.mode INTO room_mode FROM public.live_sessions s
    WHERE s.id = p_session AND public.live_version_is_open(s.quiz_version_id);
    IF NOT FOUND THEN result := 'forbidden'; RETURN NEXT; RETURN; END IF;
    IF room_mode = 'game_show' THEN
        IF p_game_enabled IS NOT TRUE THEN result := 'forbidden'; RETURN NEXT; RETURN; END IF;
        RETURN QUERY SELECT * FROM public.submit_live_game_answer(p_session, p_proof, p_question, p_revision, p_option, p_key);
    ELSE
        RETURN QUERY SELECT * FROM public.submit_live_poll_vote(p_session, p_proof, p_question, p_revision, p_option, p_key);
    END IF;
END
$$;

REVOKE EXECUTE ON FUNCTION public.command_live_session(bytea, uuid, integer, text) FROM helpinsights_app;
REVOKE EXECUTE ON FUNCTION public.read_live_poll_question(uuid, bytea, boolean) FROM helpinsights_app;
REVOKE EXECUTE ON FUNCTION public.submit_live_poll_vote(uuid, bytea, text, integer, text, uuid) FROM helpinsights_app;
REVOKE ALL ON FUNCTION public.configure_live_game(uuid, bytea, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.command_live_room(bytea, uuid, integer, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.read_live_room_snapshot(uuid, bytea, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_live_room_answer(uuid, bytea, text, integer, text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_live_game_answer(uuid, bytea, text, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.configure_live_game(uuid, bytea, text, integer) TO helpinsights_app;
GRANT EXECUTE ON FUNCTION public.command_live_room(bytea, uuid, integer, text, boolean) TO helpinsights_app;
GRANT EXECUTE ON FUNCTION public.read_live_room_snapshot(uuid, bytea, boolean, boolean) TO helpinsights_app;
GRANT EXECUTE ON FUNCTION public.submit_live_room_answer(uuid, bytea, text, integer, text, uuid, boolean) TO helpinsights_app;
REVOKE EXECUTE ON FUNCTION public.join_live_lobby(bytea, bytea) FROM helpinsights_app;
REVOKE ALL ON FUNCTION public.join_live_room(bytea, bytea, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_live_room(bytea, bytea, boolean) TO helpinsights_app;
