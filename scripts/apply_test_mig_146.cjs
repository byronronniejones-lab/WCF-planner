// Apply mig 146 (Monthly Newsletter CP-B automation: 8 SECDEF RPCs —
// ensure_newsletter_issue, replace_newsletter_harvest_facts,
// get_newsletter_generation_input, apply_newsletter_ai_draft, log_newsletter_run,
// list_newsletter_runs_admin, create_newsletter_reminder_task,
// invoke_newsletter_cron) to TEST via exec_sql. Hard PROD-ref guard.
//
// exec_sql carries no auth context and runs as the function owner, so it CAN
// call the service_role-only RPCs directly; behavior is proven with DO blocks
// that RAISE on a wrong state, then clean up the throwaway 2099-09 issue.
//
// .env.test lives only in the MAIN worktree (gitignored); load it from the
// sibling WCF-planner dir, then any local copy in this worktree.
const fs = require('fs');
const path = require('path');
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotEnv(path.join(__dirname, '..', '..', 'WCF-planner', '.env.test'));
loadDotEnv(path.join(__dirname, '..', '..', 'WCF-planner', '.env.test.local'));
loadDotEnv(path.join(__dirname, '..', '.env.test'));
loadDotEnv(path.join(__dirname, '..', '.env.test.local'));

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROD_REF = 'pzfujbjtayhkdlxiblwe';
if (!url || !key) {
  console.error('missing TEST env (VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  process.exit(2);
}
if (url.includes(PROD_REF)) {
  console.error('refusing to run against PROD url');
  process.exit(2);
}
const file = path.join(__dirname, '..', 'supabase-migrations', '146_newsletter_automation.sql');
const body = fs.readFileSync(file, 'utf8');
const {createClient} = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));
const sb = createClient(url, key, {auth: {autoRefreshToken: false, persistSession: false}});

const FACTS_OK_FORBIDDEN =
  '[{"detectorKey":"broiler_on_farm","program":"broiler","title":"Broilers on the farm","summary":"300 birds","displayValue":"300 birds","confidence":"high","sortOrder":0},' +
  '{"detectorKey":"x_sales","program":"x","title":"Beef sales","summary":"sold 12 head","confidence":"high","sortOrder":1}]';
const FACTS_REHARVEST =
  '[{"detectorKey":"broiler_on_farm","program":"broiler","title":"Broilers on the farm","summary":"310 birds","displayValue":"310 birds","confidence":"high","sortOrder":0}]';

