// Pre-deploy probe — verifies that the `daily-photos` storage bucket
// exists and the mig 031 RLS policies are correctly scoped before any
// runtime cutover that depends on the photo offline queue.
//
// Two contracts:
//   1. anon INSERT  → 200 (mig 031: daily_photos_anon_insert).
//   2. anon SELECT  → 4xx (no policy granting anon SELECT; admin reads via
//                          authenticated signed URLs only).
//
// If both contracts hold the script exits 0. If anon INSERT fails → mig 031
// not deployed (or bucket missing). If anon SELECT succeeds → policy
// mis-scoped (unintentional public-read leak).
//
// Probe key uses a fixed prefix `_probe/<unix_ms>.bin` so service-role
// cleanup is straightforward. Tiny 1-byte payload.
//
// Usage:
//   VITE_SUPABASE_URL=https://… \
//   VITE_SUPABASE_ANON_KEY=… \
//   SUPABASE_SERVICE_ROLE_KEY=…  (optional — used for cleanup) \
//     node scripts/probe_daily_photos_bucket.cjs
//
// SUPABASE_SERVICE_ROLE_KEY is optional: if set, the script removes the
// probe object after verification. Without it the probe object lingers
// under `_probe/`; harmless (uses upsert:true on subsequent runs).

const {createClient} = require('@supabase/supabase-js');

(async () => {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey) {
    console.error('probe_daily_photos_bucket: missing env');
    console.error('Required: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY');
    console.error('Optional: SUPABASE_SERVICE_ROLE_KEY (for cleanup)');
    process.exitCode = 1;
    return;
  }

  const anon = createClient(url, anonKey, {
    auth: {autoRefreshToken: false, persistSession: false},
  });

  console.log(`Probing daily-photos bucket on ${url} ...`);

  // -----------------------------------------------------------------
  // Contract 1: anon INSERT must succeed.
  // -----------------------------------------------------------------
  // Use upsert:false + a unique-per-run path so we always do a fresh INSERT.
  // Anon RLS on `daily-photos` grants INSERT only — upsert:true triggers an
  // UPDATE-policy check that intentionally rejects (mig 031 design). The
  // queue worker uses upsert:false for the same reason; this probe matches.
  const probePath = `_probe/probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.bin`;
  const probeBytes = Buffer.from([0x21]); // single byte
  const ins = await anon.storage
    .from('daily-photos')
    .upload(probePath, probeBytes, {upsert: false, contentType: 'application/octet-stream'});

  if (ins.error) {
    console.error('FAIL — anon INSERT to daily-photos rejected.');
    console.error('Likely cause: mig 031 not applied OR bucket missing OR policy drift.');
    console.error('error:', ins.error);
    process.exitCode = 1;
    return;
  }
  console.log(`OK — anon INSERT succeeded (${probePath}).`);

  // -----------------------------------------------------------------
  // Contract 2: anon SELECT/list must FAIL.
  // -----------------------------------------------------------------
  const list = await anon.storage.from('daily-photos').list('_probe', {limit: 1});
  // supabase-js storage list under denied RLS returns empty data without
  // an explicit error in some versions, OR returns an error object. Both
  // count as "anon SELECT not granted" if no actual file metadata leaks.
  if (list.error) {
    console.log(`OK — anon SELECT correctly denied (${list.error.message}).`);
  } else if (Array.isArray(list.data) && list.data.length === 0) {
    console.log('OK — anon SELECT returns empty (RLS hiding objects, as expected).');
  } else {
    console.error('FAIL — anon SELECT returned object metadata. RLS policy mis-scoped.');
    console.error('list.data:', list.data);
    process.exitCode = 1;
    return;
  }

  // -----------------------------------------------------------------
  // Optional cleanup via service role.
  // -----------------------------------------------------------------
  if (serviceKey) {
    const admin = createClient(url, serviceKey, {
      auth: {autoRefreshToken: false, persistSession: false},
    });
    const rm = await admin.storage.from('daily-photos').remove([probePath]);
    if (rm.error) {
      console.warn(`(cleanup) probe object removal failed: ${rm.error.message}`);
    } else {
      console.log('(cleanup) probe object removed.');
    }
  } else {
    console.log('(cleanup skipped: SUPABASE_SERVICE_ROLE_KEY not set; probe object remains under _probe/)');
  }

  console.log('PASS — daily-photos bucket contracts hold.');
})().catch((e) => {
  console.error('FAIL — unhandled error:');
  console.error(e);
  process.exitCode = 1;
});
