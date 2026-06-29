// Admin Monthly Newsletter workspace (/admin/newsletter, admin-only via the
// route-level UnauthorizedRedirect guard in main.jsx). Autopilot rebuild:
//   - The current month's issue is surfaced up front with ONE primary action,
//     "Prepare issue", that harvests planner facts AND generates a draft in a
//     single server pass (the newsletter-harvest Edge Function).
//   - A Newsletter Brief (ranked highlights + why + evidence, repetition
//     warnings vs recent issues, photo gaps, honest source coverage, and a
//     publish-readiness checklist) lets Ronnie review/approve rather than hunt
//     for the story. The brief is assembled in newsletterBrief.js from data this
//     view already fetches.
//   - Settings are real controls (provider/model/tone/length/photos/context).
// Every read/write still goes through newsletterApi (the SECDEF RPCs); this view
// never touches the newsletter_* tables directly, creates no Supabase client,
// and renders only structured blocks (no raw HTML).
//
// Photo consent: uploads land in the PRIVATE staging bucket and show via a
// short-lived signed URL until the admin APPROVES, which copies bytes into the
// PUBLIC bucket. Only approved photos appear on the public page. A suggested
// photo subject is not consent — approval is.

import React from 'react';
import {sb} from '../lib/supabase.js';
// eslint-disable-next-line no-unused-vars -- JSX-only use
import InlineNotice from '../shared/InlineNotice.jsx';
// eslint-disable-next-line no-unused-vars -- JSX-only use
import NewsletterBlocks from './NewsletterBlocks.jsx';
import {NEWSLETTER_TONE_PRESETS, NEWSLETTER_LENGTH_PRESETS} from '../lib/newsletterDraft.js';
import {assembleNewsletterBrief} from '../lib/newsletterBrief.js';
import {placePlannedPhotos, pendingPlacementCount} from '../lib/newsletterPhotoPlan.js';
import {
  listNewsletterIssuesAdmin,
  getNewsletterIssueAdmin,
  createNewsletterIssue,
  saveNewsletterDraft,
  saveNewsletterIntake,
  setNewsletterFactIncluded,
  addNewsletterManualFact,
  registerNewsletterPhoto,
  updateNewsletterPhoto,
  setNewsletterCover,
  approveNewsletterPhoto,
  unapproveNewsletterPhoto,
  removeNewsletterPhoto,
  publishNewsletterIssue,
  unpublishNewsletterIssue,
  regenerateNewsletterPreviewToken,
  getNewsletterSettings,
  updateNewsletterSettings,
  gatherNewsletterFacts,
  regenerateNewsletterDraft,
  setNewsletterPhotoPlanSlot,
  getNewsletterRecentPublishedAdmin,
  probeNewsletterAi,
  listNewsletterRunsAdmin,
  uploadNewsletterStagingPhoto,
  getNewsletterStagingSignedUrl,
  newsletterPublicPhotoUrl,
  generateNewsletterPhotoToken,
  buildNewsletterIssuePath,
  buildNewsletterPreviewPath,
  formatYearMonth,
  currentYearMonth,
  friendlyNewsletterError,
} from '../lib/newsletterApi.js';
import './newsletterAdmin.css';

const {useState, useEffect, useCallback, useRef, useMemo} = React;

// Fixed monthly intake questions (events the planner data may not capture).
const INTAKE_QUESTIONS = [
  {key: 'highlights', label: 'Standout moments this month (anything noteworthy the data might miss)?'},
  {key: 'milestones', label: 'Milestones or firsts (a new record, a finished project, a visit)?'},
  {key: 'people', label: 'People to recognize (first names are OK)?'},
  {key: 'photoIdeas', label: 'Photo ideas — what moments are worth showing?'},
  {key: 'avoid', label: 'Anything to keep OUT of this issue?'},
];