(async () => {
  console.log(`TEST url=${url}`);

  // Precheck: mig 146 depends on mig 144 (tables + _newsletter_issue_summary).
  const {error: preErr} = await sb.rpc('exec_sql', {
    sql: `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                     WHERE n.nspname='public' AND p.proname='_newsletter_issue_summary')
      THEN RAISE EXCEPTION 'mig 144 not present on TEST — apply 144/145 first'; END IF;
    END $$;`,
  });
  if (preErr) {
    console.error('PRECHECK failed:', preErr.message || preErr);
    process.exit(1);
  }
  console.log('precheck OK (mig 144 present)');

  console.log(`applying 146 body (${body.length} bytes)`);
  const {error} = await sb.rpc('exec_sql', {sql: body});
  if (error) {
    console.error('exec_sql APPLY failed:', error.message || error);
    process.exit(1);
  }
  console.log('apply OK');

  const smokes = [
    {
      label: 'all 8 automation functions exist + SECURITY DEFINER',
      sql: `DO $$ DECLARE fn text; BEGIN
        FOREACH fn IN ARRAY ARRAY['ensure_newsletter_issue','replace_newsletter_harvest_facts',
          'get_newsletter_generation_input','apply_newsletter_ai_draft','log_newsletter_run',
          'list_newsletter_runs_admin','create_newsletter_reminder_task','invoke_newsletter_cron'] LOOP
          IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                          WHERE n.nspname='public' AND p.proname=fn AND p.prosecdef)
          THEN RAISE EXCEPTION '% missing or not SECDEF', fn; END IF;
        END LOOP;
      END $$;`,
    },
    {
      label: 'ingest RPCs are service_role-only; list_runs is authenticated-only; nothing leaks to anon',
      sql: `DO $$ DECLARE fn text; BEGIN
        FOREACH fn IN ARRAY ARRAY['ensure_newsletter_issue','replace_newsletter_harvest_facts',
          'get_newsletter_generation_input','apply_newsletter_ai_draft','log_newsletter_run',
          'create_newsletter_reminder_task'] LOOP
          IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
                      WHERE routine_schema='public' AND routine_name=fn
                            AND grantee IN ('anon','authenticated','PUBLIC'))
          THEN RAISE EXCEPTION '% leaks EXECUTE to anon/authenticated/PUBLIC', fn; END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.routine_privileges
                          WHERE routine_schema='public' AND routine_name=fn
                                AND grantee='service_role' AND privilege_type='EXECUTE')
          THEN RAISE EXCEPTION '% missing service_role EXECUTE', fn; END IF;
        END LOOP;
        IF NOT EXISTS (SELECT 1 FROM information_schema.routine_privileges
                        WHERE routine_schema='public' AND routine_name='list_newsletter_runs_admin'
                              AND grantee='authenticated' AND privilege_type='EXECUTE')
        THEN RAISE EXCEPTION 'list_newsletter_runs_admin missing authenticated EXECUTE'; END IF;
        IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
                    WHERE routine_schema='public' AND routine_name IN ('list_newsletter_runs_admin','invoke_newsletter_cron')
                          AND grantee IN ('anon','PUBLIC'))
        THEN RAISE EXCEPTION 'admin/cron RPC leaks to anon'; END IF;
      END $$;`,
    },
    {
      label: 'ensure_newsletter_issue creates + is idempotent',
      sql: `DO $$ DECLARE v_id text; v_cnt int; BEGIN
        DELETE FROM public.newsletter_issues WHERE id='nli-2099-09';
        v_id := public.ensure_newsletter_issue('2099-09');
        IF v_id <> 'nli-2099-09' THEN RAISE EXCEPTION 'ensure returned %', v_id; END IF;
        PERFORM public.ensure_newsletter_issue('2099-09');
        SELECT count(*) INTO v_cnt FROM public.newsletter_issues WHERE id='nli-2099-09';
        IF v_cnt <> 1 THEN RAISE EXCEPTION 'expected 1 issue, got %', v_cnt; END IF;
      END $$;`,
    },
    {
      label: 'replace_newsletter_harvest_facts drops forbidden + preserves included on re-harvest',
      sql: `DO $$ DECLARE v_cnt int; v_inc boolean; BEGIN
        PERFORM public.replace_newsletter_harvest_facts('nli-2099-09', '${FACTS_OK_FORBIDDEN}'::jsonb);
        SELECT count(*) INTO v_cnt FROM public.newsletter_fact_candidates
          WHERE issue_id='nli-2099-09' AND NOT is_manual;
        IF v_cnt <> 1 THEN RAISE EXCEPTION 'forbidden fact not dropped (got % facts)', v_cnt; END IF;
        UPDATE public.newsletter_fact_candidates SET included=false
          WHERE issue_id='nli-2099-09' AND detector_key='broiler_on_farm';
        PERFORM public.replace_newsletter_harvest_facts('nli-2099-09', '${FACTS_REHARVEST}'::jsonb);
        SELECT included INTO v_inc FROM public.newsletter_fact_candidates
          WHERE issue_id='nli-2099-09' AND detector_key='broiler_on_farm';
        IF v_inc IS NOT FALSE THEN RAISE EXCEPTION 'included not preserved on re-harvest: %', v_inc; END IF;
      END $$;`,
    },
    {
      label: 'get_newsletter_generation_input returns issue + included facts',
      sql: `DO $$ DECLARE v jsonb; BEGIN
        UPDATE public.newsletter_fact_candidates SET included=true WHERE issue_id='nli-2099-09';
        v := public.get_newsletter_generation_input('nli-2099-09');
        IF v->'issue'->>'id' <> 'nli-2099-09' THEN RAISE EXCEPTION 'gen input wrong issue'; END IF;
        IF jsonb_array_length(v->'facts') < 1 THEN RAISE EXCEPTION 'gen input has no included facts'; END IF;
      END $$;`,
    },
    {
      label: 'apply_newsletter_ai_draft writes blocks; non-overwrite never clobbers',
      sql: `DO $$ DECLARE v_len int; BEGIN
        PERFORM public.apply_newsletter_ai_draft('nli-2099-09',
          '{"blocks":[{"type":"heading","text":"Hi"}]}'::jsonb, 'template', NULL, true);
        SELECT jsonb_array_length(draft_payload->'blocks') INTO v_len
          FROM public.newsletter_issues WHERE id='nli-2099-09';
        IF v_len <> 1 THEN RAISE EXCEPTION 'expected 1 draft block, got %', v_len; END IF;
        PERFORM public.apply_newsletter_ai_draft('nli-2099-09',
          '{"blocks":[{"type":"paragraph","text":"A"},{"type":"divider"}]}'::jsonb, 'template', NULL, false);
        SELECT jsonb_array_length(draft_payload->'blocks') INTO v_len
          FROM public.newsletter_issues WHERE id='nli-2099-09';
        IF v_len <> 1 THEN RAISE EXCEPTION 'non-overwrite clobbered draft (len %)', v_len; END IF;
      END $$;`,
    },
    {
      label:
        'create_newsletter_reminder_task: configured assignee -> designation=system, idempotent; no assignee -> no-op',
      sql: `DO $$ DECLARE v jsonb; v_profile uuid; v_desig text; v_cnt int; BEGIN
        SELECT id INTO v_profile FROM public.profiles LIMIT 1;
        IF v_profile IS NULL THEN RAISE EXCEPTION 'no profile available for reminder smoke'; END IF;
        DELETE FROM public.task_instances WHERE client_submission_id IN ('nl-reminder-2099-09','nl-reminder-2099-08');

        -- Configured assignee: creates one system-designated reminder.
        UPDATE public.newsletter_settings SET task_assignee_profile_id=v_profile WHERE id='singleton';
        v := public.create_newsletter_reminder_task('2099-09');
        IF (v->>'created')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'reminder not created with assignee: %', v; END IF;
        SELECT designation INTO v_desig FROM public.task_instances WHERE client_submission_id='nl-reminder-2099-09';
        IF v_desig <> 'system' THEN RAISE EXCEPTION 'reminder designation not system: %', v_desig; END IF;

        -- Idempotent: a second call creates nothing, leaving exactly one row.
        v := public.create_newsletter_reminder_task('2099-09');
        IF (v->>'created')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'reminder not idempotent: %', v; END IF;
        SELECT count(*) INTO v_cnt FROM public.task_instances WHERE client_submission_id='nl-reminder-2099-09';
        IF v_cnt <> 1 THEN RAISE EXCEPTION 'expected exactly 1 reminder row, got %', v_cnt; END IF;

        -- No assignee: no-op, no row written.
        UPDATE public.newsletter_settings SET task_assignee_profile_id=NULL WHERE id='singleton';
        v := public.create_newsletter_reminder_task('2099-08');
        IF (v->>'created')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'reminder should no-op without assignee: %', v; END IF;
        IF EXISTS (SELECT 1 FROM public.task_instances WHERE client_submission_id='nl-reminder-2099-08')
        THEN RAISE EXCEPTION 'no-op reminder wrote a row'; END IF;

        -- Cleanup the smoke task row.
        DELETE FROM public.task_instances WHERE client_submission_id='nl-reminder-2099-09';
      END $$;`,
    },
    {
      label: 'log_newsletter_run inserts an audit row',
      sql: `DO $$ DECLARE v_id text; v_cnt int; BEGIN
        v_id := public.log_newsletter_run('nli-2099-09','harvest','template',NULL,'ok',NULL,NULL);
        IF v_id IS NULL THEN RAISE EXCEPTION 'log_newsletter_run returned null'; END IF;
        SELECT count(*) INTO v_cnt FROM public.newsletter_runs WHERE issue_id='nli-2099-09';
        IF v_cnt < 1 THEN RAISE EXCEPTION 'no run row'; END IF;
      END $$;`,
    },
    {
      label: 'cleanup throwaway 2099-09 issue (cascades facts + runs)',
      sql: `DO $$ BEGIN DELETE FROM public.newsletter_issues WHERE id='nli-2099-09'; END $$;`,
    },
  ];

  let allOk = true;
  for (const s of smokes) {
    const {error: e2} = await sb.rpc('exec_sql', {sql: s.sql});
    if (e2) allOk = false;
    console.log(`  smoke ${s.label}: ${e2 ? 'ERROR ' + (e2.message || e2) : 'OK'}`);
  }
  console.log(allOk ? 'done OK' : 'done WITH ERRORS');
  if (!allOk) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
