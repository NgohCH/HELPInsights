CREATE TABLE public.platform_operations_memberships (
    user_id uuid PRIMARY KEY REFERENCES public.users (id),
    role text NOT NULL CHECK (role IN ('viewer', 'operator'))
);

ALTER TABLE public.platform_operations_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY operations_own_membership ON public.platform_operations_memberships
    FOR SELECT TO helpinsights_app
    USING (user_id = nullif(current_setting('helpinsights.actor_id', true), '')::uuid);

GRANT SELECT ON public.platform_operations_memberships TO helpinsights_app;

CREATE TABLE public.operation_incidents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    component text NOT NULL CHECK (component IN ('api', 'database', 'schema')),
    state text NOT NULL CHECK (state IN ('detected', 'recovered')),
    severity text NOT NULL CHECK (severity IN ('information', 'advisory', 'action_required', 'critical')),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    actor_id uuid NOT NULL REFERENCES public.users (id)
        DEFAULT nullif(current_setting('helpinsights.actor_id', true), '')::uuid
);

CREATE INDEX operation_incidents_recent ON public.operation_incidents (recorded_at DESC, id DESC);

ALTER TABLE public.operation_incidents ENABLE ROW LEVEL SECURITY;

-- The membership table exposes only the authenticated actor's row under RLS.
CREATE POLICY operations_read_incidents ON public.operation_incidents
    FOR SELECT TO helpinsights_app
    USING (EXISTS (SELECT 1 FROM public.platform_operations_memberships));

CREATE POLICY operations_add_incident ON public.operation_incidents
    FOR INSERT TO helpinsights_app
    WITH CHECK (
        actor_id = nullif(current_setting('helpinsights.actor_id', true), '')::uuid
        AND EXISTS (
            SELECT 1 FROM public.platform_operations_memberships WHERE role = 'operator'
        )
    );

-- Attribution is kept for audit and excluded from the public projection.
GRANT SELECT (id, component, state, severity, recorded_at)
    ON public.operation_incidents TO helpinsights_app;
GRANT INSERT (component, state, severity)
    ON public.operation_incidents TO helpinsights_app;
