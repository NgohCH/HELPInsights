CREATE TABLE public.system_administrators (
    user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE TABLE public.approved_identity_groups (
    id uuid PRIMARY KEY,
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160)
);

CREATE TABLE public.approved_identity_group_members (
    group_id uuid NOT NULL REFERENCES public.approved_identity_groups(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, user_id)
);
CREATE INDEX approved_group_members_user ON public.approved_identity_group_members(user_id);

CREATE TABLE public.creator_tool_settings (
    tool text PRIMARY KEY CHECK (tool = 'template-copy'),
    mode text NOT NULL CHECK (mode IN ('off', 'all', 'university', 'approved'))
);
INSERT INTO public.creator_tool_settings VALUES ('template-copy', 'all');

CREATE TABLE public.creator_tool_grants (
    tool text NOT NULL REFERENCES public.creator_tool_settings(tool),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    subject_type text NOT NULL CHECK (subject_type IN ('user', 'group')),
    subject_id uuid NOT NULL,
    approved_user_id uuid GENERATED ALWAYS AS (CASE WHEN subject_type = 'user' THEN subject_id END) STORED
        REFERENCES public.users(id) ON DELETE CASCADE,
    approved_group_id uuid GENERATED ALWAYS AS (CASE WHEN subject_type = 'group' THEN subject_id END) STORED
        REFERENCES public.approved_identity_groups(id) ON DELETE CASCADE,
    PRIMARY KEY (tool, workspace_id, subject_type, subject_id)
);

CREATE INDEX creator_tool_grants_user ON public.creator_tool_grants(approved_user_id)
    WHERE approved_user_id IS NOT NULL;
CREATE INDEX creator_tool_grants_group ON public.creator_tool_grants(approved_group_id)
    WHERE approved_group_id IS NOT NULL;

CREATE TABLE public.creator_tool_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid NOT NULL,
    tool text NOT NULL REFERENCES public.creator_tool_settings(tool),
    action text NOT NULL CHECK (action IN ('mode', 'grant', 'revoke')),
    mode text,
    workspace_id uuid,
    subject_type text,
    subject_id uuid,
    recorded_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

ALTER TABLE public.system_administrators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approved_identity_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approved_identity_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_tool_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_tool_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_tool_audit ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.tool_settings_admin(p_proof bytea)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT a.id FROM public.resolve_session(p_proof) a
    JOIN public.system_administrators admin ON admin.user_id = a.id
    JOIN public.sessions s ON s.token_hash = p_proof AND s.institutional_issuer IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.tool_settings_admin(bytea) FROM PUBLIC;

CREATE FUNCTION public.read_template_copy_settings(p_proof bytea)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT jsonb_build_object('mode', settings.mode, 'grants', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('workspaceId', g.workspace_id, 'subjectType', g.subject_type, 'subjectId', g.subject_id)
            ORDER BY g.workspace_id, g.subject_type, g.subject_id)
        FROM public.creator_tool_grants g WHERE g.tool = settings.tool
    ), '[]'::jsonb))
    FROM public.creator_tool_settings settings
    WHERE settings.tool = 'template-copy' AND public.tool_settings_admin(p_proof) IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.read_template_copy_settings(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_template_copy_settings(bytea) TO helpinsights_app;

CREATE FUNCTION public.change_template_copy_settings(
    p_proof bytea, p_action text, p_mode text, p_workspace uuid, p_subject_type text, p_subject uuid
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    admin_id uuid := public.tool_settings_admin(p_proof);
BEGIN
    IF admin_id IS NULL THEN RETURN 'forbidden'; END IF;

    IF p_action = 'mode' AND p_mode IN ('off', 'all', 'university', 'approved')
       AND p_workspace IS NULL AND p_subject_type IS NULL AND p_subject IS NULL THEN
        UPDATE public.creator_tool_settings SET mode = p_mode
        WHERE tool = 'template-copy' AND mode <> p_mode;
    ELSIF p_action IN ('grant', 'revoke') AND p_mode IS NULL
       AND p_workspace IS NOT NULL AND p_subject_type IN ('user', 'group') AND p_subject IS NOT NULL THEN
        IF p_action = 'grant' THEN
            IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = p_workspace)
               OR (p_subject_type = 'user' AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_subject))
               OR (p_subject_type = 'group' AND NOT EXISTS (SELECT 1 FROM public.approved_identity_groups WHERE id = p_subject)) THEN
                RETURN 'invalid';
            END IF;
            INSERT INTO public.creator_tool_grants (tool, workspace_id, subject_type, subject_id) VALUES ('template-copy', p_workspace, p_subject_type, p_subject)
            ON CONFLICT DO NOTHING;
        ELSE
            DELETE FROM public.creator_tool_grants WHERE tool = 'template-copy'
                AND workspace_id = p_workspace AND subject_type = p_subject_type AND subject_id = p_subject;
        END IF;
    ELSE
        RETURN 'invalid';
    END IF;

    IF FOUND THEN
        INSERT INTO public.creator_tool_audit (actor_id, tool, action, mode, workspace_id, subject_type, subject_id)
        VALUES (admin_id, 'template-copy', p_action, p_mode, p_workspace, p_subject_type, p_subject);
    END IF;
    RETURN 'ok';
END
$$;
REVOKE ALL ON FUNCTION public.change_template_copy_settings(bytea, text, text, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_template_copy_settings(bytea, text, text, uuid, text, uuid) TO helpinsights_app;

CREATE FUNCTION public.template_copy_allowed(p_proof bytea, p_workspace uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.resolve_session(p_proof) a
        JOIN public.sessions s ON s.token_hash = p_proof
        JOIN public.workspace_memberships m ON m.user_id = a.id AND m.workspace_id = p_workspace
        JOIN public.creator_tool_settings settings ON settings.tool = 'template-copy'
        WHERE m.role IN ('owner', 'editor') AND (
            settings.mode = 'all'
            OR (settings.mode = 'university' AND s.institutional_issuer IS NOT NULL)
            OR (settings.mode = 'approved' AND EXISTS (
                SELECT 1 FROM public.creator_tool_grants g
                WHERE g.tool = settings.tool AND g.workspace_id = p_workspace AND (
                    (g.subject_type = 'user' AND g.subject_id = a.id)
                    OR (g.subject_type = 'group' AND EXISTS (
                        SELECT 1 FROM public.approved_identity_group_members member
                        WHERE member.group_id = g.subject_id AND member.user_id = a.id
                    ))
                )
            ))
        )
    )
$$;
REVOKE ALL ON FUNCTION public.template_copy_allowed(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.template_copy_allowed(bytea, uuid) TO helpinsights_app;
