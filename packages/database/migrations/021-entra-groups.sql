ALTER TABLE public.approved_identity_groups
    ADD COLUMN entra_issuer text COLLATE "C",
    ADD COLUMN entra_object_id uuid,
    ADD CONSTRAINT identity_group_entra_pair CHECK ((entra_issuer IS NULL) = (entra_object_id IS NULL)),
    ADD CONSTRAINT identity_group_entra_mapping UNIQUE (entra_issuer, entra_object_id);

ALTER TABLE public.institutional_principal_bindings
    ADD COLUMN entra_groups_issued_at bigint,
    ADD COLUMN entra_group_object_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

CREATE TABLE public.university_session_group_memberships (
    token_hash bytea NOT NULL REFERENCES public.sessions(token_hash) ON DELETE CASCADE,
    group_id uuid NOT NULL REFERENCES public.approved_identity_groups(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (token_hash, group_id)
);
CREATE INDEX university_session_memberships_group ON public.university_session_group_memberships(group_id);
ALTER TABLE public.university_session_group_memberships ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.invalidate_remapped_entra_group()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    DELETE FROM public.university_session_group_memberships WHERE group_id = OLD.id;
    DELETE FROM public.approved_identity_group_members WHERE group_id = OLD.id;
    RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.invalidate_remapped_entra_group() FROM PUBLIC;

CREATE TRIGGER invalidate_remapped_entra_group
    BEFORE UPDATE OF entra_issuer, entra_object_id ON public.approved_identity_groups
    FOR EACH ROW WHEN (OLD.entra_issuer IS DISTINCT FROM NEW.entra_issuer
                    OR OLD.entra_object_id IS DISTINCT FROM NEW.entra_object_id)
    EXECUTE FUNCTION public.invalidate_remapped_entra_group();

CREATE FUNCTION public.issue_university_session(
    p_issuer text, p_subject text, p_token_hash bytea, p_group_ids uuid[],
    p_issued_at bigint, p_expires_at bigint
)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    last_issued_at bigint;
    last_objects uuid[];
    current_objects uuid[] := ARRAY[]::uuid[];
    expires_at timestamptz;
    current_groups uuid[] := ARRAY[]::uuid[];
BEGIN
    -- Serialize callbacks for one binding so a refresh and its removals commit together.
    SELECT binding.entra_groups_issued_at, binding.entra_group_object_ids
    INTO last_issued_at, last_objects
    FROM public.institutional_principal_bindings binding
    WHERE binding.issuer = p_issuer AND binding.subject = p_subject
    FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;

    IF NOT public.issue_university_session(p_issuer, p_subject, p_token_hash) THEN
        RETURN false;
    END IF;

    -- A delayed older callback can sign in, but cannot restore or remove newer group permissions.
    IF p_issued_at IS NULL OR p_issued_at < last_issued_at THEN RETURN true; END IF;
    IF p_expires_at > extract(epoch FROM now()) AND p_expires_at <= 253402300799
       AND cardinality(p_group_ids) <= 200 THEN
        expires_at := LEAST(to_timestamp(p_expires_at), now() + interval '30 minutes');
        -- Same-time callbacks may retain or remove membership, since there is no trusted ordering.
        -- Lock approved mappings until the snapshot commits so a remap cannot race issuance.
        SELECT COALESCE(array_agg(mapping.id), ARRAY[]::uuid[]),
               COALESCE(array_agg(mapping.entra_object_id), ARRAY[]::uuid[])
        INTO current_groups, current_objects
        FROM (
            SELECT approved.id, approved.entra_object_id
            FROM public.approved_identity_groups approved
            WHERE approved.entra_issuer = p_issuer AND approved.entra_object_id = ANY(p_group_ids)
              AND (p_issued_at IS DISTINCT FROM last_issued_at OR approved.entra_object_id = ANY(last_objects))
            ORDER BY approved.id
            FOR SHARE
        ) AS mapping;
    END IF;

    UPDATE public.institutional_principal_bindings
    SET entra_groups_issued_at = p_issued_at, entra_group_object_ids = current_objects
    WHERE issuer = p_issuer AND subject = p_subject;

    DELETE FROM public.university_session_group_memberships membership
    USING public.sessions session
    WHERE session.token_hash = membership.token_hash
      AND session.institutional_issuer = p_issuer AND session.institutional_subject = p_subject
      AND (membership.group_id <> ALL(current_groups)
           OR membership.expires_at <= now()
           OR session.revoked_at IS NOT NULL OR session.expires_at <= now());

    INSERT INTO public.university_session_group_memberships (token_hash, group_id, expires_at)
    SELECT p_token_hash, group_id, expires_at FROM unnest(current_groups) AS groups(group_id);
    RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.issue_university_session(text, text, bytea, uuid[], bigint, bigint) FROM PUBLIC, helpinsights_app;
GRANT EXECUTE ON FUNCTION public.issue_university_session(text, text, bytea, uuid[], bigint, bigint) TO helpinsights_identity;

CREATE OR REPLACE FUNCTION public.revoke_university_session(p_token_hash bytea)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    WITH revoked AS (
        UPDATE public.sessions SET revoked_at = now()
        WHERE token_hash = p_token_hash AND institutional_issuer IS NOT NULL AND revoked_at IS NULL
        RETURNING token_hash
    )
    DELETE FROM public.university_session_group_memberships membership
    USING revoked WHERE revoked.token_hash = membership.token_hash
$$;

CREATE OR REPLACE FUNCTION public.creator_tool_group_member(p_proof bytea, p_group uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.resolve_session(p_proof) actor
        JOIN public.approved_identity_groups approved ON approved.id = p_group
        WHERE (approved.entra_issuer IS NULL AND EXISTS (
            SELECT 1 FROM public.approved_identity_group_members member
            WHERE member.group_id = p_group AND member.user_id = actor.id
        )) OR (approved.entra_issuer IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.university_session_group_memberships membership
            WHERE membership.group_id = p_group AND membership.token_hash = p_proof
              AND membership.expires_at > now()
        ))
    )
$$;
REVOKE ALL ON FUNCTION public.creator_tool_group_member(bytea, uuid) FROM PUBLIC;
