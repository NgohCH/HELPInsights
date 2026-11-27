CREATE TABLE public.institutional_principal_bindings (
    issuer text COLLATE "C" NOT NULL CHECK (length(issuer) BETWEEN 1 AND 255),
    subject text COLLATE "C" NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
    user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    PRIMARY KEY (issuer, subject)
);

CREATE FUNCTION public.resolve_institutional_principal(p_issuer text, p_subject text)
RETURNS TABLE (id uuid, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT actor.id, actor.display_name
    FROM public.institutional_principal_bindings AS binding
    JOIN public.users AS actor ON actor.id = binding.user_id
    WHERE binding.issuer = p_issuer AND binding.subject = p_subject
$$;

ALTER TABLE public.institutional_principal_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.institutional_principal_bindings FROM PUBLIC, helpinsights_app;
REVOKE ALL ON FUNCTION public.resolve_institutional_principal(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_institutional_principal(text, text) TO helpinsights_app;
