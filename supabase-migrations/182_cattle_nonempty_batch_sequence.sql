-- ============================================================================
-- 182_cattle_nonempty_batch_sequence.sql
-- A forecast month with zero cattle is not a processing batch and must not
-- consume a C-YY-NN sequence number. The client computes the non-empty monthly
-- pipeline; this RPC atomically removes empty scheduled bookings and closes
-- later scheduled-name gaps while preserving active/complete history.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reconcile_cattle_scheduled_batches(
  p_plan jsonb,
  p_team_member text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_item jsonb;
  v_row public.cattle_processing_batches;
  v_id text;
  v_expected text;
  v_action text;
  v_target text;
  v_count int;
  v_dropped int := 0;
  v_renamed int := 0;
  v_event_id text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'reconcile_cattle_scheduled_batches: authenticated caller required';
  END IF;
  v_role := public.profile_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'management') THEN
    RAISE EXCEPTION 'reconcile_cattle_scheduled_batches: caller role % cannot reconcile', COALESCE(v_role, 'null');
  END IF;
  IF p_plan IS NULL OR jsonb_typeof(p_plan) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'reconcile_cattle_scheduled_batches: p_plan must be an array';
  END IF;
  IF jsonb_array_length(p_plan) > 100 THEN
    RAISE EXCEPTION 'reconcile_cattle_scheduled_batches: p_plan exceeds 100 rows';
  END IF;
  IF jsonb_array_length(p_plan) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'dropped', 0, 'renamed', 0, 'unchanged', true);
  END IF;

  -- One reconciliation at a time, then lock referenced batch rows in stable
  -- id order. Attach/unschedule paths lock the same batch rows before mutation.
  PERFORM pg_advisory_xact_lock(182001);
  PERFORM 1
    FROM public.cattle_processing_batches b
   WHERE b.id IN (SELECT elem->>'id' FROM jsonb_array_elements(p_plan) elem)
   ORDER BY b.id
   FOR UPDATE;

  SELECT count(DISTINCT elem->>'id') INTO v_count FROM jsonb_array_elements(p_plan) elem;
  IF v_count IS DISTINCT FROM jsonb_array_length(p_plan) THEN
    RAISE EXCEPTION 'reconcile_cattle_scheduled_batches: duplicate or null plan ids';
  END IF;

  -- Validate the complete plan before any write. expected_name makes a stale
  -- browser snapshot fail closed instead of deleting/renaming a changed row.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_plan)
  LOOP
    v_id := NULLIF(v_item->>'id', '');
    v_expected := v_item->>'expected_name';
    v_action := v_item->>'action';
    v_target := NULLIF(v_item->>'target_name', '');
    IF v_id IS NULL OR v_action NOT IN ('drop', 'rename') THEN
      RAISE EXCEPTION 'reconcile_cattle_scheduled_batches: invalid plan item';
    END IF;
    SELECT * INTO v_row FROM public.cattle_processing_batches WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'reconcile_cattle_scheduled_batches: batch % no longer exists', v_id;
    END IF;
    IF v_row.status IS DISTINCT FROM 'scheduled' THEN
      RAISE EXCEPTION 'reconcile_cattle_scheduled_batches: batch % is no longer scheduled', v_id;
    END IF;
    IF v_row.name IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'reconcile_cattle_scheduled_batches: stale name for batch %', v_id;
    END IF;
    IF v_action = 'drop' THEN
      IF jsonb_array_length(COALESCE(v_row.cows_detail, '[]'::jsonb)) <> 0
         OR EXISTS (SELECT 1 FROM public.cattle c WHERE c.processing_batch_id = v_id) THEN
        RAISE EXCEPTION 'reconcile_cattle_scheduled_batches: refusing to drop non-empty batch %', v_id;
      END IF;
    ELSE
      IF v_target IS NULL OR v_target !~ '^C-[0-9]{2}-[0-9]{2,}$' THEN
        RAISE EXCEPTION 'reconcile_cattle_scheduled_batches: invalid target name for batch %', v_id;
      END IF;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM (
        SELECT elem->>'target_name' AS target_name, count(*) AS n
          FROM jsonb_array_elements(p_plan) elem
         WHERE elem->>'action' = 'rename'
         GROUP BY elem->>'target_name'
      ) q
     WHERE q.target_name IS NULL OR q.n > 1
  ) THEN
    RAISE EXCEPTION 'reconcile_cattle_scheduled_batches: duplicate target names';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.cattle_processing_batches b
     WHERE b.name IN (
       SELECT elem->>'target_name' FROM jsonb_array_elements(p_plan) elem WHERE elem->>'action' = 'rename'
     )
       AND b.id NOT IN (SELECT elem->>'id' FROM jsonb_array_elements(p_plan) elem)
  ) THEN
    RAISE EXCEPTION 'reconcile_cattle_scheduled_batches: target name already belongs to another batch';
  END IF;

  -- Remove empty months first, freeing their sequence slots. Each removal is
  -- audited before deletion, matching the manual unschedule lifecycle.
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_plan)
     WHERE value->>'action' = 'drop'
     ORDER BY value->>'id'
  LOOP
    v_id := v_item->>'id';
    v_expected := v_item->>'expected_name';
    v_event_id := 'ae-' || gen_random_uuid()::text;
    INSERT INTO public.activity_events (
      id, entity_type, entity_id, actor_profile_id, event_type, body, payload
    ) VALUES (
      v_event_id, 'cattle.processing', v_id, v_caller, 'record.deleted',
      'Removed empty forecast batch ' || v_expected,
      jsonb_build_object('entity_label', v_expected, 'action', 'auto_unschedule_zero_cows',
                         'prior_status', 'scheduled', 'team_member', p_team_member)
    );
    DELETE FROM public.cattle_processing_batches WHERE id = v_id;
    v_dropped := v_dropped + 1;
  END LOOP;

  -- Move every renamed row through a unique temporary name so a chain such as
  -- 06->05, 07->06 cannot trip the table's UNIQUE(name) constraint.
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_plan)
     WHERE value->>'action' = 'rename'
     ORDER BY value->>'id'
  LOOP
    UPDATE public.cattle_processing_batches
       SET name = '__cattle_reconcile__' || gen_random_uuid()::text
     WHERE id = v_item->>'id';
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_plan)
     WHERE value->>'action' = 'rename'
     ORDER BY value->>'target_name'
  LOOP
    v_id := v_item->>'id';
    v_expected := v_item->>'expected_name';
    v_target := v_item->>'target_name';
    UPDATE public.cattle_processing_batches SET name = v_target WHERE id = v_id;
    v_event_id := 'ae-' || gen_random_uuid()::text;
    INSERT INTO public.activity_events (
      id, entity_type, entity_id, actor_profile_id, event_type, body, payload
    ) VALUES (
      v_event_id, 'cattle.processing', v_id, v_caller, 'field.updated',
      'Renamed ' || v_expected || ' -> ' || v_target,
      jsonb_build_object('entity_label', v_target, 'action', 'auto_close_zero_month_gap',
                         'old_name', v_expected, 'new_name', v_target,
                         'team_member', p_team_member)
    );
    v_renamed := v_renamed + 1;
  END LOOP;

  -- Keep the unified Processing schedule in the same transaction. Renames
  -- update the canonical title immediately; removed zero-cow sources are
  -- swept according to the existing worked-row preservation contract.
  PERFORM public.reconcile_planner_to_processing();

  RETURN jsonb_build_object('ok', true, 'dropped', v_dropped, 'renamed', v_renamed, 'unchanged', false);
END
$fn$;

REVOKE ALL ON FUNCTION public.reconcile_cattle_scheduled_batches(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_cattle_scheduled_batches(jsonb, text) TO authenticated;

COMMENT ON FUNCTION public.reconcile_cattle_scheduled_batches(jsonb, text) IS
  'Management/admin: atomically remove zero-cow scheduled cattle months and close later sequence gaps.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- End 182_cattle_nonempty_batch_sequence.sql
-- ============================================================================
