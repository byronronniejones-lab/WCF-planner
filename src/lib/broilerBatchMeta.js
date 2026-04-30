// Broiler batch public-mirror helper.
//
// Single source of truth for the public-anon broiler weigh-in form's batch
// list + per-batch schooner labels, mirrored from the admin app_store ppp-v4
// rows into webform_config so the public form never needs anon SELECT on
// app_store. Shared by:
//   - src/main.jsx (mirror writer at app load + inside syncWebformConfig)
//   - src/webforms/WeighInsWebform.jsx (column labels for the broiler grid)
//
// Filter contract: status === 'active'. Public broiler weigh-ins are for
// active batches only (Ronnie 2026-04-30 follow-up after a planned batch
// surfaced in the public dropdown post-rollout). Empty-schooner handling
// remains — an active batch with no schooners still surfaces in the
// dropdown and blocks Start Session via deriveBroilerColumnLabels = [].

export function splitSchooners(raw) {
  return String(raw || '')
    .split('&')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildBroilerPublicMirror(batchRows) {
  const active = (batchRows || []).filter((b) => b && b.status === 'active');
  return {
    groups: active.map((b) => b.name),
    meta: active.map((b) => ({name: b.name, schooners: splitSchooners(b.schooner)})),
  };
}

export function deriveBroilerColumnLabels(meta, batchId) {
  const list = Array.isArray(meta) ? meta : [];
  const rec = list.find((b) => b && b.name === batchId);
  if (!rec || !Array.isArray(rec.schooners)) return [];
  return rec.schooners.filter(Boolean);
}
