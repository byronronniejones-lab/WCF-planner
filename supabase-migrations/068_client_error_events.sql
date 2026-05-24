-- 068: Client error events -- durable redacted error signal for Error
-- Resilience Phase 1. Not a full observability system.
--
-- Clients call record_client_error (SECURITY DEFINER) to persist a
-- redacted error event. Clients cannot read, update, or delete rows.
-- Admin can query the table directly for diagnosis.

BEGIN;

-- Table --

CREATE TABLE IF NOT EXISTS public.client_error_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  profile_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source        text NOT NULL CHECK (char_length(source) <= 50),
  error_kind    text NOT NULL CHECK (char_length(error_kind) <= 100),
  message       text NOT NULL CHECK (char_length(message) <= 200),
  stack_summary text CHECK (char_length(stack_summary) <= 500),
  route         text CHECK (char_length(route) <= 200),
  user_agent    text CHECK (char_length(user_agent) <= 500),
  app_version   text CHECK (char_length(app_version) <= 50)
);

COMMENT ON TABLE public.client_error_events IS
  'Redacted client-side error events for runtime health visibility.';

-- RLS -- admin read-only, no direct client access --

ALTER TABLE public.client_error_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.client_error_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.client_error_events TO authenticated;

CREATE POLICY admin_read ON public.client_error_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- SECURITY DEFINER RPC --

CREATE OR REPLACE FUNCTION public.record_client_error(
  p_source        text,
  p_error_kind    text,
  p_message       text,
  p_stack_summary text DEFAULT NULL,
  p_route         text DEFAULT NULL,
  p_user_agent    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.client_error_events (
    profile_id, source, error_kind, message,
    stack_summary, route, user_agent
  ) VALUES (
    auth.uid(),
    left(coalesce(nullif(trim(p_source), ''), 'unknown'), 50),
    left(coalesce(nullif(trim(p_error_kind), ''), 'Error'), 100),
    left(coalesce(p_message, ''), 200),
    left(p_stack_summary, 500),
    left(p_route, 200),
    left(p_user_agent, 500)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_client_error(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_client_error(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_client_error(text, text, text, text, text, text) TO anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
