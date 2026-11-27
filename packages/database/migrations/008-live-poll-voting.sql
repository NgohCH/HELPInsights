ALTER TABLE public.live_sessions
    ADD COLUMN question_position integer NOT NULL DEFAULT 0 CHECK (question_position >= 0),
    ADD COLUMN question_revision integer,
    ADD COLUMN question_closed boolean NOT NULL DEFAULT false,
    ADD CHECK (
        (question_position = 0 AND question_revision IS NULL AND NOT question_closed)
        OR (question_position > 0 AND question_revision IS NOT NULL AND question_revision BETWEEN 1 AND revision)
    );

ALTER TABLE public.live_participants
    ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
    ADD UNIQUE (session_id, id);

CREATE TABLE public.live_poll_votes (
    session_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    question_id text NOT NULL,
    question_revision integer NOT NULL CHECK (question_revision > 0),
    option_code text NOT NULL,
    idempotency_key uuid NOT NULL,
    accepted_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    PRIMARY KEY (session_id, participant_id, question_id),
    UNIQUE (session_id, participant_id, idempotency_key),
    FOREIGN KEY (session_id, participant_id)
        REFERENCES public.live_participants (session_id, id) ON DELETE CASCADE
);

CREATE INDEX live_poll_votes_question ON public.live_poll_votes (session_id, question_id, option_code);
ALTER TABLE public.live_poll_votes ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.live_poll_questions(p_version uuid)
RETURNS TABLE (question_index integer, question jsonb)
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT row_number() OVER (ORDER BY page.ordering, item.ordering)::integer, item.question
    FROM public.survey_versions v
    CROSS JOIN LATERAL jsonb_array_elements(v.definition->'pages') WITH ORDINALITY AS page(document, ordering)
    CROSS JOIN LATERAL jsonb_array_elements(page.document->'questions') WITH ORDINALITY AS item(question, ordering)
    WHERE v.id = p_version AND item.question->>'type' = 'single_choice'
