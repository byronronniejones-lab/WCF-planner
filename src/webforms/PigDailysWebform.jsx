// ============================================================================
// src/webforms/PigDailysWebform.jsx
// ----------------------------------------------------------------------------
// The legacy pig-dailys public webform (routed at /webform).
//
// 2026-04-29 (Phase 1C-B): no-photo submissions flow through the offline
// queue via useOfflineSubmit('pig_dailys'). Photo-attached submissions
// stay fully online-only (Phase 1D photo queue territory) — if either
// the upload or final pig_dailys insert fails, the operator sees an
// explicit "photos need a connection" message and the submission does
// NOT enter IDB. Locked by tests/pig_dailys_offline.spec.js.
// ============================================================================
import React from 'react';
import {sb} from '../lib/supabase.js';
import {useWebformsConfig} from '../contexts/WebformsConfigContext.jsx';
import {availableNamesFor} from '../lib/teamAvailability.js';
import {newClientSubmissionId} from '../lib/clientSubmissionId.js';
import {uploadDailyPhoto, MAX_PHOTOS_PER_REPORT} from '../lib/dailyPhotos.js';
import {useOfflineSubmit} from '../lib/useOfflineSubmit.js';
import DailyPhotoCapture from './DailyPhotoCapture.jsx';
import StuckSubmissionsModal from './StuckSubmissionsModal.jsx';