// Supported AI models (the Edge Function defaults to Opus 4.8 when unset).
const AI_MODELS = [
  {value: 'claude-opus-4-8', label: 'Claude Opus 4.8 — most capable'},
  {value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — balanced'},
  {value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fast'},
];
const TONE_PRESET_LABELS = {
  warm_credible: 'Warm & credible',
  concise_professional: 'Concise & professional',
  celebratory: 'Celebratory',
  folksy: 'Folksy & personal',
};
const LENGTH_LABELS = {
  brief: 'Brief (~1 page)',
  standard: 'Standard (~2 pages)',
  detailed: 'Detailed (2–3 pages)',
};
const COVERAGE_STATUS_LABEL = {
  scanned: 'scanned',
  empty: 'empty',
  unavailable: 'unavailable',
  error: 'error',
};

// eslint-disable-next-line no-unused-vars -- JSX-only use
function StatusBadge({status}) {
  const cls = status === 'published' ? 'nla-badge nla-badge-pub' : 'nla-badge nla-badge-draft';
  return <span className={cls}>{status === 'published' ? 'Published' : 'Draft'}</span>;
}

// ── Photo card ───────────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars -- JSX-only use
function PhotoCard({photo, thumbUrl, onApprove, onUnapprove, onCover, onRemove, onSaveMeta, busy}) {
  const [caption, setCaption] = useState(photo.caption || '');
  const [altText, setAltText] = useState(photo.altText || '');
  const [credit, setCredit] = useState(photo.creditFirstName || '');
  useEffect(() => {
    setCaption(photo.caption || '');
    setAltText(photo.altText || '');
    setCredit(photo.creditFirstName || '');
  }, [photo.id, photo.caption, photo.altText, photo.creditFirstName]);

  return (
    <div className="nla-photo-card">
      <div className="nla-photo-thumb">
        {thumbUrl ? <img src={thumbUrl} alt={altText || caption || 'photo'} /> : <span className="nla-muted">…</span>}
        <span className={`nla-badge ${photo.approved ? 'nla-badge-pub' : 'nla-badge-draft'}`}>
          {photo.approved ? 'Approved' : 'Staged'}
        </span>
        {photo.isCover && <span className="nla-badge nla-badge-cover">Cover</span>}
      </div>
      <input className="nla-input" value={caption} placeholder="Caption" onChange={(e) => setCaption(e.target.value)} />
      <input
        className="nla-input"
        value={altText}
        placeholder="Alt text"
        onChange={(e) => setAltText(e.target.value)}
      />
      <input
        className="nla-input"
        value={credit}
        placeholder="Photo credit (first name)"
        onChange={(e) => setCredit(e.target.value)}
      />
      <div className="nla-photo-actions">
        <button
          type="button"
          className="nla-btn-sm"
          disabled={busy}
          onClick={() => onSaveMeta(photo, {caption, altText, firstName: credit})}
        >
          Save
        </button>
        {photo.approved ? (
          <button type="button" className="nla-btn-sm" disabled={busy} onClick={() => onUnapprove(photo)}>
            Unapprove
          </button>
        ) : (
          <button type="button" className="nla-btn-sm nla-btn-primary" disabled={busy} onClick={() => onApprove(photo)}>
            Approve
          </button>
        )}
        <button
          type="button"
          className="nla-btn-sm"
          disabled={busy || !photo.approved || photo.isCover}
          onClick={() => onCover(photo)}
          title={photo.approved ? '' : 'Approve first'}
        >
          Set cover
        </button>
        <button type="button" className="nla-btn-sm nla-danger" disabled={busy} onClick={() => onRemove(photo)}>
          Remove
        </button>
      </div>
    </div>
  );
}

// ── Newsletter Brief ─────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars -- JSX-only use
function CoverageChips({coverage}) {
  return (
    <div className="nla-coverage">
      {coverage.map((c) => (
        <span key={c.key} className={`nla-cov nla-cov-${c.status}`} title={c.detail || ''}>
          {c.label}: {COVERAGE_STATUS_LABEL[c.status] || c.status}
          {c.status === 'scanned' && c.count ? ` (${c.count})` : ''}
        </span>
      ))}
    </div>
  );
}

// eslint-disable-next-line no-unused-vars -- JSX-only use
function ReadinessList({readiness}) {
  return (
    <ul className="nla-readiness">
      {readiness.items.map((it) => (
        <li
          key={it.key}
          className={`nla-ready ${it.ok ? 'nla-ready-ok' : it.blocking ? 'nla-ready-bad' : 'nla-ready-warn'}`}
        >
          <span className="nla-ready-mark">{it.ok ? '✓' : it.blocking ? '✕' : '!'}</span> {it.label}
        </li>
      ))}
    </ul>
  );
}

// eslint-disable-next-line no-unused-vars -- JSX-only use
function BriefPanel({
  brief,
  busy,
  onToggleFact,
  onGather,
  hasFacts,
  photoPlan,
  approvedPhotos,
  onAssignSlot,
  onPlacePhotos,
  pendingPlacement,
}) {
  return (
    <section className="nla-section nla-brief">
      <div className="nla-section-head">
        <h3>Newsletter brief</h3>
        <button
          type="button"
          className={hasFacts ? 'nla-btn' : 'nla-btn nla-btn-primary'}
          disabled={busy}
          onClick={onGather}
          title="Scan this month's planner data for facts (no draft yet — you write that after steering)"
        >
          {hasFacts ? 'Re-gather facts' : 'Gather facts'}
        </button>
      </div>

      <div className="nla-brief-block">
        <div className="nla-brief-label">Source coverage</div>
        <CoverageChips coverage={brief.coverage} />
      </div>

      <div className="nla-brief-block">
        <div className="nla-brief-label">Publish readiness</div>
        <ReadinessList readiness={brief.readiness} />
        {!brief.readiness.publishable && (
          <p className="nla-muted">Resolve the ✕ items before publishing. ! items are recommended, not blocking.</p>
        )}
      </div>

      {brief.repetition.length > 0 && (
        <div className="nla-brief-block">
          <div className="nla-brief-label">Repetition warnings</div>
          <ul className="nla-facts">
            {brief.repetition.map((r) => (
              <li key={r.detectorKey} className="nla-fact">
                <span className={r.sameValue ? 'nla-danger' : 'nla-muted'}>
                  <strong>{r.title}</strong> — {r.note}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="nla-brief-block">
        <div className="nla-brief-label">Photos</div>
        <p className="nla-muted">
          {brief.photos.approved}/{brief.photos.target} approved
          {brief.photos.needMore ? ' — add a few more.' : ' — looks good.'}
        </p>
        {brief.photos.suggestions.map((s, i) => (
          <p key={i} className="nla-muted">
            • {s}
          </p>
        ))}
      </div>

      {photoPlan.length > 0 && (
        <div className="nla-brief-block">
          <div className="nla-brief-label nla-plan-head">
            <span>Photo plan — shots to get this month</span>
            {pendingPlacement > 0 && (
              <button type="button" className="nla-btn-sm nla-btn-primary" disabled={busy} onClick={onPlacePhotos}>
                Place {pendingPlacement} planned photo{pendingPlacement === 1 ? '' : 's'}
              </button>
            )}
          </div>
          <ul className="nla-facts">
            {photoPlan.map((slot) => (
              <li key={slot.id} className="nla-fact nla-plan-slot">
                <div>
                  <strong>{slot.idea}</strong>
                  {slot.section ? <span className="nla-muted"> · {slot.section}</span> : null}
                  {slot.photoId ? <span className="nla-tag nla-conf-high">assigned</span> : null}
                </div>
                <select
                  className="nla-select"
                  value={slot.photoId || ''}
                  disabled={busy}
                  onChange={(e) => onAssignSlot(slot.id, e.target.value || null)}
                >
                  <option value="">
                    {approvedPhotos.length ? '— assign an approved photo —' : '— approve a photo first —'}
                  </option>
                  {approvedPhotos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.caption || p.altText || p.id}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="nla-brief-block">
        <div className="nla-brief-label">Suggested highlights — toggle which inform the issue</div>
        {brief.highlights.length === 0 && (
          <p className="nla-muted">No facts yet. Click “Gather facts” to scan this month’s planner data.</p>
        )}
        <ul className="nla-facts">
          {brief.highlights.map((h) => (
            <li key={h.factId} className="nla-fact nla-brief-fact">
              <label className="nla-check">
                <input type="checkbox" checked={h.included} disabled={busy} onChange={() => onToggleFact(h)} />{' '}
                <span>
                  <strong>{h.title}</strong>
                  {h.displayValue ? <span className="nla-muted"> · {h.displayValue}</span> : null}
                  <span className={`nla-tag nla-conf-${h.confidence}`}>{h.confidence}</span>
                  {h.isManual ? <span className="nla-tag">manual</span> : null}
                </span>
              </label>
              <div className="nla-brief-why">{h.why}</div>
              {h.summary ? <div className="nla-brief-summary">{h.summary}</div> : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── Issue editor ─────────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars -- JSX-only use
function IssueEditor({issueId, onBack}) {
  const [issue, setIssue] = useState(null);
  const [settings, setSettings] = useState(null);
  const [recentPublished, setRecentPublished] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const [blocks, setBlocks] = useState([]);
  const [intake, setIntake] = useState({});
  const [manualTitle, setManualTitle] = useState('');
  const [revisionNotes, setRevisionNotes] = useState('');
  // Two-step guard: a blank-note Write/Rewrite discards the current draft (and
  // any placed photos). When a draft already exists we arm an inline confirm
  // first. No window.confirm — house rule (Codex T9 lock).
  const [confirmRewrite, setConfirmRewrite] = useState(false);
  const [thumbs, setThumbs] = useState({}); // photoId -> url
  const [runs, setRuns] = useState([]);
  const fileRef = useRef(null);

  const applyIssue = useCallback((data) => {
    setIssue(data);
    setBlocks(Array.isArray(data?.draftPayload?.blocks) ? data.draftPayload.blocks : []);
    setIntake(data?.intakeAnswers && typeof data.intakeAnswers === 'object' ? data.intakeAnswers : {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [data, st, recent] = await Promise.all([
        getNewsletterIssueAdmin(sb, issueId),
        getNewsletterSettings(sb).catch(() => ({})),
        getNewsletterRecentPublishedAdmin(sb, {limit: 3, excludeId: issueId}).catch(() => []),
      ]);
      applyIssue(data);
      setSettings(st || {});
      setRecentPublished(recent || []);
      setRuns(await listNewsletterRunsAdmin(sb, issueId).catch(() => []));
    } catch (e) {
      setLoadError(friendlyNewsletterError(e));
    } finally {
      setLoading(false);
    }
  }, [issueId, applyIssue]);

  useEffect(() => {
    load();
  }, [load]);

  // Resolve thumbnails: public URL for approved, short-lived signed URL for staged.
  const photos = (issue && issue.photos) || [];
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = {};
      for (const p of photos) {
        try {
          next[p.id] = p.approved
            ? newsletterPublicPhotoUrl(sb, p.storagePath)
            : await getNewsletterStagingSignedUrl(sb, p.storagePath, 600);
        } catch (_e) {
          next[p.id] = '';
        }
      }
      if (!cancelled) setThumbs(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue]);

  const approvedPhotos = photos.filter((p) => p.approved);

  // The editorial brief is derived from the loaded issue + settings + recent
  // published issues. Recomputes whenever any of those change.
  const brief = useMemo(
    () => assembleNewsletterBrief({issue: issue || {}, settings: settings || {}, recentPublished}),
    [issue, settings, recentPublished],
  );
  const photoPlan = (issue && issue.photoPlan) || [];
  const pendingPlacement = pendingPlacementCount(blocks, photoPlan);

  async function withBusy(fn, okMsg) {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      if (okMsg) setNotice({kind: 'success', message: okMsg});
    } catch (e) {
      setNotice({kind: 'error', message: friendlyNewsletterError(e)});
    } finally {
      setBusy(false);
    }
  }

  // Draft is AI-owned: no manual block editing. The read-only preview reuses the
  // public block renderer (NewsletterBlocks). photosById/urlFor mirror
  // NewsletterIssuePage so placed (approved) photos resolve to their public URL.
  const photosById = useMemo(() => new Map(((issue && issue.photos) || []).map((p) => [p.id, p])), [issue]);
  const urlFor = useCallback((storagePath) => newsletterPublicPhotoUrl(sb, storagePath), []);

  // Facts (brief highlight toggles + manual add)
  const toggleFact = (fact) =>
    withBusy(async () => {
      const data = await setNewsletterFactIncluded(sb, fact.factId || fact.id, !fact.included);
      applyIssue(data);
    });
  const addManual = () =>
    withBusy(async () => {
      if (!manualTitle.trim()) return;
      const data = await addNewsletterManualFact(sb, {issueId, title: manualTitle.trim()});
      setManualTitle('');
      applyIssue(data);
    }, 'Fact added.');

  // Intake
  const saveIntake = () =>
    withBusy(async () => {
      const data = await saveNewsletterIntake(sb, issueId, intake);
      applyIssue(data);
    }, 'Intake saved.');

  // Photos
  const onPickFiles = (e) => {
    const files = Array.from(e.target.files || []);
    if (fileRef.current) fileRef.current.value = '';
    if (files.length === 0) return;
    withBusy(async () => {
      let data = issue;
      for (const file of files) {
        const token = generateNewsletterPhotoToken();
        const storagePath = await uploadNewsletterStagingPhoto(sb, issueId, file, {token});
        data = await registerNewsletterPhoto(sb, {issueId, storagePath});
      }
      applyIssue(data);
    }, 'Photo(s) uploaded to staging — approve to publish.');
  };
  const approve = (p) =>
    withBusy(async () => applyIssue(await approveNewsletterPhoto(sb, p)), 'Photo approved (copied to public).');
  const unapprove = (p) =>
    withBusy(async () => applyIssue(await unapproveNewsletterPhoto(sb, p)), 'Photo unapproved (public copy removed).');
  const cover = (p) => withBusy(async () => applyIssue(await setNewsletterCover(sb, issueId, p.id)), 'Cover set.');
  const removePhoto = (p) => withBusy(async () => applyIssue(await removeNewsletterPhoto(sb, p)), 'Photo removed.');
  const savePhotoMeta = (p, meta) =>
    withBusy(async () => applyIssue(await updateNewsletterPhoto(sb, {id: p.id, ...meta})), 'Photo details saved.');

  // Publish lifecycle
  const publish = () => withBusy(async () => applyIssue(await publishNewsletterIssue(sb, issueId)), 'Published.');
  const unpublish = () =>
    withBusy(async () => applyIssue(await unpublishNewsletterIssue(sb, issueId)), 'Unpublished — back to draft.');
  const regenPreview = () =>
    withBusy(async () => applyIssue(await regenerateNewsletterPreviewToken(sb, issueId)), 'Preview link regenerated.');

  const reloadAfterRun = async () => {
    applyIssue(await getNewsletterIssueAdmin(sb, issueId));
    setRuns(await listNewsletterRunsAdmin(sb, issueId).catch(() => []));
  };
  // Direction-first: GATHER facts only (no AI draft). Scans the planner so you
  // can curate facts + add your Q&A/tone BEFORE the AI writes. "Write draft"
  // (below) is the AI step, run after you've steered.
  const gather = () =>
    withBusy(async () => {
      await gatherNewsletterFacts(sb, {issueId});
      await reloadAfterRun();
    }, 'Facts gathered — curate them, add your Q&A and tone, then write the draft.');
  // Regenerate the draft only (no re-harvest). With revision notes the AI revises
  // the CURRENT draft in place; without notes it regenerates from the facts.
  const regenerateDraft = () =>
    withBusy(
      async () => {
        await regenerateNewsletterDraft(sb, {issueId, revisionNotes});
        await reloadAfterRun();
      },
      revisionNotes.trim() ? 'Draft revised per your notes.' : 'Draft written from your facts and Q&A.',
    );

  // Revise (note present) preserves the current draft; a blank-note Write/Rewrite
  // replaces it. Guard the destructive path with an inline confirm when a draft
  // already exists. Placed photos are the highest-value manual work to flag.
  const isReviseMode = revisionNotes.trim().length > 0;
  const placedPhotoCount = blocks.filter((b) => b && b.type === 'photo' && b.photoId).length;
  const overwriteRisk = !isReviseMode && blocks.length > 0;
  const onWriteClick = () => {
    if (overwriteRisk && !confirmRewrite) {
      setConfirmRewrite(true);
      return;
    }
    setConfirmRewrite(false);
    regenerateDraft();
  };

  // Photo plan: assign an approved photo to a shot-list slot, then weave the
  // fulfilled slots into the draft as photo blocks at their planned section.
  const assignSlot = (slotId, photoId) =>
    withBusy(
      async () => applyIssue(await setNewsletterPhotoPlanSlot(sb, {issueId, slotId, photoId})),
      photoId ? 'Photo assigned to the plan.' : 'Slot cleared.',
    );
  const placePhotos = () =>
    withBusy(async () => {
      const next = placePlannedPhotos(blocks, (issue && issue.photoPlan) || []);
      const data = await saveNewsletterDraft(sb, issueId, {...(issue.draftPayload || {}), blocks: next});
      applyIssue(data);
    }, 'Planned photos placed in the draft.');

  if (loading) return <div className="nla-loading">Loading issue…</div>;
  if (loadError)
    return (
      <div className="nla-pad">
        <InlineNotice notice={{kind: 'error', message: loadError}} />
        <button type="button" className="nla-btn" onClick={load}>
          Retry
        </button>
        <button type="button" className="nla-btn" onClick={onBack}>
          Back
        </button>
      </div>
    );
  if (!issue) return null;

  const previewPath = buildNewsletterPreviewPath(issue.slug, issue.previewToken);
  const publishedPath = buildNewsletterIssuePath(issue.slug);

  return (
    <div className="nla-editor">
      <div className="nla-editor-bar">
        <button type="button" className="nla-btn" onClick={onBack}>
          ← Issues
        </button>
        <div className="nla-editor-title">
          <strong>{issue.title}</strong> <StatusBadge status={issue.status} />
          <span className="nla-muted"> · {formatYearMonth(issue.yearMonth)}</span>
        </div>
        <div className="nla-spacer" />
        {issue.status === 'published' ? (
          <>
            <a className="nla-btn" href={publishedPath} target="_blank" rel="noreferrer">
              View live
            </a>
            <button type="button" className="nla-btn nla-danger" disabled={busy} onClick={unpublish}>
              Unpublish
            </button>
          </>
        ) : (
          <button
            type="button"
            className="nla-btn nla-btn-primary"
            disabled={busy || !brief.readiness.publishable}
            onClick={publish}
            title={brief.readiness.publishable ? '' : 'Resolve the blocking readiness items first'}
          >
            Publish
          </button>
        )}
      </div>

      {notice && <InlineNotice notice={notice} />}

      <BriefPanel
        brief={brief}
        busy={busy}
        onToggleFact={toggleFact}
        onGather={gather}
        hasFacts={(issue.facts || []).length > 0}
        photoPlan={photoPlan}
        approvedPhotos={approvedPhotos}
        onAssignSlot={assignSlot}
        onPlacePhotos={placePhotos}
        pendingPlacement={pendingPlacement}
      />

      <div className="nla-cols">
        <div className="nla-col-main">
          <section className="nla-section">
            <div className="nla-section-head">
              <h3>Draft</h3>
            </div>
            {/* The AI owns the content structure — there is no manual block
                building. Blank box = write/rewrite from your curated facts + Q&A;
                with a note = revise the current draft in place. The live AI uses
                the note; the offline template ignores it. */}
            <label className="nla-label" htmlFor="nla-revision-notes">
              Revision notes — tell the AI what to change
            </label>
            <div className="nla-revise">
              <textarea
                id="nla-revision-notes"
                className="nla-textarea"
                rows={2}
                value={revisionNotes}
                placeholder="Optional — tell the AI what to change (e.g. “warmer tone”, “shorten the cattle section”). Leave blank to write/rewrite from your facts + Q&A."
                onChange={(e) => {
                  setRevisionNotes(e.target.value);
                  if (confirmRewrite) setConfirmRewrite(false);
                }}
              />
              <button
                type="button"
                className="nla-btn nla-btn-primary"
                disabled={busy}
                onClick={onWriteClick}
                title="Write the draft from your facts + Q&A; with a note, the AI revises the current draft in place"
              >
                {revisionNotes.trim() ? 'Revise draft' : blocks.length === 0 ? 'Write draft' : 'Rewrite draft'}
              </button>
            </div>
            {confirmRewrite && (
              <div className="nla-rewrite-confirm" role="alert">
                <span>
                  Rewriting replaces the current draft
                  {placedPhotoCount > 0
                    ? ` and removes ${placedPhotoCount} placed photo${placedPhotoCount === 1 ? '' : 's'}`
                    : ''}
                  . Add a note above and use Revise to keep the current draft.
                </span>
                <span className="nla-rewrite-confirm-actions">
                  <button type="button" className="nla-btn nla-danger" disabled={busy} onClick={onWriteClick}>
                    Replace draft
                  </button>
                  <button type="button" className="nla-btn" disabled={busy} onClick={() => setConfirmRewrite(false)}>
                    Keep current
                  </button>
                </span>
              </div>
            )}
            {blocks.length === 0 ? (
              <p className="nla-muted">No draft yet. Curate the facts + Q&amp;A above, then click “Write draft”.</p>
            ) : (
              <div className="nla-draft-preview" aria-label="Draft preview (read-only)">
                <NewsletterBlocks blocks={blocks} photosById={photosById} urlFor={urlFor} />
              </div>
            )}
          </section>

          <section className="nla-section">
            <h3>Photos</h3>
            <p className="nla-muted">
              Uploads go to private staging. Approving copies the image to the public bucket — only approved photos
              appear on the live page. {photos.length}/12 used.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onPickFiles}
              disabled={busy || photos.length >= 12}
            />
            <div className="nla-photos">
              {photos.map((p) => (
                <PhotoCard
                  key={p.id}
                  photo={p}
                  thumbUrl={thumbs[p.id]}
                  busy={busy}
                  onApprove={approve}
                  onUnapprove={unapprove}
                  onCover={cover}
                  onRemove={removePhoto}
                  onSaveMeta={savePhotoMeta}
                />
              ))}
            </div>
          </section>
        </div>

        <div className="nla-col-side">
          <section className="nla-section">
            <h3>Preview</h3>
            {issue.status === 'draft' ? (
              <>
                <p className="nla-muted">
                  Share an exact public preview before publishing. The link expires after 30 days and rotates/disables
                  on publish.
                </p>
                {issue.previewEnabled && (
                  <a className="nla-btn" href={previewPath} target="_blank" rel="noreferrer">
                    Open preview
                  </a>
                )}
                <button type="button" className="nla-btn" disabled={busy} onClick={regenPreview}>
                  Regenerate link
                </button>
              </>
            ) : (
              <p className="nla-muted">Preview is disabled while published. Unpublish to re-open a draft preview.</p>
            )}
          </section>

          <section className="nla-section">
            <div className="nla-section-head">
              <h3>Add a manual fact</h3>
            </div>
            <p className="nla-muted">For something the planner data can’t see. No finances or mortalities.</p>
            <div className="nla-row">
              <input
                className="nla-input"
                value={manualTitle}
                placeholder="e.g. Hosted the county 4-H tour"
                onChange={(e) => setManualTitle(e.target.value)}
              />
              <button type="button" className="nla-btn-sm" disabled={busy || !manualTitle.trim()} onClick={addManual}>
                Add
              </button>
            </div>
          </section>

          <section className="nla-section">
            <div className="nla-section-head">
              <h3>Monthly Q&amp;A</h3>
              <button type="button" className="nla-btn-sm" disabled={busy} onClick={saveIntake}>
                Save
              </button>
            </div>
            <p className="nla-muted">Optional — adds human context to the draft. Not required for a good draft.</p>
            {INTAKE_QUESTIONS.map((q) => (
              <div key={q.key} className="nla-intake-q">
                <label className="nla-label">{q.label}</label>
                <textarea
                  className="nla-textarea"
                  rows={2}
                  value={intake[q.key] || ''}
                  onChange={(e) => setIntake((m) => ({...m, [q.key]: e.target.value}))}
                />
              </div>
            ))}
          </section>

          {runs.length > 0 && (
            <section className="nla-section">
              <h3>Recent runs</h3>
              <ul className="nla-facts">
                {runs.slice(0, 6).map((r) => (
                  <li key={r.id} className="nla-fact">
                    <span>
                      <strong>{r.runType}</strong>
                      {r.provider ? <span className="nla-muted"> · {r.provider}</span> : null}
                      <span className={`nla-tag${r.status === 'error' ? ' nla-danger' : ''}`}>{r.status}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ── This-month hero + issue list ─────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars -- JSX-only use
function ThisMonthHero({issues, onOpen, onNotice}) {
  const ym = currentYearMonth();
  const current = issues.find((it) => it.yearMonth === ym) || null;
  const [busy, setBusy] = useState(false);

  const gatherThisMonth = async () => {
    setBusy(true);
    try {
      let id = current && current.id;
      if (!id) {
        const data = await createNewsletterIssue(sb, ym);
        id = data.id;
      }
      // Direction-first: create (if needed) + GATHER facts only, then open to the
      // brief so you curate + add direction before writing the draft.
      await gatherNewsletterFacts(sb, {issueId: id});
      onOpen(id);
    } catch (e) {
      onNotice({kind: 'error', message: friendlyNewsletterError(e)});
      setBusy(false);
    }
  };

  return (
    <section className="nla-hero">
      <div className="nla-hero-main">
        <div className="nla-hero-month">{formatYearMonth(ym)}</div>
        <div className="nla-hero-status">
          {current ? (
            <>
              This month’s issue exists — <StatusBadge status={current.status} />
              <span className="nla-muted">
                {' '}
                · {current.includedFactCount}/{current.factCount} facts · {current.photoCount} photos
              </span>
            </>
          ) : (
            <span className="nla-muted">No issue for this month yet.</span>
          )}
        </div>
      </div>
      <div className="nla-hero-actions">
        {current && (
          <button type="button" className="nla-btn" disabled={busy} onClick={() => onOpen(current.id)}>
            Open
          </button>
        )}
        <button type="button" className="nla-btn nla-btn-primary" disabled={busy} onClick={gatherThisMonth}>
          {busy ? 'Gathering…' : current ? 'Re-gather facts' : 'Gather this month’s facts'}
        </button>
      </div>
    </section>
  );
}

// eslint-disable-next-line no-unused-vars -- JSX-only use
function IssueList({onOpen}) {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ym, setYm] = useState(currentYearMonth());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setIssues(await listNewsletterIssuesAdmin(sb));
    } catch (e) {
      setError(friendlyNewsletterError(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const data = await createNewsletterIssue(sb, ym);
      onOpen(data.id);
    } catch (e) {
      setNotice({kind: 'error', message: friendlyNewsletterError(e)});
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nla-list">
      {!loading && !error && <ThisMonthHero issues={issues} onOpen={onOpen} onNotice={setNotice} />}

      {notice && <InlineNotice notice={notice} />}

      <details className="nla-create-more">
        <summary className="nla-muted">Create an issue for another month</summary>
        <div className="nla-row">
          <input className="nla-input" type="month" value={ym} onChange={(e) => setYm(e.target.value)} />
          <button type="button" className="nla-btn" disabled={busy} onClick={create}>
            Create issue
          </button>
        </div>
      </details>

      {loading ? (
        <div className="nla-loading">Loading…</div>
      ) : error ? (
        <div className="nla-pad">
          <InlineNotice notice={{kind: 'error', message: error}} />
          <button type="button" className="nla-btn" onClick={load}>
            Retry
          </button>
        </div>
      ) : issues.length === 0 ? (
        <p className="nla-muted">No issues yet. Use “Gather this month’s facts” above to start.</p>
      ) : (
        <table className="nla-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Title</th>
              <th>Status</th>
              <th>Facts</th>
              <th>Photos</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {issues.map((it) => (
              <tr key={it.id}>
                <td>{formatYearMonth(it.yearMonth)}</td>
                <td>{it.title}</td>
                <td>
                  <StatusBadge status={it.status} />
                </td>
                <td>
                  {it.includedFactCount}/{it.factCount}
                </td>
                <td>{it.photoCount}</td>
                <td>
                  <button type="button" className="nla-btn-sm" onClick={() => onOpen(it.id)}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars -- JSX-only use
function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(null);
  const [aiConfigured, setAiConfigured] = useState(null); // null = unknown
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!open || settings) return;
    (async () => {
      try {
        setSettings(await getNewsletterSettings(sb));
        const probe = await probeNewsletterAi(sb);
        setAiConfigured(probe.ok ? probe.aiConfigured : null);
      } catch (e) {
        setNotice({kind: 'error', message: friendlyNewsletterError(e)});
      }
    })();
  }, [open, settings]);

  const set = (patch) => setSettings((s) => ({...s, ...patch}));

  const save = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const data = await updateNewsletterSettings(sb, {
        aiProvider: settings.aiProvider,
        aiModel: settings.aiModel,
        tone: settings.tone,
        tonePreset: settings.tonePreset,
        lengthDetail: settings.lengthDetail,
        photoMin: Number(settings.photoMin),
        photoTarget: Number(settings.photoTarget),
        pastIssueContextCount: Number(settings.pastIssueContextCount),
        draftGenDay: Number(settings.draftGenDay),
        publishTargetDay: Number(settings.publishTargetDay),
      });
      setSettings(data);
      setNotice({kind: 'success', message: 'Settings saved.'});
    } catch (e) {
      setNotice({kind: 'error', message: friendlyNewsletterError(e)});
    } finally {
      setBusy(false);
    }
  };

  const anthropicLabel =
    aiConfigured === true
      ? 'Anthropic (server key configured)'
      : aiConfigured === false
        ? 'Anthropic (needs server key — falls back to template)'
        : 'Anthropic';

  return (
    <section className="nla-section">
      <button type="button" className="nla-btn" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide' : 'Show'} settings
      </button>
      {open && settings && (
        <div className="nla-settings">
          {notice && <InlineNotice notice={notice} />}

          <label className="nla-label">AI provider</label>
          <select
            className="nla-select"
            value={settings.aiProvider || 'template'}
            onChange={(e) => set({aiProvider: e.target.value})}
          >
            <option value="template">Template (offline, no key)</option>
            <option value="anthropic">{anthropicLabel}</option>
          </select>

          <label className="nla-label">AI model</label>
          <select
            className="nla-select"
            value={settings.aiModel || ''}
            onChange={(e) => set({aiModel: e.target.value})}
          >
            <option value="">— default (Opus 4.8) —</option>
            {AI_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          <label className="nla-label">Tone preset</label>
          <select
            className="nla-select"
            value={settings.tonePreset || 'warm_credible'}
            onChange={(e) => set({tonePreset: e.target.value})}
          >
            {Object.keys(NEWSLETTER_TONE_PRESETS).map((k) => (
              <option key={k} value={k}>
                {TONE_PRESET_LABELS[k] || k}
              </option>
            ))}
          </select>

          <label className="nla-label">Custom tone (optional — overrides the preset)</label>
          <input
            className="nla-input"
            value={settings.tone || ''}
            placeholder="e.g. warm but credible, like a proud owner"
            onChange={(e) => set({tone: e.target.value})}
          />

          <label className="nla-label">Length / detail</label>
          <select
            className="nla-select"
            value={settings.lengthDetail || 'standard'}
            onChange={(e) => set({lengthDetail: e.target.value})}
          >
            {Object.keys(NEWSLETTER_LENGTH_PRESETS).map((k) => (
              <option key={k} value={k}>
                {LENGTH_LABELS[k] || k}
              </option>
            ))}
          </select>

          <div className="nla-row">
            <div>
              <label className="nla-label">Photos — minimum</label>
              <input
                className="nla-input"
                type="number"
                min={0}
                max={12}
                value={settings.photoMin ?? 3}
                onChange={(e) => set({photoMin: e.target.value})}
              />
            </div>
            <div>
              <label className="nla-label">Photos — target</label>
              <input
                className="nla-input"
                type="number"
                min={0}
                max={12}
                value={settings.photoTarget ?? 6}
                onChange={(e) => set({photoTarget: e.target.value})}
              />
            </div>
            <div>
              <label className="nla-label">Past issues for context</label>
              <input
                className="nla-input"
                type="number"
                min={0}
                max={12}
                value={settings.pastIssueContextCount ?? 3}
                onChange={(e) => set({pastIssueContextCount: e.target.value})}
              />
            </div>
          </div>

          <div className="nla-row">
            <div>
              <label className="nla-label">Draft-gen day</label>
              <input
                className="nla-input"
                type="number"
                min={1}
                max={28}
                value={settings.draftGenDay || 1}
                onChange={(e) => set({draftGenDay: e.target.value})}
              />
            </div>
            <div>
              <label className="nla-label">Publish-target day</label>
              <input
                className="nla-input"
                type="number"
                min={1}
                max={28}
                value={settings.publishTargetDay || 5}
                onChange={(e) => set({publishTargetDay: e.target.value})}
              />
            </div>
          </div>

          <button type="button" className="nla-btn nla-btn-primary" disabled={busy} onClick={save}>
            Save settings
          </button>
        </div>
      )}
    </section>
  );
}

// ── Root view ────────────────────────────────────────────────────────────────

export default function NewsletterAdminView({Header}) {
  const [openId, setOpenId] = useState(null);

  return (
    <div>
      {Header ? <Header /> : null}
      <div className="nla-wrap">
        <div className="nla-header">
          <h2 className="nla-page-title">Monthly Newsletter</h2>
          {!openId && <SettingsPanel />}
        </div>
        {openId ? <IssueEditor issueId={openId} onBack={() => setOpenId(null)} /> : <IssueList onOpen={setOpenId} />}
      </div>
    </div>
  );
}
