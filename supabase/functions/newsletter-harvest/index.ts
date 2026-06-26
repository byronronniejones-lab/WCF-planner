// ============================================================================
// supabase/functions/newsletter-harvest — Monthly Newsletter CP-B automation.
// ----------------------------------------------------------------------------
// Deploy:
//   supabase functions deploy newsletter-harvest --project-ref <project-ref>
//
// Two callers (mirrors tasks-cron, plan-locked):
//   1. cron  — pg_cron's monthly job invokes public.invoke_newsletter_cron()
//      (mig 146) which reads three Vault secrets and POSTs:
//        Authorization: Bearer <NEWSLETTER_CRON_SERVICE_ROLE_KEY>
//        x-cron-secret: <NEWSLETTER_CRON_SECRET>
//        body: {"mode":"cron"}
//      Cron pre-seeds the current month's issue: ensure issue, harvest facts,
//      mint the coordinated reminder task, and pre-fill the draft WITHOUT
//      clobbering admin edits (overwrite=false).
//   2. admin — the /admin/newsletter "Harvest" / "Generate draft" buttons call
//      sb.functions.invoke('newsletter-harvest', {body:{mode:'admin', issueId,
//      steps:['harvest'|'draft'], overwrite}}). The caller's user JWT is in
//      Authorization; the function verifies admin via rpc('is_admin').
//
// Auth boundary (in order):
//   - cron mode: Authorization === NEWSLETTER_CRON_SERVICE_ROLE_KEY AND
//     x-cron-secret === NEWSLETTER_CRON_SECRET (length-then-byte compare).
//   - admin mode: rpc('is_admin') on the caller JWT returns strict true.
//   - anything else → 401, no work, no audit row.
//
// AI boundary: the provider API key (NEWSLETTER_AI_API_KEY) lives ONLY here,
// never in the browser. The model returns STRUCTURED blocks; output is run
// through validateNewsletterBlocks (shared whitelist) before persistence, so no
// raw HTML / unknown block type can reach the public page. When no key is set,
// the deterministic template composer produces a valid draft so the whole flow
// is testable + shippable without a paid key (run is logged with provider
// 'template'). Detector + composer logic is the byte-identical shared copy in
// ../_shared (parity-locked to src/lib).
//
// All writes go through the mig 146 SECURITY DEFINER RPCs (service_role grant);
// this function never raw-writes the newsletter_* tables.
// ============================================================================

import {serve} from 'https://deno.land/std@0.168.0/http/server.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {detectNewsletterFacts} from '../_shared/newsletterFacts.js';
import {composeTemplateDraft, validateNewsletterBlocks, buildNewsletterPrompt} from '../_shared/newsletterDraft.js';
import {cronAuthOk} from '../_shared/newsletterCronAuth.js';

function envTrim(name: string): string {
  return (Deno.env.get(name) ?? '').replace(/^\s+|\s+$/g, '');
}
const SUPABASE_URL = envTrim('SUPABASE_URL');
const SUPABASE_ANON_KEY = envTrim('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = envTrim('SUPABASE_SERVICE_ROLE_KEY');
const NEWSLETTER_CRON_SECRET = envTrim('NEWSLETTER_CRON_SECRET');
const NEWSLETTER_CRON_SERVICE_ROLE_KEY = envTrim('NEWSLETTER_CRON_SERVICE_ROLE_KEY');
// The AI provider seam. Absent on TEST/PROD until the secret is added → the
// function falls back to the deterministic template composer (release blocker:
// add NEWSLETTER_AI_API_KEY + set settings.ai_provider/model to enable real AI).
const NEWSLETTER_AI_API_KEY = envTrim('NEWSLETTER_AI_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {...corsHeaders, 'Content-Type': 'application/json'},
  });
}