export default function PigDailysWebform() {
  const {wfGroups, wfRoster, wfAvailability, wfTeamMembers, webformsConfig} = useWebformsConfig();
  // Master roster filtered by `pig-dailys` availability. Falls back to the
  // legacy wfTeamMembers if roster hasn't populated yet (cold-load race).
  const wfPigTeamMembers =
    Array.isArray(wfRoster) && wfRoster.length > 0
      ? availableNamesFor('pig-dailys', wfRoster, wfAvailability)
      : wfTeamMembers || [];

  const [wfPhotos, setWfPhotos] = React.useState([]);
  const [wfPhotoStatuses, setWfPhotoStatuses] = React.useState([]);

  const [wfForm, setWfForm] = React.useState(() => {
    const d = new Date();
    return {
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      teamMember: '',
      batchId: '',
      pigCount: '',
      feedLbs: '',
      groupMoved: true,
      nippleDrinkerMoved: true,
      nippleDrinkerWorking: true,
      troughsMoved: true,
      fenceWalked: true,
      fenceVoltage: '',
      issues: '',
    };
  });
  const [wfSubmitting, setWfSubmitting] = React.useState(false);
  // 'none' | 'synced' | 'queued' — replaces the prior boolean wfDone.
  // synced = row landed in pig_dailys. queued = persisted in IDB; will replay.
  const [wfDoneState, setWfDoneState] = React.useState('none');
  const [wfErr, setWfErr] = React.useState('');
  const [wfGroupName, setWfGroupName] = React.useState('');
  const [wfStuckOpen, setWfStuckOpen] = React.useState(false);

  // Phase 1C-B no-photo offline queue. The hook is mounted here so the
  // background sync (online event + 60s tick) is always live, but submit()
  // is only called from the no-photo branch of wfSubmit.
  const {submit, stuckRows, retryStuck, discardStuck} = useOfflineSubmit('pig_dailys');

  // Open the stuck modal automatically the first time we observe stuck rows.
  // Mirrors FuelSupply / AddFeed pattern.
  const initialStuckShownRef = React.useRef(false);
  React.useEffect(() => {
    if (stuckRows.length > 0 && !initialStuckShownRef.current) {
      initialStuckShownRef.current = true;
      setWfStuckOpen(true);
    }
  }, [stuckRows.length]);

  const wfGroupOptions = wfGroups;

  function wfToggle(field, val) {
    setWfForm((f) => ({...f, [field]: val}));
  }

  // Build a normalized payload from form state. Pure — no side effects.
  // The flat-insert registry consumes this and uses ids minted by the hook
  // for retry-stable replay.
  function buildSubmitPayload() {
    return {
      date: wfForm.date,
      team_member: wfForm.teamMember.trim(),
      batch_id: wfForm.batchId.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      batch_label: wfForm.batchId,
      pig_count: wfForm.pigCount !== '' ? parseInt(wfForm.pigCount) : null,
      feed_lbs: wfForm.feedLbs !== '' ? parseFloat(wfForm.feedLbs) : null,
      group_moved: wfForm.groupMoved,
      nipple_drinker_moved: wfForm.nippleDrinkerMoved,
      nipple_drinker_working: wfForm.nippleDrinkerWorking,
      troughs_moved: wfForm.troughsMoved,
      fence_walked: wfForm.fenceWalked,
      fence_voltage: wfForm.fenceVoltage !== '' ? parseFloat(wfForm.fenceVoltage) : null,
      issues: wfForm.issues.trim() || null,
    };
  }

  async function wfSubmit() {
    // Validate required fields based on webformsConfig. The config shape is
    // `webforms[].sections[].fields[]` — flatten before filtering. The
    // pre-1C-B code referenced `wfCfg.fields` directly, which was undefined
    // under the DEFAULT_WEBFORMS_CONFIG shape (sections-only). Latent
    // ReferenceError that surfaced under the offline-queue test harness
    // when the form path actually exercises submit; fixed inline.
    const wfCfg = webformsConfig?.webforms?.find((w) => w.id === 'pig-dailys');
    const wfRequiredFieldsFlat = wfCfg ? (wfCfg.sections || []).flatMap((s) => s.fields || []) : [];
    const wfRequiredFields = wfRequiredFieldsFlat.filter((f) => f.required && f.enabled !== false);
    if (!wfForm.date) {
      setWfErr('Please enter a date.');
      return;
    }
    if (!wfForm.teamMember.trim()) {
      setWfErr('Please enter your name.');
      return;
    }
    if (!wfForm.batchId) {
      setWfErr('Please select a pig group.');
      return;
    }
    // Check custom required fields
    for (const f of wfRequiredFields) {
      if (f.system) continue; // already checked above
      if (f.id === 'pig_count' && wfForm.pigCount === '') {
        setWfErr(`${f.label} is required.`);
        return;
      }
      if (f.id === 'feed_lbs' && wfForm.feedLbs === '') {
        setWfErr(`${f.label} is required.`);
        return;
      }
      if (f.id === 'fence_voltage' && wfForm.fenceVoltage === '') {
        setWfErr(`${f.label} is required.`);
        return;
      }
      if (f.id === 'issues' && !wfForm.issues.trim()) {
        setWfErr(`${f.label} is required.`);
        return;
      }
    }
    setWfErr('');
    setWfSubmitting(true);
    try {
      localStorage.setItem('wcf_team', wfForm.teamMember.trim());
    } catch (_e) {
      /* localStorage unavailable in some browsers — best effort */
    }

    // Validate the photo count cap upfront — DailyPhotoCapture also enforces
    // it, but a defense-in-depth check catches any future caller mismatch.
    if (wfPhotos.length > MAX_PHOTOS_PER_REPORT) {
      setWfSubmitting(false);
      setWfErr(`Up to ${MAX_PHOTOS_PER_REPORT} photos per submission.`);
      return;
    }

    // ── Photo-attached path (Phase 1D photo queue territory) ──────────
    // Stays fully online-only. Upload-first, insert-after. Failure on
    // EITHER step surfaces the explicit "photos need a connection"
    // message and does NOT enter the offline queue. Locked by Test 4
    // in tests/pig_dailys_offline.spec.js.
    if (wfPhotos.length > 0) {
      const csid = newClientSubmissionId();
      const photoMeta = [];
      setWfPhotoStatuses(wfPhotos.map(() => 'pending'));
      for (let i = 0; i < wfPhotos.length; i++) {
        setWfPhotoStatuses((prev) => prev.map((s, j) => (j === i ? 'uploading' : s)));
        try {
          const m = await uploadDailyPhoto(sb, 'pig_dailys', csid, `photo-${i + 1}`, wfPhotos[i]);
          photoMeta.push(m);
          setWfPhotoStatuses((prev) => prev.map((s, j) => (j === i ? 'uploaded' : s)));
        } catch (e) {
          setWfPhotoStatuses((prev) => prev.map((s, j) => (j === i ? 'failed' : s)));
          setWfSubmitting(false);
          setWfErr(
            `Photo submission could not be saved: ${e?.message || e}. Photo submissions need a connection — remove photos to save offline, or try again.`,
          );
          return;
        }
      }

      const record = {
        id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
        client_submission_id: csid,
        submitted_at: new Date().toISOString(),
        date: wfForm.date,
        team_member: wfForm.teamMember.trim(),
        batch_id: wfForm.batchId.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        batch_label: wfForm.batchId,
        pig_count: wfForm.pigCount !== '' ? parseInt(wfForm.pigCount) : null,
        feed_lbs: wfForm.feedLbs !== '' ? parseFloat(wfForm.feedLbs) : null,
        group_moved: wfForm.groupMoved,
        nipple_drinker_moved: wfForm.nippleDrinkerMoved,
        nipple_drinker_working: wfForm.nippleDrinkerWorking,
        troughs_moved: wfForm.troughsMoved,
        fence_walked: wfForm.fenceWalked,
        fence_voltage: wfForm.fenceVoltage !== '' ? parseFloat(wfForm.fenceVoltage) : null,
        issues: wfForm.issues.trim() || null,
        photos: photoMeta,
      };
      const {error} = await sb.from('pig_dailys').insert(record);
      setWfSubmitting(false);
      if (error) {
        if (photoMeta.length > 0) {
          console.error(
            '[PigDailysWebform] pig_dailys insert failed AFTER photo upload — orphan storage paths:',
            photoMeta.map((p) => p.path),
          );
        }
        setWfErr(
          `Photo submission could not be saved: ${error.message}. Photo submissions need a connection — remove photos to save offline, or try again.`,
        );
        return;
      }
      setWfGroupName(wfForm.batchId);
      setWfPhotos([]);
      setWfPhotoStatuses([]);
      setWfDoneState('synced');
      return;
    }

    // ── No-photo path: route through the offline queue ─────────────────
    try {
      const result = await submit(buildSubmitPayload());
      setWfGroupName(wfForm.batchId);
      setWfDoneState(result.state); // 'synced' | 'queued'
    } catch (e) {
      // useOfflineSubmit throws on schema/validation errors. Surface;
      // do not queue.
      setWfErr('Could not save: ' + (e && e.message ? e.message : String(e)));
    } finally {
      setWfSubmitting(false);
    }
  }

  function wfReset() {
    const d = new Date();
    setWfForm({
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      teamMember: '',
      batchId: '',
      pigCount: '',
      feedLbs: '',
      groupMoved: true,
      nippleDrinkerMoved: true,
      nippleDrinkerWorking: true,
      troughsMoved: true,
      fenceWalked: true,
      fenceVoltage: '',
      issues: '',
    });
    setWfPhotos([]);
    setWfPhotoStatuses([]);
    setWfDoneState('none');
    setWfErr('');
  }

  function wfTgl(label, field) {
    return (
      <div style={{marginBottom: 12}}>
        <label style={{display: 'block', fontSize: 12, color: '#4b5563', marginBottom: 4, fontWeight: 500}}>
          {label}
        </label>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            borderRadius: 6,
            overflow: 'hidden',
            border: '1px solid #d1d5db',
          }}
        >
          {[
            {v: true, l: 'Yes'},
            {v: false, l: 'No'},
          ].map(({v, l}) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => wfToggle(field, v)}
              style={{
                padding: '9px 0',
                border: 'none',
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                background: wfForm[field] === v ? (v ? '#085041' : '#374151') : '#f9fafb',
                color: wfForm[field] === v ? 'white' : '#6b7280',
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const wfCfgFields = (() => {
    const wf = webformsConfig?.webforms?.find((w) => w.id === 'pig-dailys');
    if (!wf) return [];
    return (wf.sections || []).flatMap((s) => s.fields || []);
  })();
  const isReq = (id) => {
    const f = wfCfgFields.find((f) => f.id === id);
    return f ? f.required : ['date', 'team_member', 'group'].includes(id);
  };
  const wfLbl = (text, id) => (
    <label style={{display: 'block', fontSize: 12, color: '#4b5563', marginBottom: 4, fontWeight: 500}}>
      {text}
      {isReq(id) && <span style={{color: '#b91c1c', marginLeft: 2}}>*</span>}
    </label>
  );

  const wfCard = (title, children) => (
    <div
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: 20,
        marginBottom: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,.06)',
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: '#4b5563',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          marginBottom: 14,
          paddingBottom: 10,
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );

  if (wfDoneState !== 'none')
    return (
      <div style={{background: '#f6f8f7', minHeight: '100vh'}}>
        <div
          style={{
            background: 'linear-gradient(135deg,#042f23,#085041 60%,#0d6652)',
            color: 'white',
            padding: '14px 1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
            <div style={{fontSize: 17, fontWeight: 700, letterSpacing: '-.4px'}}>WCF Planner</div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: 'rgba(255,255,255,.6)',
                borderLeft: '1px solid rgba(255,255,255,.25)',
                paddingLeft: 10,
                letterSpacing: 0.5,
              }}
            >
              PIGS
            </span>
          </div>
          <div style={{fontSize: 12, color: 'rgba(255,255,255,.6)'}}>Daily Report</div>
        </div>
        <div style={{maxWidth: 540, margin: '0 auto', padding: '3rem 1rem', textAlign: 'center'}}>
          <div style={{fontSize: 56, marginBottom: 16}}>{wfDoneState === 'queued' ? '📡' : '✅'}</div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              marginBottom: 8,
              color: wfDoneState === 'queued' ? '#92400e' : '#111827',
            }}
          >
            {wfDoneState === 'queued' ? 'Saved on this device' : 'Report submitted!'}
          </div>
          {wfDoneState === 'queued' ? (
            <div
              data-submit-state="queued"
              style={{
                fontSize: 13,
                color: '#78716c',
                marginBottom: 22,
                lineHeight: 1.5,
                background: '#fef3c7',
                border: '1px solid #fde68a',
                borderRadius: 8,
                padding: '10px 14px',
                textAlign: 'left',
              }}
            >
              No connection right now. Daily report queued for <strong>{wfGroupName}</strong> and will sync as soon as
              the device is back online.
            </div>
          ) : (
            <div style={{fontSize: 14, color: '#4b5563', marginBottom: 28}}>
              <span data-submit-state="synced" style={{display: 'none'}}>
                synced
              </span>
              Daily report saved for <strong>{wfGroupName}</strong>.
            </div>
          )}
          <button
            onClick={wfReset}
            style={{
              padding: '10px 28px',
              border: '2px solid #085041',
              borderRadius: 10,
              background: 'white',
              color: '#085041',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Submit another
          </button>
        </div>
      </div>
    );

  return (
    <div style={{background: '#f6f8f7', minHeight: '100vh'}}>
      {/* Header */}
      <div
        style={{
          background: 'linear-gradient(135deg,#042f23,#085041 60%,#0d6652)',
          color: 'white',
          padding: '14px 1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
          <div style={{fontSize: 17, fontWeight: 700, letterSpacing: '-.4px'}}>WCF Planner</div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: 'rgba(255,255,255,.6)',
              borderLeft: '1px solid rgba(255,255,255,.25)',
              paddingLeft: 10,
              letterSpacing: 0.5,
            }}
          >
            PIGS
          </span>
        </div>
        <div style={{fontSize: 12, color: 'rgba(255,255,255,.6)'}}>Daily Report</div>
      </div>

      <div style={{maxWidth: 540, margin: '0 auto', padding: '1.5rem 1rem 3rem'}}>
        <div style={{fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 20, letterSpacing: '-.3px'}}>
          Pig Dailys
        </div>

        {stuckRows.length > 0 && (
          <button
            onClick={() => setWfStuckOpen(true)}
            data-stuck-button="1"
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 10,
              border: '1px solid #fde68a',
              background: '#fef3c7',
              color: '#92400e',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              marginBottom: 12,
              textAlign: 'left',
            }}
          >
            ⚠ {stuckRows.length} unsynced pig daily report{stuckRows.length === 1 ? '' : 's'} — tap to review
          </button>
        )}

        {wfErr && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 6,
              color: '#b91c1c',
              padding: '10px 14px',
              fontSize: 13,
              marginBottom: 14,
            }}
          >
            {wfErr}
          </div>
        )}

        {wfCard(
          'Report Info',
          <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
            <div>
              <label style={{display: 'block', fontSize: 12, color: '#4b5563', marginBottom: 4, fontWeight: 500}}>
                Date{isReq('date') && <span style={{color: '#b91c1c', marginLeft: 2}}>*</span>}
              </label>
              <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
                <input
                  type="date"
                  value={wfForm.date}
                  onChange={(e) => setWfForm({...wfForm, date: e.target.value})}
                  style={{
                    fontFamily: 'inherit',
                    fontSize: 13,
                    padding: '9px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    flex: 1,
                    outline: 'none',
                    background: 'white',
                    color: '#111827',
                  }}
                />
                <span
                  onClick={() => {
                    const d = new Date();
                    setWfForm({
                      ...wfForm,
                      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
                    });
                  }}
                  style={{
                    display: 'inline-block',
                    fontSize: 11,
                    padding: '6px 10px',
                    background: '#ecfdf5',
                    color: '#085041',
                    border: '1px solid #a7f3d0',
                    borderRadius: 6,
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Today
                </span>
              </div>
            </div>
            <div>
              <label style={{display: 'block', fontSize: 12, color: '#4b5563', marginBottom: 4, fontWeight: 500}}>
                Team member{isReq('team_member') && <span style={{color: '#b91c1c', marginLeft: 2}}>*</span>}
              </label>
              {wfPigTeamMembers.length > 0 ? (
                <select
                  value={wfForm.teamMember}
                  onChange={(e) => setWfForm({...wfForm, teamMember: e.target.value})}
                  style={{
                    fontFamily: 'inherit',
                    fontSize: 13,
                    padding: '9px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    width: '100%',
                    outline: 'none',
                    background: 'white',
                    color: wfForm.teamMember ? '#111827' : '#9ca3af',
                  }}
                >
                  <option value="">— Select name —</option>
                  {wfPigTeamMembers.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={wfForm.teamMember}
                  onChange={(e) => setWfForm({...wfForm, teamMember: e.target.value})}
                  placeholder="Your name"
                  style={{
                    fontFamily: 'inherit',
                    fontSize: 13,
                    padding: '9px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    width: '100%',
                    outline: 'none',
                    background: 'white',
                    color: '#111827',
                  }}
                />
              )}
            </div>
            <div>
              <label style={{display: 'block', fontSize: 12, color: '#4b5563', marginBottom: 4, fontWeight: 500}}>
                Pig group{isReq('group') && <span style={{color: '#b91c1c', marginLeft: 2}}>*</span>}
              </label>
              <select
                value={wfForm.batchId}
                onChange={(e) => setWfForm({...wfForm, batchId: e.target.value})}
                style={{
                  fontFamily: 'inherit',
                  fontSize: 13,
                  padding: '9px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  width: '100%',
                  outline: 'none',
                  background: 'white',
                  color: '#111827',
                }}
              >
                <option value="">— Select group —</option>
                {wfGroupOptions.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
          </div>,
        )}

        {wfCard(
          'Count & Feed',
          <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12}}>
            <div>
              <label style={{display: 'block', fontSize: 12, color: '#4b5563', marginBottom: 4, fontWeight: 500}}>
                # Pigs in group{isReq('pig_count') && <span style={{color: '#b91c1c', marginLeft: 2}}>*</span>}
              </label>
              <input
                type="number"
                min="0"
                value={wfForm.pigCount || ''}
                onChange={(e) => setWfForm({...wfForm, pigCount: e.target.value})}
                placeholder="0"
                style={{
                  fontFamily: 'inherit',
                  fontSize: 13,
                  padding: '9px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  width: '100%',
                  outline: 'none',
                  background: 'white',
                }}
              />
              <div style={{fontSize: 11, color: '#9ca3af', marginTop: 3}}>Current headcount</div>
            </div>
            <div>
              <label style={{display: 'block', fontSize: 12, color: '#4b5563', marginBottom: 4, fontWeight: 500}}>
                Feed given (lbs){isReq('feed_lbs') && <span style={{color: '#b91c1c', marginLeft: 2}}>*</span>}
              </label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={wfForm.feedLbs || ''}
                onChange={(e) => setWfForm({...wfForm, feedLbs: e.target.value})}
                placeholder="0"
                style={{
                  fontFamily: 'inherit',
                  fontSize: 13,
                  padding: '9px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  width: '100%',
                  outline: 'none',
                  background: 'white',
                }}
              />
              <div style={{fontSize: 11, color: '#9ca3af', marginTop: 3}}>Total lbs fed today</div>
            </div>
          </div>,
        )}

        {wfCard(
          'Daily Checks',
          <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12}}>
            {wfTgl('Was group moved?', 'groupMoved')}
            {wfTgl('Nipple drinker moved?', 'nippleDrinkerMoved')}
            {wfTgl('Nipple drinker working?', 'nippleDrinkerWorking')}
            {wfTgl('Feed troughs moved?', 'troughsMoved')}
            {wfTgl('Fence line walked?', 'fenceWalked')}
            <div>
              <label style={{display: 'block', fontSize: 12, color: '#4b5563', marginBottom: 4, fontWeight: 500}}>
                Fence voltage (kV){isReq('fence_voltage') && <span style={{color: '#b91c1c', marginLeft: 2}}>*</span>}
              </label>
              <input
                type="number"
                min="0"
                max="20"
                step="0.1"
                value={wfForm.fenceVoltage || ''}
                onChange={(e) => setWfForm({...wfForm, fenceVoltage: e.target.value})}
                placeholder="e.g. 4.2"
                style={{
                  fontFamily: 'inherit',
                  fontSize: 13,
                  padding: '9px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  width: '100%',
                  outline: 'none',
                  background: 'white',
                }}
              />
            </div>
          </div>,
        )}

        {wfCard(
          'Issues & Comments',
          <div>
            <label style={{display: 'block', fontSize: 12, color: '#4b5563', marginBottom: 4, fontWeight: 500}}>
              Notes, issues, observations{isReq('issues') && <span style={{color: '#b91c1c', marginLeft: 2}}>*</span>}
            </label>
            <textarea
              rows={4}
              value={wfForm.issues}
              onChange={(e) => setWfForm({...wfForm, issues: e.target.value})}
              placeholder="Any problems, unusual behavior, health concerns, maintenance needed…"
              style={{
                fontFamily: 'inherit',
                fontSize: 13,
                padding: '9px 12px',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                width: '100%',
                outline: 'none',
                background: 'white',
                resize: 'vertical',
              }}
            />
          </div>,
        )}

        <DailyPhotoCapture files={wfPhotos} statuses={wfPhotoStatuses} onChange={setWfPhotos} disabled={wfSubmitting} />

        <button
          onClick={wfSubmit}
          disabled={wfSubmitting}
          style={{
            width: '100%',
            padding: 13,
            border: 'none',
            borderRadius: 10,
            background: 'linear-gradient(135deg,#085041,#0d6652)',
            color: 'white',
            fontSize: 15,
            fontWeight: 600,
            cursor: wfSubmitting ? 'not-allowed' : 'pointer',
            opacity: wfSubmitting ? 0.6 : 1,
            boxShadow: '0 2px 8px rgba(8,80,65,.25)',
            fontFamily: 'inherit',
          }}
        >
          {wfSubmitting ? 'Submitting…' : 'Submit Daily Report'}
        </button>
      </div>

      {wfStuckOpen && (
        <StuckSubmissionsModal
          rows={stuckRows}
          formLabel="pig daily report"
          describeRow={(row) => {
            // Pull from row.record (authoritative replay object) per Codex
            // amendment #5. Falls back to payload only if record is missing.
            const rec = row.record || row.payload || {};
            const label = rec.batch_label || rec.batch_id || '?';
            const date = rec.date || '?';
            return `${label} · ${date} (not yet sent)`;
          }}
          onRetry={async (csid) => {
            await retryStuck(csid);
          }}
          onDiscard={async (csid) => {
            await discardStuck(csid);
          }}
          onClose={() => setWfStuckOpen(false)}
        />
      )}
    </div>
  );
}
