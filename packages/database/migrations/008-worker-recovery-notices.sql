CREATE TABLE public.worker_recovery_receipts (
    incident_id uuid NOT NULL REFERENCES public.operation_incidents (id),
    operator_id uuid NOT NULL REFERENCES public.users (id),
    acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (operator_id, incident_id)
);

ALTER TABLE public.worker_recovery_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY operators_read_own_recovery_receipts ON public.worker_recovery_receipts
    FOR SELECT TO helpinsights_app
    USING (
        operator_id = nullif(current_setting('helpinsights.actor_id', true), '')::uuid
        AND EXISTS (
            SELECT 1 FROM public.platform_operations_memberships m
            WHERE m.user_id = operator_id AND m.role = 'operator'
        )
    );

GRANT SELECT (incident_id, acknowledged_at)
    ON public.worker_recovery_receipts TO helpinsights_app;

CREATE FUNCTION public.acknowledge_worker_recovery(p_incident uuid)
RETURNS TABLE (outcome text, created_at timestamptz, acknowledged_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor uuid := nullif(current_setting('helpinsights.actor_id', true), '')::uuid;
    v_created timestamptz;
BEGIN
    PERFORM 1 FROM public.platform_operations_memberships m
    WHERE m.user_id = v_actor AND m.role = 'operator' FOR SHARE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'forbidden'::text, NULL::timestamptz, NULL::timestamptz;
        RETURN;
    END IF;

    SELECT i.observed_at INTO v_created
    FROM public.operation_incidents i
    WHERE i.id = p_incident AND i.source = 'export_worker' AND i.state = 'recovered';
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'not_found'::text, NULL::timestamptz, NULL::timestamptz;
        RETURN;
    END IF;

    INSERT INTO public.worker_recovery_receipts (incident_id, operator_id)
    VALUES (p_incident, v_actor)
    ON CONFLICT (operator_id, incident_id) DO NOTHING;

    RETURN QUERY SELECT 'acknowledged'::text, v_created, r.acknowledged_at
    FROM public.worker_recovery_receipts r
    WHERE r.operator_id = v_actor AND r.incident_id = p_incident;
END;
$$;

REVOKE ALL ON FUNCTION public.acknowledge_worker_recovery(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acknowledge_worker_recovery(uuid) TO helpinsights_app;