$$;
REVOKE ALL ON FUNCTION public.live_poll_questions(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.command_live_session(
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
    next_position integer;
BEGIN
    SELECT a.id INTO actor_id FROM public.resolve_session(p_token_hash) a;
    IF NOT FOUND THEN
        result := 'unauthorised';
        RETURN NEXT;
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
        result := 'forbidden';
        RETURN NEXT;
        RETURN;
    END IF;

    next_position := room.question_position;
    next_state := CASE
        WHEN p_command = 'start' AND room.state = 'lobby' THEN 'running'
        WHEN p_command = 'pause' AND room.state = 'running' THEN 'paused'
        WHEN p_command = 'resume' AND room.state = 'paused' THEN 'running'
        WHEN p_command = 'end' AND room.state IN ('lobby', 'running', 'paused') THEN 'ended'
        WHEN p_command = 'archive' AND room.state = 'ended' THEN 'archived'
        WHEN p_command = 'next_question' AND room.state = 'running' THEN 'running'
        WHEN p_command = 'close_question' AND room.state = 'running'
            AND room.question_position > 0 AND NOT room.question_closed THEN 'running'
    END;
    IF p_command = 'next_question' THEN
        SELECT q.question_index INTO next_position FROM public.live_poll_questions(room.quiz_version_id) q
        WHERE q.question_index = room.question_position + 1;
    END IF;

    IF room.revision IS DISTINCT FROM p_expected_revision OR next_state IS NULL OR next_position IS NULL THEN
        result := 'conflict';
        RETURN NEXT;
        RETURN;
    END IF;

    RETURN QUERY
    UPDATE public.live_sessions stored
    SET state = next_state, revision = stored.revision + 1, question_position = next_position,
        question_revision = CASE
            WHEN p_command = 'next_question' OR
                (p_command = 'resume' AND next_position > 0 AND NOT stored.question_closed) THEN stored.revision + 1
            ELSE stored.question_revision
        END,
        question_closed = CASE
            WHEN p_command = 'close_question' THEN true
            WHEN p_command = 'next_question' THEN false
            ELSE stored.question_closed
        END
    WHERE stored.id = room.id
    RETURNING 'accepted'::text, stored.id, stored.mode, stored.state, stored.revision, stored.quiz_version_id;
END
$$;

CREATE FUNCTION public.read_live_poll_question(p_session uuid, p_token_hash bytea, p_host boolean)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER STRICT
SET search_path = pg_catalog, public
AS $$
DECLARE
    room public.live_sessions%ROWTYPE;
    guest_id uuid;
    active jsonb;
    extra jsonb;
    votes integer;
    admitted integer;
    smallest_cell integer;
    counts jsonb;
BEGIN
    IF p_host THEN
        SELECT s.* INTO room FROM public.live_sessions s
        JOIN public.survey_versions v ON v.id = s.quiz_version_id
        JOIN public.surveys survey ON survey.id = v.survey_id
        JOIN public.resolve_session(p_token_hash) actor ON actor.id = s.host_id
        JOIN public.workspace_memberships m ON m.workspace_id = survey.workspace_id AND m.user_id = actor.id
        WHERE s.id = p_session AND m.role IN ('owner', 'editor');
    ELSE
        SELECT p.id INTO guest_id FROM public.live_participants p
        WHERE p.session_id = p_session AND p.token_hash = p_token_hash AND p.expires_at > statement_timestamp();
        IF NOT FOUND THEN RETURN NULL; END IF;

        SELECT s.* INTO room FROM public.live_sessions s WHERE s.id = p_session;
    END IF;
    IF NOT FOUND THEN RETURN NULL; END IF;

    extra := jsonb_build_object('id', room.id, 'mode', room.mode, 'state', room.state, 'revision', room.revision);
    IF p_host THEN
        extra := extra || jsonb_build_object('quizVersionId', room.quiz_version_id);
    END IF;
    IF room.question_position = 0 THEN RETURN extra; END IF;

    SELECT q.question INTO active FROM public.live_poll_questions(room.quiz_version_id) q
    WHERE q.question_index = room.question_position;
    IF active IS NULL THEN RETURN NULL; END IF;

    extra := extra || jsonb_build_object(
        'question', jsonb_build_object(
            'id', active->>'id', 'title', active->>'title', 'options', active->'options',
            'openedRevision', room.question_revision,
            'open', room.state = 'running' AND NOT room.question_closed
        )
    );
    IF NOT p_host THEN
        RETURN extra || jsonb_build_object('hasVoted', EXISTS (
            SELECT 1 FROM public.live_poll_votes v
            WHERE v.session_id = p_session AND v.participant_id = guest_id AND v.question_id = active->>'id'
        ));
    END IF;

    WITH tally AS (
        SELECT v.option_code, count(*)::integer AS amount
        FROM public.live_poll_votes v
        WHERE v.session_id = p_session AND v.question_id = active->>'id' GROUP BY v.option_code
    )
    SELECT coalesce(sum(tally.amount), 0)::integer, min(tally.amount),
           jsonb_agg(jsonb_build_object('code', choice.option->>'code', 'count', coalesce(tally.amount, 0)) ORDER BY choice.ordering)
    INTO votes, smallest_cell, counts
    FROM jsonb_array_elements(active->'options') WITH ORDINALITY AS choice(option, ordering)
    LEFT JOIN tally ON tally.option_code = choice.option->>'code';

    SELECT count(*)::integer INTO admitted FROM public.live_participants p WHERE p.session_id = p_session;
    -- Keep exact distributions sealed until casting has permanently closed.
    RETURN extra || jsonb_build_object(
        'turnout', CASE WHEN votes >= 5 THEN (votes / 5) * 5 ELSE NULL END,
        'hasNextQuestion', EXISTS (
            SELECT 1 FROM public.live_poll_questions(room.quiz_version_id) q WHERE q.question_index = room.question_position + 1
        ),
        'results', CASE WHEN
            (room.question_closed OR room.state IN ('ended', 'archived'))
            AND votes >= 5 AND smallest_cell >= 5 AND (admitted = votes OR admitted - votes >= 5)
            THEN jsonb_build_object('total', votes, 'counts', counts)
            ELSE NULL
        END
    );
END
$$;

CREATE FUNCTION public.submit_live_poll_vote(
    p_session uuid, p_token_hash bytea, p_question text, p_question_revision integer,
    p_option text, p_key uuid
)
RETURNS TABLE (result text, "questionId" text, "acceptedAt" timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    guest_id uuid;
    room public.live_sessions%ROWTYPE;
    active jsonb;
    recorded public.live_poll_votes%ROWTYPE;
BEGIN
    SELECT p.id INTO guest_id FROM public.live_participants p
    WHERE p.session_id = p_session AND p.token_hash = p_token_hash AND p.expires_at > clock_timestamp();
    IF NOT FOUND THEN
        result := 'forbidden';
        RETURN NEXT;
        RETURN;
    END IF;

    -- Match admission and room-to-guest cascade lock order.
    SELECT * INTO room FROM public.live_sessions s WHERE s.id = p_session FOR SHARE OF s;
    IF NOT FOUND THEN
        result := 'forbidden';
        RETURN NEXT;
        RETURN;
    END IF;
    PERFORM 1 FROM public.live_participants p
    WHERE p.session_id = p_session AND p.id = guest_id AND p.token_hash = p_token_hash
        AND p.expires_at > clock_timestamp()
    FOR SHARE OF p;
    IF NOT FOUND THEN
        result := 'forbidden';
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT v.* INTO recorded FROM public.live_poll_votes v
    WHERE v.session_id = p_session AND v.participant_id = guest_id AND v.idempotency_key = p_key;
    IF NOT FOUND THEN
        IF room.state <> 'running' OR room.question_closed
            OR room.question_revision IS DISTINCT FROM p_question_revision THEN
            result := 'conflict';
            RETURN NEXT;
            RETURN;
        END IF;
        SELECT q.question INTO active FROM public.live_poll_questions(room.quiz_version_id) q
        WHERE q.question_index = room.question_position;

        IF active->>'id' IS DISTINCT FROM p_question THEN
            result := 'conflict';
            RETURN NEXT;
            RETURN;
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(active->'options') AS item(option)
            WHERE item.option->>'code' = p_option
        ) THEN
            result := 'invalid';
            RETURN NEXT;
            RETURN;
        END IF;

        INSERT INTO public.live_poll_votes AS v
            (session_id, participant_id, question_id, question_revision, option_code, idempotency_key)
        VALUES (p_session, guest_id, p_question, p_question_revision, p_option, p_key)
        ON CONFLICT DO NOTHING RETURNING v.* INTO recorded;

        IF FOUND THEN
            RETURN QUERY SELECT 'accepted'::text, recorded.question_id, recorded.accepted_at;
            RETURN;
        END IF;
        SELECT v.* INTO recorded FROM public.live_poll_votes v
        WHERE v.session_id = p_session AND v.participant_id = guest_id AND v.idempotency_key = p_key;
    END IF;

    IF recorded.question_id IS NOT DISTINCT FROM p_question
        AND recorded.question_revision IS NOT DISTINCT FROM p_question_revision
        AND recorded.option_code IS NOT DISTINCT FROM p_option AND recorded.idempotency_key IS NOT NULL THEN
        RETURN QUERY SELECT 'replayed'::text, recorded.question_id, recorded.accepted_at;
        RETURN;
    END IF;
    result := 'conflict';
    RETURN NEXT;
END
$$;

REVOKE ALL ON FUNCTION public.read_live_poll_question(uuid, bytea, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_live_poll_vote(uuid, bytea, text, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_live_poll_question(uuid, bytea, boolean) TO helpinsights_app;
GRANT EXECUTE ON FUNCTION public.submit_live_poll_vote(uuid, bytea, text, integer, text, uuid) TO helpinsights_app;