function extractBearer(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const trimmed = authHeader.trim();
  if (trimmed.toLowerCase().startsWith('bearer ')) return trimmed.slice(7).trim();
  return trimmed;
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

// Current farm-reporting month in UTC ('YYYY-MM'). The cron fires on the 25th,
// so "this month" is the month being reviewed; the admin finalizes early next
// month and can re-harvest after month end.
function currentYearMonthUTC(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}`;
}

function periodBounds(yearMonth: string): {yearMonth: string; start: string; end: string} {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!m) return {yearMonth, start: '', end: ''};
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const start = `${y}-${pad2(mo)}-01`;
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate(); // day 0 of next month = last day
  const end = `${y}-${pad2(mo)}-${pad2(lastDay)}`;
  return {yearMonth, start, end};
}

// ─── Auth ──────────────────────────────────────────────────────────────────

async function authenticateCron(req: Request, mode: string): Promise<boolean> {
  if (mode !== 'cron') return false;
  const bearer = extractBearer(req.headers.get('authorization'));
  const cronSecret = (req.headers.get('x-cron-secret') ?? '').replace(/^\s+|\s+$/g, '');
  // Fails closed when either NEWSLETTER_CRON_* secret is unconfigured (empty),
  // so empty env secrets + empty/blank headers can never authenticate.
  return cronAuthOk(bearer, cronSecret, NEWSLETTER_CRON_SERVICE_ROLE_KEY, NEWSLETTER_CRON_SECRET);
}

async function authenticateAdmin(req: Request, mode: string): Promise<boolean> {
  if (mode !== 'admin') return false;
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {persistSession: false, autoRefreshToken: false},
    global: {headers: {Authorization: authHeader}},
  });
  const {data, error} = await userClient.rpc('is_admin');
  if (error) return false;
  return data === true;
}

// ─── Harvest data assembly ───────────────────────────────────────────────────
// Reads the operational sources the detectors need. Broiler + pig live in
// app_store (ppp-* keys, same as tasks-cron). Cattle/sheep/layer detectors are
// built + unit-tested but their live data-source wiring is a documented
// follow-up (their storage shape needs confirmation); they receive [] here and
// simply emit nothing until wired.
const HARVEST_APP_STORE_KEYS = ['ppp-v4', 'ppp-feeders-v1', 'ppp-farrowing-v1'];

async function assembleHarvestInput(
  svc: ReturnType<typeof createClient>,
  period: {yearMonth: string; start: string; end: string},
): Promise<Record<string, unknown>> {
  const {data: rows, error} = await svc.from('app_store').select('key, data').in('key', HARVEST_APP_STORE_KEYS);
  if (error) throw new Error(`select app_store: ${error.message}`);
  const store = new Map<string, unknown>();
  for (const r of rows || []) store.set(r.key, r.data);
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    period,
    broilerBatches: arr(store.get('ppp-v4')),
    pigFeederGroups: arr(store.get('ppp-feeders-v1')),
    pigFarrowings: arr(store.get('ppp-farrowing-v1')),
    cattleHerds: [],
    cattleBirths: [],
    sheepFlocks: [],
    sheepBirths: [],
    layerProduction: [],
  };
}

// ─── AI provider seam ────────────────────────────────────────────────────────
// Only 'anthropic' is wired. Returns {blocks} (still re-validated by the caller)
// or null when no key/provider is configured, so the caller falls back to the
// deterministic template composer.
async function callAiProvider(opts: {
  provider: string;
  model: string;
  prompt: string;
}): Promise<{blocks: unknown[]} | null> {
  if (!NEWSLETTER_AI_API_KEY) return null;
  if (opts.provider !== 'anthropic') return null;
  const model = opts.model || 'claude-opus-4-8';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': NEWSLETTER_AI_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      messages: [{role: 'user', content: opts.prompt}],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = Array.isArray(data?.content) ? data.content.map((c: {text?: string}) => c?.text || '').join('') : '';
  // The model is instructed to return ONLY a {"blocks":[...]} JSON object; parse
  // defensively (extract the first {...} span) and let validateNewsletterBlocks
  // drop anything that isn't a whitelisted block.
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error('anthropic: no JSON object in response');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch (_e) {
    throw new Error('anthropic: response was not valid JSON');
  }
  const blocks =
    parsed && typeof parsed === 'object' && Array.isArray((parsed as {blocks?: unknown[]}).blocks)
      ? (parsed as {blocks: unknown[]}).blocks
      : [];
  return {blocks};
}

// ─── Steps ───────────────────────────────────────────────────────────────────

async function runHarvest(
  svc: ReturnType<typeof createClient>,
  issueId: string,
  yearMonth: string,
): Promise<{factCount: number}> {
  const {data: issueRow, error: issErr} = await svc
    .from('newsletter_issues')
    .select('year_month, period_start, period_end')
    .eq('id', issueId)
    .single();
  if (issErr) throw new Error(`load issue: ${issErr.message}`);
  const period = {
    yearMonth: issueRow?.year_month || yearMonth,
    start: String(issueRow?.period_start || periodBounds(yearMonth).start),
    end: String(issueRow?.period_end || periodBounds(yearMonth).end),
  };

  const input = await assembleHarvestInput(svc, period);
  const facts = detectNewsletterFacts(input);
  const {error: repErr} = await svc.rpc('replace_newsletter_harvest_facts', {
    p_issue_id: issueId,
    p_facts: facts,
  });
  if (repErr) throw new Error(`replace_newsletter_harvest_facts: ${repErr.message}`);
  await svc.rpc('log_newsletter_run', {p_issue_id: issueId, p_run_type: 'harvest', p_status: 'ok'});
  return {factCount: facts.length};
}

async function runDraft(
  svc: ReturnType<typeof createClient>,
  issueId: string,
  overwrite: boolean,
): Promise<{provider: string; blockCount: number}> {
  const {data: input, error: inErr} = await svc.rpc('get_newsletter_generation_input', {p_issue_id: issueId});
  if (inErr) throw new Error(`get_newsletter_generation_input: ${inErr.message}`);
  const settings = (input && input.settings) || {};
  const provider = String(settings.aiProvider || 'template');
  const model = String(settings.aiModel || '');

  let payload: {blocks: unknown[]};
  let providerUsed = provider;
  try {
    const aiResult = await callAiProvider({
      provider,
      model,
      prompt: buildNewsletterPrompt({...input, tone: settings.tone}),
    });
    if (aiResult) {
      payload = validateNewsletterBlocks(aiResult);
    } else {
      payload = composeTemplateDraft(input);
      providerUsed = 'template';
    }
  } catch (e) {
    // A provider failure must never block the issue: fall back to the template
    // composer and record the provider error on the run.
    payload = composeTemplateDraft(input);
    providerUsed = 'template';
    await svc.rpc('log_newsletter_run', {
      p_issue_id: issueId,
      p_run_type: 'ai_draft',
      p_provider: provider,
      p_model: model,
      p_status: 'error',
      p_error: e instanceof Error ? e.message : String(e),
    });
  }

  const {error: applyErr} = await svc.rpc('apply_newsletter_ai_draft', {
    p_issue_id: issueId,
    p_payload: payload,
    p_provider: providerUsed,
    p_model: model || null,
    p_overwrite: overwrite,
  });
  if (applyErr) throw new Error(`apply_newsletter_ai_draft: ${applyErr.message}`);
  await svc.rpc('log_newsletter_run', {
    p_issue_id: issueId,
    p_run_type: 'ai_draft',
    p_provider: providerUsed,
    p_model: model || null,
    p_status: 'ok',
  });
  return {provider: providerUsed, blockCount: payload.blocks.length};
}

// ─── Main handler ────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders});
  if (req.method !== 'POST') return jsonResponse({ok: false, error: 'method not allowed'}, 405);

  let body: {
    mode?: string;
    issueId?: string;
    yearMonth?: string;
    steps?: string[];
    overwrite?: boolean;
    probe?: boolean;
  } = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch (_e) {
    return jsonResponse({ok: false, error: 'invalid json body'}, 400);
  }

  const mode = String(body.mode || '').toLowerCase();
  if (mode !== 'cron' && mode !== 'admin') {
    return jsonResponse({ok: false, error: 'mode required: cron | admin'}, 400);
  }

  const authed = mode === 'cron' ? await authenticateCron(req, mode) : await authenticateAdmin(req, mode);
  if (!authed) return jsonResponse({ok: false, error: 'unauthorized'}, 401);

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {persistSession: false, autoRefreshToken: false},
  });

  if (body.probe === true) return jsonResponse({ok: true, probe: true, run_mode: mode});

  try {
    const result: Record<string, unknown> = {ok: true, mode};

    if (mode === 'cron') {
      // Coordinated monthly pre-seed for the current month.
      const yearMonth = currentYearMonthUTC();
      const {data: issueId, error: ensErr} = await svc.rpc('ensure_newsletter_issue', {p_year_month: yearMonth});
      if (ensErr) throw new Error(`ensure_newsletter_issue: ${ensErr.message}`);
      result.issueId = issueId;
      result.yearMonth = yearMonth;
      result.harvest = await runHarvest(svc, issueId as string, yearMonth);
      result.draft = await runDraft(svc, issueId as string, false); // never clobber admin edits
      const {data: reminder} = await svc.rpc('create_newsletter_reminder_task', {p_year_month: yearMonth});
      result.reminder = reminder;
      await svc.rpc('log_newsletter_run', {p_issue_id: issueId, p_run_type: 'task_create', p_status: 'ok'});
      return jsonResponse(result);
    }

    // admin mode — operate on an explicit issue (or ensure from a month).
    let issueId = String(body.issueId || '');
    const yearMonth = String(body.yearMonth || '');
    if (!issueId) {
      if (!yearMonth) return jsonResponse({ok: false, error: 'issueId or yearMonth required'}, 400);
      const {data: ensured, error: ensErr} = await svc.rpc('ensure_newsletter_issue', {p_year_month: yearMonth});
      if (ensErr) throw new Error(`ensure_newsletter_issue: ${ensErr.message}`);
      issueId = ensured as string;
    }
    result.issueId = issueId;

    const steps = Array.isArray(body.steps) && body.steps.length ? body.steps : ['harvest', 'draft'];
    if (steps.includes('harvest')) result.harvest = await runHarvest(svc, issueId, yearMonth);
    if (steps.includes('draft')) result.draft = await runDraft(svc, issueId, body.overwrite !== false);
    return jsonResponse(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ok: false, error: msg}, 500);
  }
});
