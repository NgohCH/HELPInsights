DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helpinsights_identity') THEN
        CREATE ROLE helpinsights_identity NOLOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
END
$$;

ALTER TABLE public.sessions ADD COLUMN institutional_issuer text COLLATE "C";
ALTER TABLE public.sessions ADD COLUMN institutional_subject text COLLATE "C";
ALTER TABLE public.sessions ADD CONSTRAINT session_institutional_identity_pair
    CHECK ((institutional_issuer IS NULL) = (institutional_subject IS NULL));
ALTER TABLE public.sessions ADD CONSTRAINT session_institutional_binding
    FOREIGN KEY (institutional_issuer, institutional_subject)
    REFERENCES public.institutional_principal_bindings (issuer, subject) ON DELETE CASCADE;
CREATE INDEX sessions_institutional_binding ON public.sessions (institutional_issuer, institutional_subject)
    WHERE institutional_issuer IS NOT NULL;

CREATE OR REPLACE FUNCTION public.resolve_session(p_token_hash bytea)
RETURNS TABLE (id uuid, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT users.id, users.display_name
    FROM public.sessions
    JOIN public.users ON users.id = sessions.user_id
    WHERE sessions.token_hash = p_token_hash
      AND sessions.revoked_at IS NULL
      AND sessions.expires_at > now()
      AND (sessions.institutional_issuer IS NULL OR EXISTS (
          SELECT 1 FROM public.institutional_principal_bindings AS binding
          WHERE binding.issuer = sessions.institutional_issuer
            AND binding.subject = sessions.institutional_subject
            AND binding.user_id = users.id
      ))
$$;

CREATE FUNCTION public.issue_university_session(p_issuer text, p_subject text, p_token_hash bytea)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    WITH created AS (
        INSERT INTO public.sessions (token_hash, user_id, expires_at, institutional_issuer, institutional_subject)
        SELECT p_token_hash, binding.user_id, now() + interval '30 minutes', binding.issuer, binding.subject
        FROM public.institutional_principal_bindings AS binding
        WHERE binding.issuer = p_issuer AND binding.subject = p_subject
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM created)
$$;

CREATE FUNCTION public.revoke_university_session(p_token_hash bytea)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    UPDATE public.sessions SET revoked_at = now()
    WHERE token_hash = p_token_hash AND institutional_issuer IS NOT NULL AND revoked_at IS NULL
$$;

REVOKE ALL ON FUNCTION public.issue_university_session(text, text, bytea) FROM PUBLIC, helpinsights_app;
REVOKE ALL ON FUNCTION public.revoke_university_session(bytea) FROM PUBLIC, helpinsights_app;
GRANT EXECUTE ON FUNCTION public.issue_university_session(text, text, bytea) TO helpinsights_identity;
GRANT EXECUTE ON FUNCTION public.revoke_university_session(bytea) TO helpinsights_identity;
