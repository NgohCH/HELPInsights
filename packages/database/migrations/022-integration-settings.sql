CREATE TABLE public.integration_clients (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
    department text NOT NULL CHECK (length(btrim(department)) BETWEEN 1 AND 160),
    purpose text NOT NULL CHECK (length(btrim(purpose)) BETWEEN 1 AND 500),
    environment text NOT NULL CHECK (environment IN ('development', 'test', 'production')),
    credential_owner text NOT NULL CHECK (length(btrim(credential_owner)) BETWEEN 1 AND 160),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
    operations text[] NOT NULL CHECK (
        operations IN (
            ARRAY['workspace:read'],
            ARRAY['survey:read_status'],
            ARRAY['survey:read_status', 'workspace:read']
        )
    ),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
    credential_hash bytea UNIQUE CHECK (octet_length(credential_hash) = 32),
    credential_expires_at timestamptz NOT NULL,
    credential_version bigint NOT NULL DEFAULT 1 CHECK (credential_version BETWEEN 1 AND 9007199254740991),
    CHECK ((status = 'revoked') = (credential_hash IS NULL))
);

CREATE TABLE public.integration_client_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id uuid NOT NULL,
    client_id uuid NOT NULL REFERENCES public.integration_clients(id),
    action text NOT NULL CHECK (action IN ('register', 'permissions', 'enable', 'renew', 'revoke')),
    workspace_id uuid NOT NULL,
    operations text[] NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX integration_client_audit_client ON public.integration_client_audit(client_id, id);
ALTER TABLE public.integration_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_client_audit ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.integration_admin_allowed(p_proof bytea)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT public.tool_settings_admin(p_proof) IS NOT NULL
$$;

