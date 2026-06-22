-- ============================================================================
-- 137_pasture_map_pig_paddocks.sql  (Pasture Map — permanent feeder-pig paddocks)
-- ----------------------------------------------------------------------------
-- Creates 40 PERMANENT paddocks, 10 under each of the 4 existing pig pastures,
-- matching the Ronnie-approved labeling/preview:
--   A = Pig Pasture #3 (NW), A-1..A-10 numbered EAST->WEST
--   B = Pig Pasture #4 (NE), B-1..B-10 numbered WEST->EAST
--   C = Pig Pasture #1 (SW), C-1..C-10 numbered EAST->WEST
--   D = Pig Pasture #2 (SE), D-1..D-10 numbered WEST->EAST
-- Numbering radiates outward from the center of the 4-pasture block.
--
-- Each new row: kind='paddock', permanence='permanent', designation='feeder_pig',
-- status='active', review_status='reviewed', source='drawn', parented to its pig
-- pasture (resolved BY NAME so this is portable across TEST/PROD ids). Geometry
-- v1 is appended via the mig-116 helper _land_area_add_version (forces 2D +
-- MultiPolygon, geodesic acres, geometry_status='valid'). Parents are NOT
-- modified.
--
-- IDEMPOTENT: deterministic ids 'la-pigpad-a1'..'la-pigpad-d10'. On rerun, an
-- existing correct row is left untouched (no duplicate row, no extra geometry
-- version). An existing row that conflicts with the expected shape raises rather
-- than silently mutating. Prechecks/postchecks guard parent count and child count.
--
-- NO BEGIN/COMMIT: TEST applies via exec_sql; PROD via psql --single-transaction.
-- Depends on: mig 116 (land_areas, _land_area_add_version), the 4 pig pastures.
-- ============================================================================

DO $mig137$
DECLARE
  rec    record;
  v_par  text;
  v_id   text;
  v_geom extensions.geometry;
  v_cnt  int;
  v_total int := 0;
