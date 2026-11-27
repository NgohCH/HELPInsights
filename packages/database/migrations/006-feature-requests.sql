CREATE TABLE public.feature_reviewers (
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    PRIMARY KEY (workspace_id, user_id),
    FOREIGN KEY (workspace_id, user_id)
        REFERENCES public.workspace_memberships (workspace_id, user_id) ON DELETE CASCADE
);

CREATE TABLE public.feature_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces (id),
    feature_key text NOT NULL CHECK (feature_key = 'nps'),
    requested_by uuid NOT NULL REFERENCES public.users (id),
    purpose text NOT NULL CHECK (length(btrim(purpose)) BETWEEN 1 AND 300),
    data_classification text NOT NULL CHECK (data_classification = 'anonymous'),
    requested_at timestamptz NOT NULL DEFAULT now(),
    decision text CHECK (decision IN ('approve', 'deny')),
    reviewed_by uuid REFERENCES public.users (id),
    rationale text CHECK (length(btrim(rationale)) BETWEEN 1 AND 300),
    decided_at timestamptz,
    expires_at timestamptz,
    expires_in_days integer CHECK (expires_in_days BETWEEN 1 AND 90),
    CHECK (
        (decision IS NULL AND reviewed_by IS NULL AND rationale IS NULL
            AND decided_at IS NULL AND expires_at IS NULL AND expires_in_days IS NULL)
        OR
        (decision IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_by <> requested_by
            AND rationale IS NOT NULL AND decided_at IS NOT NULL AND decided_at >= requested_at
            AND ((decision = 'deny' AND expires_at IS NULL AND expires_in_days IS NULL)
                OR (decision = 'approve' AND expires_at IS NOT NULL
                    AND expires_in_days IS NOT NULL
                    AND expires_at = decided_at + make_interval(hours => expires_in_days * 24))))
    )
);

CREATE INDEX feature_requests_workspace_history
    ON public.feature_requests (workspace_id, feature_key, requested_at DESC, id);
CREATE UNIQUE INDEX feature_requests_one_pending
    ON public.feature_requests (workspace_id, feature_key) WHERE decision IS NULL;
CREATE INDEX feature_requests_active
    ON public.feature_requests (workspace_id, feature_key, expires_at) WHERE decision = 'approve';

ALTER TABLE public.feature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_reviewers ENABLE ROW LEVEL SECURITY;

CREATE POLICY feature_reviewers_read_own ON public.feature_reviewers
    FOR SELECT TO helpinsights_app
    USING (user_id = nullif(current_setting('helpinsights.actor_id', true), '')::uuid);

CREATE POLICY feature_requests_read_scoped ON public.feature_requests
    FOR SELECT TO helpinsights_app
    USING (
        public.workspace_role(workspace_id) IS NOT NULL
        AND (
            requested_by = nullif(current_setting('helpinsights.actor_id', true), '')::uuid
            OR EXISTS (SELECT 1 FROM public.feature_reviewers r WHERE r.workspace_id = feature_requests.workspace_id)
        )
    );

CREATE POLICY feature_requests_insert_owned ON public.feature_requests
    FOR INSERT TO helpinsights_app
    WITH CHECK (
        public.workspace_role(workspace_id) IN ('owner', 'editor')
        AND requested_by = nullif(current_setting('helpinsights.actor_id', true), '')::uuid
        AND decision IS NULL
    );

CREATE POLICY feature_requests_decide_delegated ON public.feature_requests
    FOR UPDATE TO helpinsights_app
    USING (
        decision IS NULL
        AND requested_by <> nullif(current_setting('helpinsights.actor_id', true), '')::uuid
        AND EXISTS (SELECT 1 FROM public.feature_reviewers r WHERE r.workspace_id = feature_requests.workspace_id)
    )
    WITH CHECK (
        decision IS NOT NULL
        AND reviewed_by = nullif(current_setting('helpinsights.actor_id', true), '')::uuid
        AND EXISTS (SELECT 1 FROM public.feature_reviewers r WHERE r.workspace_id = feature_requests.workspace_id)
    );

-- Expose only the existence of current approval. Requests and rationale retain their own RLS.
CREATE FUNCTION public.nps_access_enabled(p_workspace uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.workspace_memberships m
        WHERE m.workspace_id = p_workspace
          AND m.user_id = nullif(current_setting('helpinsights.actor_id', true), '')::uuid
          AND m.role IN ('owner', 'editor')
    ) AND EXISTS (
        SELECT 1 FROM public.feature_requests f
        WHERE f.workspace_id = p_workspace AND f.feature_key = 'nps'
          AND f.decision = 'approve' AND f.expires_at > statement_timestamp()
    )
$$;

REVOKE ALL ON FUNCTION public.nps_access_enabled(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nps_access_enabled(uuid) TO helpinsights_app;
GRANT SELECT ON public.feature_reviewers, public.feature_requests TO helpinsights_app;
GRANT INSERT (workspace_id, feature_key, requested_by, purpose, data_classification)
    ON public.feature_requests TO helpinsights_app;
GRANT UPDATE (decision, reviewed_by, rationale, decided_at, expires_at, expires_in_days)
    ON public.feature_requests TO helpinsights_app;
