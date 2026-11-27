ALTER TABLE public.operation_incidents
    ALTER COLUMN actor_id DROP NOT NULL,
    ADD COLUMN source text NOT NULL DEFAULT 'operator',
    ADD COLUMN episode_id uuid,
    ADD COLUMN observed_at timestamptz,
    ADD CONSTRAINT operation_incident_source CHECK (
        (
            source = 'operator' AND actor_id IS NOT NULL
            AND episode_id IS NULL AND observed_at IS NULL
        ) OR (
            source = 'export_worker' AND actor_id IS NULL
            AND episode_id IS NOT NULL AND observed_at IS NOT NULL AND isfinite(observed_at)
            AND component = 'database'
            AND ((state = 'detected' AND severity = 'advisory')
                OR (state = 'recovered' AND severity = 'information'))
        )
    ),
    ADD CONSTRAINT worker_incident_once UNIQUE (episode_id, state);

GRANT SELECT (source, episode_id, observed_at)
    ON public.operation_incidents TO helpinsights_app;

CREATE FUNCTION public.record_export_worker_recovery(p_episode uuid, p_detected_at timestamptz)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_recovered_at timestamptz := clock_timestamp();
BEGIN
    IF p_episode IS NULL OR p_detected_at IS NULL OR NOT isfinite(p_detected_at) THEN
        RAISE EXCEPTION 'Invalid export worker episode' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.operation_incidents
        (component, state, severity, actor_id, source, episode_id, observed_at)
    VALUES
        ('database', 'detected', 'advisory', NULL, 'export_worker', p_episode, least(p_detected_at, v_recovered_at)),
        ('database', 'recovered', 'information', NULL, 'export_worker', p_episode, v_recovered_at)
    ON CONFLICT (episode_id, state) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.record_export_worker_recovery(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_export_worker_recovery(uuid, timestamptz) TO helpinsights_exporter;
