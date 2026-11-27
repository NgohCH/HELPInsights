DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helpinsights_app') THEN
        CREATE ROLE helpinsights_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
END
$$;

CREATE TABLE public.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 160)
);

CREATE TABLE public.workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id uuid NOT NULL REFERENCES public.organisations (id),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160)
);

CREATE TABLE public.workspace_memberships (
    workspace_id uuid NOT NULL REFERENCES public.workspaces (id),
    user_id uuid NOT NULL REFERENCES public.users (id),
    role text NOT NULL CHECK (role IN ('owner', 'editor', 'analyst', 'viewer')),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX workspace_memberships_actor ON public.workspace_memberships (user_id, workspace_id);

CREATE TABLE public.sessions (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    user_id uuid NOT NULL REFERENCES public.users (id),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
);

CREATE FUNCTION public.resolve_session(p_token_hash bytea)
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
$$;

ALTER TABLE public.workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY own_memberships ON public.workspace_memberships
    FOR SELECT TO helpinsights_app
    USING (user_id = nullif(current_setting('helpinsights.actor_id', true), '')::uuid);

CREATE POLICY member_workspaces ON public.workspaces
    FOR SELECT TO helpinsights_app
    USING (
        EXISTS (SELECT 1 FROM public.workspace_memberships WHERE workspace_id = workspaces.id)
    );

REVOKE ALL ON FUNCTION public.resolve_session(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_session(bytea) TO helpinsights_app;
GRANT SELECT (name, checksum) ON public.schema_migrations TO helpinsights_app;
GRANT SELECT ON public.workspaces, public.workspace_memberships TO helpinsights_app;
