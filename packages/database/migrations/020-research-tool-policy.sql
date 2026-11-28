ALTER TABLE public.creator_tool_settings DROP CONSTRAINT creator_tool_settings_tool_check;
ALTER TABLE public.creator_tool_settings ADD CONSTRAINT creator_tool_settings_tool_check
    CHECK (tool IN ('template-copy', 'research-consent'));
ALTER TABLE public.creator_tool_settings ADD CONSTRAINT research_tools_require_university
    CHECK (tool <> 'research-consent' OR mode <> 'all');
INSERT INTO public.creator_tool_settings VALUES ('research-consent', 'university');

CREATE FUNCTION public.read_creator_tool_settings(p_proof bytea, p_tool text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT jsonb_build_object('mode', settings.mode, 'grants', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('workspaceId', g.workspace_id, 'subjectType', g.subject_type, 'subjectId', g.subject_id)
            ORDER BY g.workspace_id, g.subject_type, g.subject_id)
        FROM public.creator_tool_grants g WHERE g.tool = settings.tool
    ), '[]'::jsonb))
    FROM public.creator_tool_settings settings
    WHERE settings.tool = p_tool AND public.tool_settings_admin(p_proof) IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.read_creator_tool_settings(bytea, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_creator_tool_settings(bytea, text) TO helpinsights_app;

CREATE FUNCTION public.change_creator_tool_settings(
    p_proof bytea, p_tool text, p_action text, p_mode text, p_workspace uuid, p_subject_type text, p_subject uuid
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    admin_id uuid := public.tool_settings_admin(p_proof);
BEGIN
    IF admin_id IS NULL THEN RETURN 'forbidden'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.creator_tool_settings WHERE tool = p_tool) THEN RETURN 'invalid'; END IF;

    IF p_action = 'mode' AND p_mode IN ('off', 'all', 'university', 'approved')
       AND p_workspace IS NULL AND p_subject_type IS NULL AND p_subject IS NULL THEN
        IF p_tool = 'research-consent' AND p_mode = 'all' THEN RETURN 'invalid'; END IF;
        UPDATE public.creator_tool_settings SET mode = p_mode
        WHERE tool = p_tool AND mode <> p_mode;
    ELSIF p_action IN ('grant', 'revoke') AND p_mode IS NULL
       AND p_workspace IS NOT NULL AND p_subject_type IN ('user', 'group') AND p_subject IS NOT NULL THEN
        IF p_action = 'grant' THEN
            IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = p_workspace)
               OR (p_subject_type = 'user' AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_subject))
               OR (p_subject_type = 'group' AND NOT EXISTS (SELECT 1 FROM public.approved_identity_groups WHERE id = p_subject)) THEN
                RETURN 'invalid';
            END IF;
            INSERT INTO public.creator_tool_grants (tool, workspace_id, subject_type, subject_id) VALUES (p_tool, p_workspace, p_subject_type, p_subject)
            ON CONFLICT DO NOTHING;
        ELSE
            DELETE FROM public.creator_tool_grants WHERE tool = p_tool
                AND workspace_id = p_workspace AND subject_type = p_subject_type AND subject_id = p_subject;
        END IF;
    ELSE
        RETURN 'invalid';
    END IF;

    IF FOUND THEN
        INSERT INTO public.creator_tool_audit (actor_id, tool, action, mode, workspace_id, subject_type, subject_id)
        VALUES (admin_id, p_tool, p_action, p_mode, p_workspace, p_subject_type, p_subject);
    END IF;
    RETURN 'ok';
END
$$;
REVOKE ALL ON FUNCTION public.change_creator_tool_settings(bytea, text, text, text, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_creator_tool_settings(bytea, text, text, text, uuid, text, uuid) TO helpinsights_app;

CREATE FUNCTION public.creator_tool_group_member(p_proof bytea, p_group uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.resolve_session(p_proof) actor
        JOIN public.approved_identity_group_members member ON member.user_id = actor.id
        WHERE member.group_id = p_group
    )
$$;
REVOKE ALL ON FUNCTION public.creator_tool_group_member(bytea, uuid) FROM PUBLIC;

CREATE FUNCTION public.creator_tool_allowed(p_proof bytea, p_workspace uuid, p_tool text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.resolve_session(p_proof) a
        JOIN public.sessions s ON s.token_hash = p_proof
        JOIN public.workspace_memberships m ON m.user_id = a.id AND m.workspace_id = p_workspace
        JOIN public.creator_tool_settings settings ON settings.tool = p_tool
        WHERE m.role IN ('owner', 'editor')
          AND (p_tool <> 'research-consent' OR s.institutional_issuer IS NOT NULL)
          AND (
            settings.mode = 'all'
            OR (settings.mode = 'university' AND s.institutional_issuer IS NOT NULL)
            OR (settings.mode = 'approved' AND EXISTS (
                SELECT 1 FROM public.creator_tool_grants g
                WHERE g.tool = settings.tool AND g.workspace_id = p_workspace AND (
                    (g.subject_type = 'user' AND g.subject_id = a.id)
                    OR (g.subject_type = 'group' AND public.creator_tool_group_member(p_proof, g.subject_id))
                )
            ))
        )
    )
$$;
REVOKE ALL ON FUNCTION public.creator_tool_allowed(bytea, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_tool_allowed(bytea, uuid, text) TO helpinsights_app;

CREATE OR REPLACE FUNCTION public.template_copy_allowed(p_proof bytea, p_workspace uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT public.creator_tool_allowed(p_proof, p_workspace, 'template-copy')
$$;

CREATE OR REPLACE FUNCTION public.read_template_copy_settings(p_proof bytea)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT public.read_creator_tool_settings(p_proof, 'template-copy')
$$;

CREATE OR REPLACE FUNCTION public.change_template_copy_settings(
    p_proof bytea, p_action text, p_mode text, p_workspace uuid, p_subject_type text, p_subject uuid
)
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT public.change_creator_tool_settings(p_proof, 'template-copy', p_action, p_mode, p_workspace, p_subject_type, p_subject)
$$;

DROP POLICY research_consent_insert_scoped ON public.research_consent_versions;
REVOKE INSERT (survey_version_id, study_key, revision, notice)
    ON public.research_consent_versions FROM helpinsights_app;

CREATE FUNCTION public.attach_synthetic_research_consent(
    p_proof bytea, p_version uuid, p_study_key text, p_notice text
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    WITH attached AS (
        INSERT INTO public.research_consent_versions (survey_version_id, study_key, revision, notice)
        SELECT v.id, p_study_key, v.version, p_notice
        FROM public.survey_versions v
        JOIN public.surveys s ON s.id = v.survey_id
        WHERE v.id = p_version AND v.published_at = transaction_timestamp()
          AND EXISTS (SELECT 1 FROM public.resolve_session(p_proof) a WHERE a.id = NULLIF(current_setting('helpinsights.actor_id', true), '')::uuid)
          AND public.creator_tool_allowed(p_proof, s.workspace_id, 'research-consent')
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM attached)
$$;
REVOKE ALL ON FUNCTION public.attach_synthetic_research_consent(bytea, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attach_synthetic_research_consent(bytea, uuid, text, text) TO helpinsights_app;
