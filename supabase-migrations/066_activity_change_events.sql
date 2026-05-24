-- ============================================================================
-- 066_activity_change_events.sql
-- ----------------------------------------------------------------------------
-- General-purpose SECURITY DEFINER RPC for recording activity events from
-- client code. This is the platform write path for the WCF Activity Layer:
-- every user-initiated mutation (field edit, status change, record lifecycle)
-- should flow through this RPC.
--
-- Supported event types (server-enforced allowlist):
--   field.updated     — one or more fields changed on a record
--   status.changed    — record status/lifecycle transition
--   record.created    — new record created
--   record.deleted    — record soft-deleted (tombstone preserved).
--                       The source entity must still exist in its table
--                       because _activity_can_write checks entity
--                       existence. Hard-deleted entities are invisible to
--                       the current resolver; a tombstone/deleted-record
--                       visibility path is required before logging
--                       hard-delete events.
--   record.restored   — record restored from soft-deleted state
--
-- The RPC authenticates the caller, rejects inactive profiles, gates on
-- _activity_can_write, then inserts into activity_events. It does NOT
-- create notifications or mentions.
--
-- Phase 1 note: pilot surfaces write data first, then record activity
-- best-effort. This is UI-level logging, not audit-grade transactional
-- guarantees. Future high-value writes should use server RPCs/triggers
-- that mutate data and record activity in one transaction.
--
-- Events flow through list_activity_events and list_global_activity
-- without modification — both RPCs read from activity_events directly.
--
-- Payload convention:
--   { entity_label: "L-26-01",
--     changes: [{ field: "notes", label: "Notes",
--                 from: "old", to: "new",
--                 old_present: true, new_present: true }] }
--
-- Apply order: TEST first, PROD after lane approval.
-- ============================================================================

-- Drop the narrow-scope function from the earlier iteration if it exists,
-- so the generalized signature takes over cleanly.
DROP FUNCTION IF EXISTS public.record_activity_change_event(text, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.record_activity_event(
  p_entity_type  text,
  p_entity_id    text,
  p_event_type   text,
  p_entity_label text    DEFAULT NULL,
  p_body         text    DEFAULT NULL,
  p_payload      jsonb   DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text;
  v_id     text;
BEGIN
  -- 1. Authenticate
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'record_activity_event: authenticated caller required';
  END IF;

  v_role := public.profile_role();
  IF v_role IS NULL OR v_role = 'inactive' THEN
    RAISE EXCEPTION 'record_activity_event: caller role % cannot write', COALESCE(v_role, 'null');
  END IF;

  -- 2. Event type: reject null/blank, then allowlist
  IF p_event_type IS NULL OR length(trim(p_event_type)) = 0 THEN
    RAISE EXCEPTION 'record_activity_event: event_type required';
  END IF;

  IF p_event_type NOT IN (
    'field.updated', 'status.changed',
    'record.created', 'record.deleted', 'record.restored'
  ) THEN
    RAISE EXCEPTION 'record_activity_event: unsupported event_type %', p_event_type;
  END IF;

  -- 3. Permission gate
  IF NOT public._activity_can_write(p_entity_type, p_entity_id) THEN
    RAISE EXCEPTION 'record_activity_event: write denied for % / %', p_entity_type, p_entity_id;
  END IF;

  -- 4. Body length guard
  IF p_body IS NOT NULL AND length(p_body) > 2000 THEN
    RAISE EXCEPTION 'record_activity_event: body too long (% chars)', length(p_body);
  END IF;

  -- 5. Generate ID (same scheme as post_activity_comment)
  v_id := 'ae-' || gen_random_uuid()::text;

  -- 6. Insert the activity event
  INSERT INTO public.activity_events (
    id, entity_type, entity_id, actor_profile_id,
    event_type, body, payload
  ) VALUES (
    v_id,
    p_entity_type,
    p_entity_id,
    v_caller,
    p_event_type,
    p_body,
    COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object(
      'entity_label', COALESCE(p_entity_label, '')
    )
  );

  RETURN jsonb_build_object('ok', true, 'event_id', v_id);
END
$fn$;

REVOKE ALL ON FUNCTION public.record_activity_event(text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_activity_event(text, text, text, text, text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- End of 066_activity_change_events.sql
-- ============================================================================