CREATE FUNCTION public.integration_client_metadata(p_client public.integration_clients)
RETURNS jsonb LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT jsonb_build_object(
        'id', p_client.id,
        'name', p_client.name,
        'department', p_client.department,
        'purpose', p_client.purpose,
        'environment', p_client.environment,
        'credentialOwner', p_client.credential_owner,
        'credentialVersion', p_client.credential_version,
        'workspaceId', p_client.workspace_id,
        'operations', p_client.operations,
        'status', p_client.status,
        'expiresAt', to_char(p_client.credential_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
$$;

CREATE FUNCTION public.read_integration_clients(p_proof bytea, p_environment text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT CASE WHEN public.integration_admin_allowed(p_proof) THEN COALESCE((
        SELECT jsonb_agg(public.integration_client_metadata(c) ORDER BY c.name, c.id)
        FROM public.integration_clients c
        WHERE c.environment = p_environment
    ), '[]'::jsonb) END
$$;

CREATE FUNCTION public.change_integration_client(
    p_proof bytea, p_environment text, p_action text, p_client uuid,
    p_workspace uuid, p_operations text[], p_metadata jsonb, p_hash bytea,
    p_expected_credential_version bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    admin_id uuid := public.tool_settings_admin(p_proof);
    current_client public.integration_clients;
BEGIN
    IF admin_id IS NULL THEN RETURN '{"status":"forbidden"}'; END IF;

    IF p_action IN ('register', 'permissions') AND (
        p_operations IS NULL OR p_operations NOT IN (
            ARRAY['workspace:read'],
            ARRAY['survey:read_status'],
            ARRAY['survey:read_status', 'workspace:read']
        )
        OR NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = p_workspace)
    ) THEN
        RETURN '{"status":"invalid"}';
    END IF;

    IF p_action = 'register' THEN
        INSERT INTO public.integration_clients (
            id, name, department, purpose, environment, credential_owner,
            workspace_id, operations, credential_hash, credential_expires_at
        ) VALUES (
            p_client, p_metadata->>'name', p_metadata->>'department', p_metadata->>'purpose',
            p_environment, p_metadata->>'credentialOwner', p_workspace, p_operations, p_hash,
            clock_timestamp() + interval '90 days'
        ) ON CONFLICT (id) DO NOTHING RETURNING * INTO current_client;
        IF NOT FOUND THEN RETURN '{"status":"conflict"}'; END IF;
    ELSE
        SELECT * INTO current_client FROM public.integration_clients
        WHERE id = p_client AND environment = p_environment FOR UPDATE;
        IF NOT FOUND THEN RETURN '{"status":"missing"}'; END IF;

        IF current_client.status = 'revoked' THEN
            IF p_action = 'revoke' THEN
                RETURN jsonb_build_object('status', 'ok', 'client', public.integration_client_metadata(current_client));
            END IF;
            RETURN '{"status":"conflict"}';
        END IF;

        CASE p_action
        WHEN 'permissions' THEN
            IF (current_client.workspace_id, current_client.operations) = (p_workspace, p_operations) THEN
                RETURN jsonb_build_object('status', 'ok', 'client', public.integration_client_metadata(current_client));
            END IF;
            UPDATE public.integration_clients SET workspace_id = p_workspace, operations = p_operations
            WHERE id = p_client RETURNING * INTO current_client;
        WHEN 'enable' THEN
            IF current_client.credential_expires_at <= clock_timestamp() THEN RETURN '{"status":"conflict"}'; END IF;
            IF current_client.status = 'active' THEN
                RETURN jsonb_build_object('status', 'ok', 'client', public.integration_client_metadata(current_client));
            END IF;
            UPDATE public.integration_clients SET status = 'active'
            WHERE id = p_client RETURNING * INTO current_client;
        WHEN 'renew' THEN
            IF current_client.credential_version IS DISTINCT FROM p_expected_credential_version
               OR current_client.credential_version = 9007199254740991 THEN
                RETURN '{"status":"conflict"}';
            END IF;
            UPDATE public.integration_clients
            SET credential_hash = p_hash,
                credential_expires_at = clock_timestamp() + interval '90 days',
                credential_version = credential_version + 1
            WHERE id = p_client RETURNING * INTO current_client;
        WHEN 'revoke' THEN
            UPDATE public.integration_clients SET status = 'revoked', credential_hash = NULL
            WHERE id = p_client RETURNING * INTO current_client;
        ELSE
            RETURN '{"status":"invalid"}';
        END CASE;
    END IF;

    INSERT INTO public.integration_client_audit (actor_id, client_id, action, workspace_id, operations)
    VALUES (admin_id, current_client.id, p_action, current_client.workspace_id, current_client.operations);

    RETURN jsonb_build_object('status', 'ok', 'client', public.integration_client_metadata(current_client));
END
$$;

CREATE FUNCTION public.read_integration_resource(
    p_hash bytea, p_environment text, p_workspace uuid, p_survey uuid
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    WITH authenticated_client AS (
        SELECT workspace_id, operations
        FROM public.integration_clients
        WHERE credential_hash = p_hash AND environment = p_environment
          AND status = 'active' AND credential_expires_at > statement_timestamp()
    ), resource AS (
        SELECT jsonb_build_object('id', w.id, 'name', w.name) AS data
        FROM authenticated_client c
        JOIN public.workspaces w ON w.id = c.workspace_id
        WHERE w.id = p_workspace AND p_survey IS NULL AND 'workspace:read' = ANY(c.operations)
        UNION ALL
        SELECT jsonb_build_object('id', s.id, 'status', s.status)
        FROM authenticated_client c
        JOIN public.surveys s ON s.workspace_id = c.workspace_id
        WHERE s.workspace_id = p_workspace AND s.id = p_survey AND 'survey:read_status' = ANY(c.operations)
    )
    SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM authenticated_client) THEN '{"status":"unauthorised"}'::jsonb
        WHEN NOT EXISTS (SELECT 1 FROM resource) THEN '{"status":"missing"}'::jsonb
        ELSE jsonb_build_object('status', 'ok', 'resource', (SELECT data FROM resource))
    END
$$;

REVOKE ALL ON FUNCTION public.integration_admin_allowed(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.integration_client_metadata(public.integration_clients) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.read_integration_clients(bytea, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_integration_client(bytea, text, text, uuid, uuid, text[], jsonb, bytea, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.read_integration_resource(bytea, text, uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.integration_admin_allowed(bytea) TO helpinsights_app;
GRANT EXECUTE ON FUNCTION public.read_integration_clients(bytea, text) TO helpinsights_app;
GRANT EXECUTE ON FUNCTION public.change_integration_client(bytea, text, text, uuid, uuid, text[], jsonb, bytea, bigint) TO helpinsights_app;
GRANT EXECUTE ON FUNCTION public.read_integration_resource(bytea, text, uuid, uuid) TO helpinsights_app;
