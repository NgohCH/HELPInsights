CREATE TABLE public.live_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_version_id uuid NOT NULL REFERENCES public.survey_versions (id),
    host_id uuid NOT NULL REFERENCES public.users (id),
    mode text NOT NULL CHECK (mode = 'live_poll'),
    state text NOT NULL DEFAULT 'lobby' CHECK (state = 'lobby'),
    revision integer NOT NULL DEFAULT 1 CHECK (revision = 1),
    pin_hash bytea NOT NULL UNIQUE CHECK (octet_length(pin_hash) = 32),
    pin_expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes'
);

CREATE TABLE public.live_participants (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    session_id uuid NOT NULL REFERENCES public.live_sessions (id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL DEFAULT now() + interval '8 hours'
);

CREATE TABLE public.live_join_budget (
    singleton boolean PRIMARY KEY CHECK (singleton),
    started_at timestamptz NOT NULL,
    attempts integer NOT NULL CHECK (attempts > 0)
);

ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_join_budget ENABLE ROW LEVEL SECURITY;

CREATE POLICY read_hosted_lobbies ON public.live_sessions FOR SELECT TO helpinsights_app
    USING (
        host_id = nullif(current_setting('helpinsights.actor_id', true), '')::uuid
        AND EXISTS (
            SELECT 1 FROM public.survey_versions v JOIN public.surveys s ON s.id = v.survey_id
            WHERE v.id = quiz_version_id AND public.workspace_role(s.workspace_id) IN ('owner', 'editor')
        )
    );

CREATE POLICY create_hosted_lobbies ON public.live_sessions FOR INSERT TO helpinsights_app
    WITH CHECK (
        host_id = nullif(current_setting('helpinsights.actor_id', true), '')::uuid
        AND EXISTS (
            SELECT 1 FROM public.survey_versions v JOIN public.surveys s ON s.id = v.survey_id
            WHERE v.id = quiz_version_id AND s.status = 'published'
            AND public.workspace_role(s.workspace_id) IN ('owner', 'editor')
        )
    );

CREATE FUNCTION public.consume_live_join_budget()
RETURNS boolean LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    WITH current_attempt AS (
        INSERT INTO public.live_join_budget AS budget VALUES (true, statement_timestamp(), 1)
        ON CONFLICT (singleton) DO UPDATE SET
            started_at = CASE WHEN budget.started_at <= statement_timestamp() - interval '1 minute'
                THEN statement_timestamp() ELSE budget.started_at END,
            attempts = CASE WHEN budget.started_at <= statement_timestamp() - interval '1 minute'
                THEN 1 ELSE budget.attempts + 1 END
        WHERE budget.attempts < 120 OR budget.started_at <= statement_timestamp() - interval '1 minute'
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM current_attempt)
$$;

CREATE FUNCTION public.join_live_lobby(p_pin_hash bytea, p_token_hash bytea)
RETURNS TABLE (id uuid, mode text, state text, revision integer)
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    WITH admitted AS (
        INSERT INTO public.live_participants (session_id, token_hash)
        SELECT s.id, p_token_hash FROM public.live_sessions s
        WHERE s.pin_hash = p_pin_hash AND s.pin_expires_at > now() AND s.state = 'lobby'
        RETURNING session_id
    )
    SELECT s.id, s.mode, s.state, s.revision FROM public.live_sessions s
    JOIN admitted a ON a.session_id = s.id
$$;

CREATE FUNCTION public.read_participant_lobby(p_session uuid, p_token_hash bytea)
RETURNS TABLE (id uuid, mode text, state text, revision integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT s.id, s.mode, s.state, s.revision FROM public.live_sessions s
    JOIN public.live_participants p ON p.session_id = s.id
    WHERE s.id = p_session AND p.token_hash = p_token_hash AND p.expires_at > now()
$$;

REVOKE ALL ON FUNCTION public.consume_live_join_budget() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_live_lobby(bytea, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.read_participant_lobby(uuid, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_live_join_budget() TO helpinsights_app;
GRANT EXECUTE ON FUNCTION public.join_live_lobby(bytea, bytea) TO helpinsights_app;
GRANT EXECUTE ON FUNCTION public.read_participant_lobby(uuid, bytea) TO helpinsights_app;
GRANT SELECT (id, quiz_version_id, mode, state, revision, pin_expires_at)
    ON public.live_sessions TO helpinsights_app;
GRANT INSERT (quiz_version_id, host_id, mode, pin_hash)
    ON public.live_sessions TO helpinsights_app;