BEGIN
  -- Precheck: exactly 4 active pig pastures by name, all kind='pasture'.
  IF (SELECT count(*) FROM public.land_areas
        WHERE name IN ('Pig Pasture #1','Pig Pasture #2','Pig Pasture #3','Pig Pasture #4')
          AND kind = 'pasture' AND status = 'active' AND deleted_at IS NULL) <> 4 THEN
    RAISE EXCEPTION 'PM_137: expected exactly 4 active pig pastures by name (kind=pasture)';
  END IF;

  FOR rec IN
    SELECT * FROM (VALUES
      ('A-10','Pig Pasture #3','{"type":"Polygon","coordinates":[[[-86.433127,30.849569],[-86.43292459999999,30.8495734],[-86.4328233,30.848625300000002],[-86.433021,30.848624],[-86.433127,30.849569]]]}'::jsonb),
      ('A-9','Pig Pasture #3','{"type":"Polygon","coordinates":[[[-86.43292459999999,30.8495734],[-86.4327222,30.8495778],[-86.4326256,30.8486266],[-86.4328233,30.848625300000002],[-86.43292459999999,30.8495734]]]}'::jsonb),
      ('A-8','Pig Pasture #3','{"type":"Polygon","coordinates":[[[-86.4327222,30.8495778],[-86.4325198,30.8495822],[-86.4324279,30.8486279],[-86.4326256,30.8486266],[-86.4327222,30.8495778]]]}'::jsonb),
      ('A-7','Pig Pasture #3','{"type":"Polygon","coordinates":[[[-86.4325198,30.8495822],[-86.4323174,30.8495866],[-86.43223019999999,30.8486292],[-86.4324279,30.8486279],[-86.4325198,30.8495822]]]}'::jsonb),
      ('A-6','Pig Pasture #3','{"type":"Polygon","coordinates":[[[-86.4323174,30.8495866],[-86.432115,30.849591],[-86.43203249999999,30.8486305],[-86.43223019999999,30.8486292],[-86.4323174,30.8495866]]]}'::jsonb),
      ('A-5','Pig Pasture #3','{"type":"Polygon","coordinates":[[[-86.432115,30.849591],[-86.43191259999999,30.849595400000002],[-86.4318348,30.8486318],[-86.43203249999999,30.8486305],[-86.432115,30.849591]]]}'::jsonb),
      ('A-4','Pig Pasture #3','{"type":"Polygon","coordinates":[[[-86.43191259999999,30.849595400000002],[-86.4317102,30.8495998],[-86.4316371,30.8486331],[-86.4318348,30.8486318],[-86.43191259999999,30.849595400000002]]]}'::jsonb),
      ('A-3','Pig Pasture #3','{"type":"Polygon","coordinates":[[[-86.4317102,30.8495998],[-86.43150779999999,30.8496042],[-86.4314394,30.8486344],[-86.4316371,30.8486331],[-86.4317102,30.8495998]]]}'::jsonb),
      ('A-2','Pig Pasture #3','{"type":"Polygon","coordinates":[[[-86.43150779999999,30.8496042],[-86.4313054,30.8496086],[-86.4312417,30.8486357],[-86.4314394,30.8486344],[-86.43150779999999,30.8496042]]]}'::jsonb),
      ('A-1','Pig Pasture #3','{"type":"Polygon","coordinates":[[[-86.4313054,30.8496086],[-86.431103,30.849613],[-86.431044,30.848637],[-86.4312417,30.8486357],[-86.4313054,30.8496086]]]}'::jsonb),
      ('B-1','Pig Pasture #4','{"type":"Polygon","coordinates":[[[-86.430862,30.849631],[-86.43066680000001,30.8496345],[-86.4306017,30.8486424],[-86.430787,30.848641],[-86.430862,30.849631]]]}'::jsonb),
      ('B-2','Pig Pasture #4','{"type":"Polygon","coordinates":[[[-86.43066680000001,30.8496345],[-86.4304716,30.849638],[-86.4304164,30.8486438],[-86.4306017,30.8486424],[-86.43066680000001,30.8496345]]]}'::jsonb),
      ('B-3','Pig Pasture #4','{"type":"Polygon","coordinates":[[[-86.4304716,30.849638],[-86.4302764,30.849641499999997],[-86.4302311,30.8486452],[-86.4304164,30.8486438],[-86.4304716,30.849638]]]}'::jsonb),
      ('B-4','Pig Pasture #4','{"type":"Polygon","coordinates":[[[-86.4302764,30.849641499999997],[-86.4300812,30.849645],[-86.4300458,30.848646600000002],[-86.4302311,30.8486452],[-86.4302764,30.849641499999997]]]}'::jsonb),
      ('B-5','Pig Pasture #4','{"type":"Polygon","coordinates":[[[-86.4300812,30.849645],[-86.42988600000001,30.8496485],[-86.42986049999999,30.848648],[-86.4300458,30.848646600000002],[-86.4300812,30.849645]]]}'::jsonb),
      ('B-6','Pig Pasture #4','{"type":"Polygon","coordinates":[[[-86.42988600000001,30.8496485],[-86.4296908,30.849652],[-86.42967519999999,30.8486494],[-86.42986049999999,30.848648],[-86.42988600000001,30.8496485]]]}'::jsonb),
      ('B-7','Pig Pasture #4','{"type":"Polygon","coordinates":[[[-86.4296908,30.849652],[-86.4294956,30.849655499999997],[-86.4294899,30.8486508],[-86.42967519999999,30.8486494],[-86.4296908,30.849652]]]}'::jsonb),
      ('B-8','Pig Pasture #4','{"type":"Polygon","coordinates":[[[-86.4294956,30.849655499999997],[-86.4293004,30.849659],[-86.4293046,30.8486522],[-86.4294899,30.8486508],[-86.4294956,30.849655499999997]]]}'::jsonb),
      ('B-9','Pig Pasture #4','{"type":"Polygon","coordinates":[[[-86.4293004,30.849659],[-86.42910520000001,30.8496625],[-86.4291193,30.848653600000002],[-86.4293046,30.8486522],[-86.4293004,30.849659]]]}'::jsonb),
      ('B-10','Pig Pasture #4','{"type":"Polygon","coordinates":[[[-86.42910520000001,30.8496625],[-86.42891,30.849666],[-86.428934,30.848655],[-86.4291193,30.848653600000002],[-86.42910520000001,30.8496625]]]}'::jsonb),
      ('C-10','Pig Pasture #1','{"type":"Polygon","coordinates":[[[-86.432994,30.848533],[-86.4327976,30.8485348],[-86.4326749,30.8475175],[-86.432861,30.847516],[-86.432994,30.848533]]]}'::jsonb),
      ('C-9','Pig Pasture #1','{"type":"Polygon","coordinates":[[[-86.4327976,30.8485348],[-86.4326012,30.8485366],[-86.4324888,30.847519],[-86.4326749,30.8475175],[-86.4327976,30.8485348]]]}'::jsonb),
      ('C-8','Pig Pasture #1','{"type":"Polygon","coordinates":[[[-86.4326012,30.8485366],[-86.4324048,30.8485384],[-86.43230270000001,30.847520499999998],[-86.4324888,30.847519],[-86.4326012,30.8485366]]]}'::jsonb),
      ('C-7','Pig Pasture #1','{"type":"Polygon","coordinates":[[[-86.4324048,30.8485384],[-86.4322084,30.8485402],[-86.4321166,30.847521999999998],[-86.43230270000001,30.847520499999998],[-86.4324048,30.8485384]]]}'::jsonb),
      ('C-6','Pig Pasture #1','{"type":"Polygon","coordinates":[[[-86.4322084,30.8485402],[-86.432012,30.848542000000002],[-86.43193049999999,30.8475235],[-86.4321166,30.847521999999998],[-86.4322084,30.8485402]]]}'::jsonb),
      ('C-5','Pig Pasture #1','{"type":"Polygon","coordinates":[[[-86.432012,30.848542000000002],[-86.43181560000001,30.8485438],[-86.4317444,30.847525],[-86.43193049999999,30.8475235],[-86.432012,30.848542000000002]]]}'::jsonb),
      ('C-4','Pig Pasture #1','{"type":"Polygon","coordinates":[[[-86.43181560000001,30.8485438],[-86.4316192,30.8485456],[-86.4315583,30.8475265],[-86.4317444,30.847525],[-86.43181560000001,30.8485438]]]}'::jsonb),
      ('C-3','Pig Pasture #1','{"type":"Polygon","coordinates":[[[-86.4316192,30.8485456],[-86.4314228,30.8485474],[-86.4313722,30.847528],[-86.4315583,30.8475265],[-86.4316192,30.8485456]]]}'::jsonb),
      ('C-2','Pig Pasture #1','{"type":"Polygon","coordinates":[[[-86.4314228,30.8485474],[-86.4312264,30.8485492],[-86.43118609999999,30.8475295],[-86.4313722,30.847528],[-86.4314228,30.8485474]]]}'::jsonb),
      ('C-1','Pig Pasture #1','{"type":"Polygon","coordinates":[[[-86.4312264,30.8485492],[-86.43103,30.848551],[-86.431,30.847531],[-86.43118609999999,30.8475295],[-86.4312264,30.8485492]]]}'::jsonb),
      ('D-1','Pig Pasture #2','{"type":"Polygon","coordinates":[[[-86.430804,30.848549],[-86.4306153,30.8485496],[-86.4306099,30.8475415],[-86.430797,30.847541],[-86.430804,30.848549]]]}'::jsonb),
      ('D-2','Pig Pasture #2','{"type":"Polygon","coordinates":[[[-86.4306153,30.8485496],[-86.43042659999999,30.8485502],[-86.4304228,30.847542],[-86.4306099,30.8475415],[-86.4306153,30.8485496]]]}'::jsonb),
      ('D-3','Pig Pasture #2','{"type":"Polygon","coordinates":[[[-86.43042659999999,30.8485502],[-86.4302379,30.848550799999998],[-86.4302357,30.8475425],[-86.4304228,30.847542],[-86.43042659999999,30.8485502]]]}'::jsonb),
      ('D-4','Pig Pasture #2','{"type":"Polygon","coordinates":[[[-86.4302379,30.848550799999998],[-86.4300492,30.848551399999998],[-86.4300486,30.847543],[-86.4302357,30.8475425],[-86.4302379,30.848550799999998]]]}'::jsonb),
      ('D-5','Pig Pasture #2','{"type":"Polygon","coordinates":[[[-86.4300492,30.848551399999998],[-86.42986049999999,30.848551999999998],[-86.4298615,30.8475435],[-86.4300486,30.847543],[-86.4300492,30.848551399999998]]]}'::jsonb),
      ('D-6','Pig Pasture #2','{"type":"Polygon","coordinates":[[[-86.42986049999999,30.848551999999998],[-86.4296718,30.8485526],[-86.4296744,30.847544],[-86.4298615,30.8475435],[-86.42986049999999,30.848551999999998]]]}'::jsonb),
      ('D-7','Pig Pasture #2','{"type":"Polygon","coordinates":[[[-86.4296718,30.8485526],[-86.4294831,30.8485532],[-86.4294873,30.8475445],[-86.4296744,30.847544],[-86.4296718,30.8485526]]]}'::jsonb),
      ('D-8','Pig Pasture #2','{"type":"Polygon","coordinates":[[[-86.4294831,30.8485532],[-86.4292944,30.8485538],[-86.4293002,30.847545],[-86.4294873,30.8475445],[-86.4294831,30.8485532]]]}'::jsonb),
      ('D-9','Pig Pasture #2','{"type":"Polygon","coordinates":[[[-86.4292944,30.8485538],[-86.4291057,30.8485544],[-86.42911310000001,30.847545500000003],[-86.4293002,30.847545],[-86.4292944,30.8485538]]]}'::jsonb),
      ('D-10','Pig Pasture #2','{"type":"Polygon","coordinates":[[[-86.4291057,30.8485544],[-86.428917,30.848555],[-86.428926,30.847546],[-86.42911310000001,30.847545500000003],[-86.4291057,30.8485544]]]}'::jsonb)
    ) AS t(label, parent_name, geom_json)
  LOOP
    SELECT id INTO v_par FROM public.land_areas
      WHERE name = rec.parent_name AND kind = 'pasture' AND status = 'active' AND deleted_at IS NULL
      LIMIT 1;
    IF v_par IS NULL THEN
      RAISE EXCEPTION 'PM_137: parent pasture % not found', rec.parent_name;
    END IF;

    v_id := 'la-pigpad-' || lower(replace(rec.label, '-', ''));

    -- Idempotent + fail-loud: if the id exists it must already match the expected
    -- shape, else we refuse to mutate it.
    PERFORM 1 FROM public.land_areas WHERE id = v_id;
    IF FOUND THEN
      PERFORM 1 FROM public.land_areas
        WHERE id = v_id AND deleted_at IS NULL AND kind = 'paddock'
          AND permanence = 'permanent' AND parent_id = v_par AND name = rec.label;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'PM_137: existing % conflicts with expected shape; refusing to mutate', v_id;
      END IF;
      CONTINUE;  -- already present and correct
    END IF;

    v_geom := extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(rec.geom_json::text), 4326);
    IF NOT extensions.ST_IsValid(v_geom) THEN
      RAISE EXCEPTION 'PM_137: generated geometry for % is invalid', rec.label;
    END IF;

    INSERT INTO public.land_areas
      (id, parent_id, kind, name, permanence, designation, status, review_status,
       geometry_status, baseline_no_history, source, source_external_id, created_by)
    VALUES
      (v_id, v_par, 'paddock', rec.label, 'permanent', 'feeder_pig', 'active', 'reviewed',
       'none', true, 'drawn', 'pigpad:' || rec.label, NULL);

    PERFORM public._land_area_add_version(
      v_id, v_geom, 'drawn',
      jsonb_build_object('created_via', 'migration_137', 'label', rec.label), NULL);
  END LOOP;

  -- Postcheck: each parent has exactly 10 active permanent paddock children; 40 total.
  FOR rec IN
    SELECT id, name FROM public.land_areas
      WHERE name IN ('Pig Pasture #1','Pig Pasture #2','Pig Pasture #3','Pig Pasture #4')
        AND kind = 'pasture' AND status = 'active' AND deleted_at IS NULL
  LOOP
    SELECT count(*) INTO v_cnt FROM public.land_areas
      WHERE parent_id = rec.id AND kind = 'paddock' AND permanence = 'permanent'
        AND status = 'active' AND deleted_at IS NULL;
    IF v_cnt <> 10 THEN
      RAISE EXCEPTION 'PM_137: parent % has % paddock children (expected 10)', rec.name, v_cnt;
    END IF;
    v_total := v_total + v_cnt;
  END LOOP;
  IF v_total <> 40 THEN
    RAISE EXCEPTION 'PM_137: total permanent paddock children = % (expected 40)', v_total;
  END IF;

  RAISE NOTICE 'PM_137 OK: 40 pig paddocks ensured (idempotent).';
END
$mig137$;
