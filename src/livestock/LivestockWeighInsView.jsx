// ============================================================================
// LivestockWeighInsView — Phase 2.3.6 (recovered from Round-1 bundling bug)
// ============================================================================
// Verbatim byte-for-byte. This view + AdminNewWeighInModal originally sat
// adjacent in main.jsx and the Round-1 anchor extracted both into the same
// file by accident; this commit splits them.
// ============================================================================
import React from 'react';
import {useNavigate} from 'react-router-dom';
import AdminNewWeighInModal from '../shared/AdminNewWeighInModal.jsx';
import UsersModal from '../auth/UsersModal.jsx';
// eslint-disable-next-line no-unused-vars -- JSX-only use (eslint flat config has no react/jsx-uses-vars rule)
import InlineNotice from '../shared/InlineNotice.jsx';
// eslint-disable-next-line no-unused-vars -- JSX-only use (eslint flat config has no react/jsx-uses-vars rule)
import PlannerIcon from '../components/PlannerIcon.jsx';
import {writeBroilerBatchAvg, recomputeBroilerBatchWeekAvg} from '../lib/broiler.js';
import {loadRoster, activeNames as rosterActiveNames} from '../lib/teamMembers.js';
import {formatAgeRange, formatFeedPerPig, formatGroupAdg, formatAvgWeight} from '../lib/pigForecast.js';
const LivestockWeighInsView = ({
  sb,
  fmt,
  Header,
  authState,
  setView,
  showUsers,
  setShowUsers,
  allUsers,
  setAllUsers,
  loadUsers,
  species,
}) => {
  const navigate = useNavigate();
  const {useState, useEffect} = React;
  const [sessions, setSessions] = useState([]);
  const [entries, setEntries] = useState({}); // session_id -> [entries]
  const [loading, setLoading] = useState(true);
  const [expandedSession, setExpandedSession] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [broilerBatchRecs, setBroilerBatchRecs] = useState([]);
  const [showNewModal, setShowNewModal] = useState(false);
  // Per-expanded-tile grid editing state. Only one tile is expanded at a time.
  const [gridLabels, setGridLabels] = useState([]); // ['2','3'] for broiler etc.
  const [gridInputs, setGridInputs] = useState([]); // weight strings, length = labels*15
  const [gridUnlocked, setGridUnlocked] = useState(false); // false locks fields on complete
  const [gridNote, setGridNote] = useState('');
  const [savingGrid, setSavingGrid] = useState(false);
  const [gridErr, setGridErr] = useState('');
  // Active team roster (names only) — drives the broiler-only session
  // metadata edit dropdown. Loaded once on mount.
  const [activeRoster, setActiveRoster] = useState([]);
  // Per-expanded-tile broiler session metadata edit state. Reset on
  // expansion change (effect below). Only used when species==='broiler'.
  const [metaWeek, setMetaWeek] = useState(4);
  const [metaTeam, setMetaTeam] = useState('');
  const [metaBusy, setMetaBusy] = useState(false);
  const [metaErr, setMetaErr] = useState('');
  // Row-scoped error from reopenSession. Shape: {id, message} or null.
  // Lives outside the expansion effect's reset list so it survives the
  // post-update loadAll() — the expansion effect fires on `sessions`
  // change after loadAll, and clearing here would race the error
  // setter. Scoped by session id so an error from row A never bleeds
  // onto row B; cleared on the next successful reopen.
  const [actionErr, setActionErr] = useState(null);
  // Pig session metrics by session id. Populated lazily by an effect that
  // fans out one pig_session_metrics RPC per pig session in the loaded
  // list; results cache in this map so re-renders don't re-fetch. Refetched
  // when the sessions/entries graph changes. Authenticated scope returns
  // aggregates for any pig session (draft + complete history per the R1
  // scope rule). N round-trips per visible pig session list — acceptable
  // for v1 per Codex's W2.
  const [pigMetricsBySession, setPigMetricsBySession] = useState({});

  const speciesLabel = species === 'broiler' ? 'Broiler' : 'Pig';

  // Derive column labels for a session: broiler → split batch.schooner on '&'; pig → ['1','2'].
  function deriveLabels(s) {
    if (!s) return [];
    if (s.species === 'broiler') {
      const rec = broilerBatchRecs.find((b) => (b.name || '') === s.batch_id);
      const raw = rec && rec.schooner ? String(rec.schooner) : '';
      const parts = raw
        .split('&')
        .map((x) => x.trim())
        .filter(Boolean);
      return parts.length > 0 ? parts : ['(no schooner)'];
    }
    // Pig admin view moved to per-entry list (no grid) — labels stay empty.
    return [];
  }
  // Distribute a session's saved entries into a weights grid (mirrors the public webform).
  // Entries already sent to a processing trip are excluded here — they live in
  // the Send-to-Trip panel below the grid so re-saves don't wipe them.
  function hydrateGrid(s, sEntries, labels) {
    const grid = Array(labels.length * 15).fill('');
    const free = (sEntries || []).filter((e) => !e.sent_to_trip_id);
    if (s.species === 'broiler') {
      labels.forEach(function (label, colIdx) {
        const colE = free.filter(function (e) {
          return (e.tag || '') === label;
        });
        colE.slice(0, 15).forEach(function (e, i) {
          grid[colIdx * 15 + i] = String(e.weight);
        });
      });
    } else {
      free.slice(0, labels.length * 15).forEach(function (e, i) {
        grid[i] = String(e.weight);
      });
    }
    return grid;
  }

  async function loadAll() {
    setLoading(true);
    const sR = await sb
      .from('weigh_in_sessions')
      .select('*')
      .eq('species', species)
      .order('date', {ascending: false})
      .order('started_at', {ascending: false});
    if (sR.data) {
      setSessions(sR.data);
      if (sR.data.length > 0) {
        const ids = sR.data.map((s) => s.id);
        const eR = await sb.from('weigh_ins').select('*').in('session_id', ids).order('entered_at', {ascending: true});
        if (eR.data) {
          const m = {};
          eR.data.forEach((e) => {
            if (!m[e.session_id]) m[e.session_id] = [];
            m[e.session_id].push(e);
          });
          setEntries(m);
        }
      } else {
        setEntries({});
      }
    }
    setLoading(false);
  }
  useEffect(() => {
    loadAll();
  }, [species]);
  // Pig metrics fan-out (mig 049). One RPC per pig session in the visible
  // list; results cached in pigMetricsBySession so re-renders don't refetch.
  // Re-runs when the species changes (cattle/sheep/broiler views skip
  // entirely) or when the sessions/entries graph changes (so adding a
  // weigh-in to a draft session refreshes that session's metrics).
  useEffect(() => {
    if (species !== 'pig' || sessions.length === 0) {
      setPigMetricsBySession({});
      return;
    }
    let cancelled = false;
    Promise.all(
      sessions.map((s) =>
        sb.rpc('pig_session_metrics', {session_id_in: s.id}).then(({data, error}) => ({
          id: s.id,
          data: error ? {available: false} : data || {available: false},
        })),
      ),
    ).then((results) => {
      if (cancelled) return;
      const next = {};
      for (const r of results) next[r.id] = r.data;
      setPigMetricsBySession(next);
    });
    return () => {
      cancelled = true;
    };
    // sb is a stable prop from the parent; established pattern in this file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [species, sessions, entries]);
  // Broilers: load app_store ppp-v4 once so we can resolve schooner per batch.
  useEffect(() => {
    if (species !== 'broiler') return;
    sb.from('app_store')
      .select('data')
      .eq('key', 'ppp-v4')
      .maybeSingle()
      .then(({data}) => {
        if (data && Array.isArray(data.data)) setBroilerBatchRecs(data.data);
      });
  }, [species]);
  // Active team roster — drives the broiler session metadata edit dropdown.
  // Loaded once. Legacy team_member values not in the active roster are
  // preserved in the option list per-session via the option-builder below.
  useEffect(() => {
    let cancelled = false;
    loadRoster(sb).then((roster) => {
      if (!cancelled) setActiveRoster(rosterActiveNames(roster));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // When the user expands a tile, derive labels + hydrate the grid + reset edit lock.
  // Drafts are auto-unlocked; complete sessions stay locked until the user clicks Edit.
  useEffect(() => {
    if (!expandedSession) {
      setGridLabels([]);
      setGridInputs([]);
      setGridUnlocked(false);
      setGridNote('');
      setGridErr('');
      setMetaWeek(4);
      setMetaTeam('');
      setMetaErr('');
      return;
    }
    const s = sessions.find((x) => x.id === expandedSession);
    if (!s) return;
    const labels = deriveLabels(s);
    const sEntries = entries[s.id] || [];
    setGridLabels(labels);
    setGridInputs(hydrateGrid(s, sEntries, labels));
    setGridUnlocked(s.status === 'draft');
    setGridNote(s.notes || '');
    setGridErr('');
    // Seed metadata-edit state from the just-expanded session. Number()
    // on broiler_week so the toggle compares cleanly against integers
    // 4 / 6 (avoids fake-dirty if the row arrives as a string).
    const w = Number(s.broiler_week);
    setMetaWeek(w === 4 || w === 6 ? w : 4);
    setMetaTeam(s.team_member || '');
    setMetaErr('');
  }, [expandedSession, sessions, entries, broilerBatchRecs]);

  // Reopen a complete session (status: complete -> draft, completed_at -> null).
  // Currently only wired up for broiler via the row-level button below; cattle/
  // sheep have their own reopen flows in their respective views. For broiler,
  // the OLD week's stored avg in app_store.ppp-v4 is recomputed from the
  // latest OTHER complete session (or the wk*Lbs key is deleted when no other
  // complete session backs it). Mirrors the metadata-edit lane's contract on
  // weekChanged. Side-effect runs only when species==='broiler' AND the
  // session was complete AND oldWeek is in {4, 6} (matches
  // recomputeBroilerBatchWeekAvg's no-op gate). Failures from the cleanup
  // are surfaced via actionErr after loadAll() so the row reflects DB truth
  // (draft) without pretending the avg cleanup landed.
  async function reopenSession(s) {
    const oldWeek = Number(s.broiler_week);
    const wasComplete = s.status === 'complete';
    const isBroiler = s.species === 'broiler';

    const r = await sb.from('weigh_in_sessions').update({status: 'draft', completed_at: null}).eq('id', s.id);
    if (r && r.error) {
      setActionErr({id: s.id, message: 'Reopen failed: ' + r.error.message});
      return;
    }

    if (isBroiler && wasComplete && (oldWeek === 4 || oldWeek === 6)) {
      const r2 = await recomputeBroilerBatchWeekAvg(sb, s.batch_id, oldWeek, {excludeSessionId: s.id});
      if (!r2.ok) {
        setActionErr({id: s.id, message: 'Session reopened, but ppp-v4 cleanup failed: ' + r2.message});
        await loadAll();
        return;
      }
    }

    setActionErr(null);
    await loadAll();
  }
  // Save the broiler-only metadata edit panel (broiler_week + team_member).
  // No-op if neither field changed. On a complete session whose week
  // changed, the OLD week's stored avg in app_store.ppp-v4 is recomputed
  // from the latest OTHER complete session (or cleared if none exist),
  // and the NEW week's avg is written from this session's current
  // entries. Status === 'draft' skips the side-effect (matches today's
  // writeBroilerBatchAvg complete-only gate).
  async function saveSessionMetadata(s) {
    if (!s) return;
    const oldWeek = Number(s.broiler_week);
    const newWeek = Number(metaWeek);
    const oldTeam = (s.team_member || '').trim();
    const newTeam = (metaTeam || '').trim();
    if (!newTeam) {
      setMetaErr('Pick a team member.');
      return;
    }
    if (newWeek !== 4 && newWeek !== 6) {
      setMetaErr('Week must be 4 or 6.');
      return;
    }
    const weekChanged = oldWeek !== newWeek;
    const teamChanged = oldTeam !== newTeam;
    if (!weekChanged && !teamChanged) return; // no-op, no DB write

    setMetaBusy(true);
    setMetaErr('');
    const upd = {};
    if (weekChanged) upd.broiler_week = newWeek;
    if (teamChanged) upd.team_member = newTeam;
    const r = await sb.from('weigh_in_sessions').update(upd).eq('id', s.id);
    if (r && r.error) {
      setMetaBusy(false);
      setMetaErr('Save failed: ' + r.error.message);
      return;
    }

    // Side-effect: only complete sessions and only when week changed.
    if (s.status === 'complete' && weekChanged) {
      const r1 = await recomputeBroilerBatchWeekAvg(sb, s.batch_id, oldWeek, {excludeSessionId: s.id});
      if (!r1.ok) {
        setMetaBusy(false);
        setMetaErr('Save partly failed (old week): ' + r1.message);
        return;
      }
      const eR = await sb.from('weigh_ins').select('weight').eq('session_id', s.id);
      if (eR && eR.error) {
        setMetaBusy(false);
        setMetaErr('Save partly failed (entries read): ' + eR.error.message);
        return;
      }
      await writeBroilerBatchAvg(sb, {...s, broiler_week: newWeek}, (eR && eR.data) || []);
    }

    setMetaBusy(false);
    await loadAll();
  }
  async function completeFromAdmin(s) {
    // If this session is the currently-expanded tile, flush any pending grid
    // edits to DB first so what's on screen is what gets recorded as complete.
    if (expandedSession === s.id && s.species === 'broiler') {
      await saveAdminGrid(s);
    }
    await sb
      .from('weigh_in_sessions')
      .update({status: 'complete', completed_at: new Date().toISOString()})
      .eq('id', s.id);
    if (species === 'broiler') {
      const eR = await sb.from('weigh_ins').select('*').eq('session_id', s.id);
      // Override status locally so writeBroilerBatchAvg's complete-only gate fires.
      await writeBroilerBatchAvg(sb, {...s, status: 'complete'}, (eR && eR.data) || []);
    }
    await loadAll();
  }
  async function deleteSession(s) {
    if (!window._wcfConfirmDelete) return;
    window._wcfConfirmDelete('Delete this weigh-in session and all its entries? This cannot be undone.', async () => {
      await sb.from('weigh_in_sessions').delete().eq('id', s.id);
      await loadAll();
    });
  }

  // Admin save: wipe+rewrite semantics on the UNSENT pool. Entries with
  // sent_to_trip_id set are protected — they stay in weigh_ins and continue
  // referencing their trip in app_store.ppp-feeders-v1.
  async function saveAdminGrid(s) {
    if (!s) return;
    const rows = [];
    for (let i = 0; i < gridInputs.length; i++) {
      const w = gridInputs[i];
      if (w === '' || isNaN(parseFloat(w)) || parseFloat(w) <= 0) continue;
      const colIdx = Math.floor(i / 15);
      const tag = s.species === 'broiler' && gridLabels[colIdx] ? gridLabels[colIdx] : null;
      rows.push({weight: parseFloat(w), tag: tag});
    }
    setSavingGrid(true);
    setGridErr('');
    const del = await sb.from('weigh_ins').delete().eq('session_id', s.id).is('sent_to_trip_id', null);
    if (del.error) {
      setSavingGrid(false);
      setGridErr('Save failed (clear): ' + del.error.message);
      return;
    }
    let recs = [];
    if (rows.length > 0) {
      const t0 = Date.now();
      recs = rows.map(function (r, i) {
        return {
          id: String(t0 + i) + Math.random().toString(36).slice(2, 6),
          session_id: s.id,
          tag: r.tag,
          weight: r.weight,
          note: null,
          new_tag_flag: false,
        };
      });
      const ins = await sb.from('weigh_ins').insert(recs);
      if (ins.error) {
        setSavingGrid(false);
        setGridErr('Save failed (insert): ' + ins.error.message);
        return;
      }
    }
    if (gridNote !== (s.notes || '')) {
      await sb
        .from('weigh_in_sessions')
        .update({notes: gridNote || null})
        .eq('id', s.id);
    }
    if (s.species === 'broiler') {
      await writeBroilerBatchAvg(sb, s, recs);
    }
    setSavingGrid(false);
    // Re-lock complete sessions after save so the field stays read-only by default.
    if (s.status === 'complete') setGridUnlocked(false);
    await loadAll();
  }

  const filtered = sessions.filter((s) => statusFilter === 'all' || s.status === statusFilter);
  const totalEntries = filtered.reduce((s, sess) => s + (entries[sess.id] ? entries[sess.id].length : 0), 0);

  return (
    <div style={{minHeight: '100vh', background: '#f1f3f2'}}>
      {showUsers && (
        <UsersModal
          sb={sb}
          authState={authState}
          allUsers={allUsers}
          setAllUsers={setAllUsers}
          setShowUsers={setShowUsers}
          loadUsers={loadUsers}
        />
      )}
      <Header />
      <div style={{padding: '1rem', maxWidth: 1100, margin: '0 auto'}}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div>
            <div style={{fontSize: 16, fontWeight: 700, color: '#111827'}}>{speciesLabel} Weigh-In Sessions</div>
            <div style={{fontSize: 12, color: '#6b7280', marginTop: 2}}>
              {filtered.length} sessions {'\u00b7'} {totalEntries} total entries
            </div>
          </div>
          <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
            <div style={{display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #d1d5db'}}>
              {[
                {k: 'all', l: 'All'},
                {k: 'draft', l: 'Drafts'},
                {k: 'complete', l: 'Complete'},
              ].map((o, oi) => (
                <button
                  key={o.k}
                  onClick={() => setStatusFilter(o.k)}
                  style={{
                    padding: '5px 10px',
                    border: 'none',
                    borderRight: oi < 2 ? '1px solid #d1d5db' : 'none',
                    fontFamily: 'inherit',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: statusFilter === o.k ? '#1e40af' : 'white',
                    color: statusFilter === o.k ? 'white' : '#6b7280',
                  }}
                >
                  {o.l}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowNewModal(true)}
              style={{
                padding: '7px 14px',
                borderRadius: 7,
                border: 'none',
                background: '#1e40af',
                color: 'white',
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <PlannerIcon iconKey="weighins" size={16} />
              <span>New Weigh-In</span>
            </button>
          </div>
        </div>
        {showNewModal && (
          <AdminNewWeighInModal
            sb={sb}
            species={species}
            onClose={() => setShowNewModal(false)}
            onCreated={(rec) => {
              if (species === 'pig') {
                setShowNewModal(false);
                navigate('/weigh-in-sessions/' + rec.id);
                return;
              }
              loadAll().then(() => setExpandedSession(rec.id));
            }}
          />
        )}

        {loading && <div style={{textAlign: 'center', padding: '2rem', color: '#9ca3af'}}>Loading{'\u2026'}</div>}
        {!loading && filtered.length === 0 && (
          <div
            style={{
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              padding: '2rem',
              textAlign: 'center',
              color: '#6b7280',
              fontSize: 13,
            }}
          >
            No weigh-in sessions yet. Click <strong>New Weigh-In</strong> to start one.
          </div>
        )}

        <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
          {filtered.map((s) => {
            const isExpanded = expandedSession === s.id;
            const sEntries = entries[s.id] || [];
            const avgWeight =
              sEntries.length > 0
                ? sEntries.reduce((sum, e) => sum + (parseFloat(e.weight) || 0), 0) / sEntries.length
                : 0;
            const isComplete = s.status === 'complete';
            const fieldsLocked = isComplete && !gridUnlocked;
            const inpEditableStyle = {
              fontFamily: 'inherit',
              fontSize: 13,
              padding: '6px 8px',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              width: '100%',
              boxSizing: 'border-box',
              background: 'white',
              color: '#111827',
              outline: 'none',
            };
            const inpLockedStyle = {
              ...inpEditableStyle,
              background: '#f3f4f6',
              color: '#374151',
              cursor: 'not-allowed',
            };
            return (
              <div
                key={s.id}
                style={{background: 'white', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden'}}
              >
                <div
                  data-weighin-session-tile={s.id}
                  onClick={() => {
                    if (species === 'pig') {
                      navigate('/weigh-in-sessions/' + s.id);
                      return;
                    }
                    setExpandedSession(isExpanded ? null : s.id);
                  }}
                  style={{
                    padding: '10px 16px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                  className="hoverable-tile"
                >
                  {species !== 'pig' && (
                    <span style={{fontSize: 11, color: '#9ca3af'}}>{isExpanded ? '\u25bc' : '\u25b6'}</span>
                  )}
                  <span style={{fontSize: 13, fontWeight: 700, color: '#111827', minWidth: 120}}>
                    {s.batch_id || 'Unknown batch'}
                  </span>
                  {species === 'broiler' && s.broiler_week && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background: '#fef3c7',
                        color: '#92400e',
                      }}
                    >
                      {'WK ' + s.broiler_week}
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: isComplete ? '#d1fae5' : '#fef3c7',
                      color: isComplete ? '#065f46' : '#92400e',
                      textTransform: 'uppercase',
                    }}
                  >
                    {s.status}
                  </span>
                  <span style={{fontSize: 11, color: '#6b7280'}}>{fmt(s.date)}</span>
                  <span style={{fontSize: 11, color: '#6b7280'}}>{s.team_member}</span>
                  <span style={{fontSize: 11, fontWeight: 600, color: '#1e40af'}}>
                    {sEntries.length} {sEntries.length === 1 ? 'entry' : 'entries'}
                  </span>
                  {/* Avg-weight badge: cattle/sheep/broiler only. For pig
                    tiles the new metrics row below is the single source of
                    truth (Codex W3). */}
                  {species !== 'pig' && avgWeight > 0 && (
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: '#065f46',
                        padding: '2px 10px',
                        borderRadius: 10,
                        background: '#d1fae5',
                      }}
                    >
                      avg {Math.round(avgWeight * 100) / 100} lb
                    </span>
                  )}
                  {species === 'broiler' && avgWeight > 0 && s.broiler_week && (
                    <span style={{fontSize: 10, color: '#6b7280', fontStyle: 'italic'}}>
                      {'\u2192 batch wk' + s.broiler_week + 'Lbs'}
                    </span>
                  )}
                </div>
                {/* Pig metrics row (mig 049 RPC). Sibling under the main
                  tile row so the metrics don't push the existing fields
                  to wrap on narrow widths. Hidden when no entries yet
                  (matches the public form's W1 gate) or when the RPC
                  said available=false. */}
                {species === 'pig' &&
                  sEntries.length > 0 &&
                  pigMetricsBySession[s.id] &&
                  pigMetricsBySession[s.id].available && (
                    <div
                      data-pig-metrics-row={s.id}
                      style={{
                        padding: '8px 16px',
                        borderTop: '1px solid #f3f4f6',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                        gap: 8,
                        background: '#fafafa',
                      }}
                    >
                      <div data-pig-metric="age">
                        <div style={{fontSize: 9, color: '#6b7280', textTransform: 'uppercase'}}>Age at weigh-in</div>
                        <div style={{fontSize: 12, fontWeight: 700, color: '#111827'}}>
                          {formatAgeRange({
                            minDays: pigMetricsBySession[s.id].age_min_days,
                            maxDays: pigMetricsBySession[s.id].age_max_days,
                            hasActual: pigMetricsBySession[s.id].has_actual_farrowing,
                          })}
                        </div>
                      </div>
                      <div data-pig-metric="feed">
                        <div style={{fontSize: 9, color: '#6b7280', textTransform: 'uppercase'}}>Feed/pig</div>
                        <div style={{fontSize: 12, fontWeight: 700, color: '#111827'}}>
                          {formatFeedPerPig(pigMetricsBySession[s.id].feed_per_pig_lbs)}
                        </div>
                      </div>
                      <div data-pig-metric="adg">
                        <div style={{fontSize: 9, color: '#6b7280', textTransform: 'uppercase'}}>Group ADG</div>
                        <div style={{fontSize: 12, fontWeight: 700, color: '#111827'}}>
                          {formatGroupAdg(pigMetricsBySession[s.id].group_adg_lbs_per_day)}
                        </div>
                      </div>
                      <div data-pig-metric="avg">
                        <div style={{fontSize: 9, color: '#6b7280', textTransform: 'uppercase'}}>Avg weight</div>
                        <div style={{fontSize: 12, fontWeight: 700, color: '#111827'}}>
                          {formatAvgWeight(pigMetricsBySession[s.id].avg_weight_lbs)}
                        </div>
                      </div>
                    </div>
                  )}
                {isExpanded && species !== 'pig' && (
                  <div style={{borderTop: '1px solid #f3f4f6', padding: '12px 16px', background: '#fafafa'}}>
                    {species === 'broiler' &&
                      (() => {
                        // Build team-member options: active roster, with the
                        // session's CURRENT team_member injected (and marked
                        // "(retired)") if it's no longer in the active list.
                        // This avoids blank-rendering historical sessions
                        // and never offers other retired names.
                        const baseRoster = activeRoster;
                        const cur = (s.team_member || '').trim();
                        const includesCurrent = !cur || baseRoster.includes(cur);
                        const teamOptions = includesCurrent
                          ? baseRoster.map((n) => ({value: n, label: n}))
                          : [{value: cur, label: cur + ' (retired)'}, ...baseRoster.map((n) => ({value: n, label: n}))];
                        const metaDirty =
                          Number(metaWeek) !== Number(s.broiler_week) || (metaTeam || '').trim() !== cur;
                        const wkBtnStyle = (active) => ({
                          padding: '4px 10px',
                          borderRadius: 6,
                          border: '1px solid ' + (active ? '#1e40af' : '#d1d5db'),
                          background: active ? '#1e40af' : 'white',
                          color: active ? 'white' : '#374151',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        });
                        return (
                          <div
                            data-testid="broiler-meta-panel"
                            style={{
                              border: '1px solid #e5e7eb',
                              borderRadius: 8,
                              padding: '10px 12px',
                              marginBottom: 10,
                              background: 'white',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 8,
                            }}
                          >
                            <div style={{fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: 0.4}}>
                              {'SESSION METADATA'}
                            </div>
                            <div style={{display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap'}}>
                              <span style={{fontSize: 12, color: '#374151', minWidth: 90}}>{'Week:'}</span>
                              <button
                                type="button"
                                data-testid="broiler-meta-wk4"
                                onClick={() => setMetaWeek(4)}
                                aria-pressed={Number(metaWeek) === 4}
                                style={wkBtnStyle(Number(metaWeek) === 4)}
                              >
                                {'WK 4'}
                              </button>
                              <button
                                type="button"
                                data-testid="broiler-meta-wk6"
                                onClick={() => setMetaWeek(6)}
                                aria-pressed={Number(metaWeek) === 6}
                                style={wkBtnStyle(Number(metaWeek) === 6)}
                              >
                                {'WK 6'}
                              </button>
                            </div>
                            <div style={{display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap'}}>
                              <span style={{fontSize: 12, color: '#374151', minWidth: 90}}>{'Team Member:'}</span>
                              <select
                                data-testid="broiler-meta-team"
                                value={metaTeam}
                                onChange={(e) => setMetaTeam(e.target.value)}
                                style={{
                                  fontFamily: 'inherit',
                                  fontSize: 13,
                                  padding: '6px 8px',
                                  border: '1px solid #d1d5db',
                                  borderRadius: 6,
                                  background: 'white',
                                  minWidth: 160,
                                }}
                              >
                                {teamOptions.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {metaDirty && (
                              <div style={{display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap'}}>
                                <button
                                  type="button"
                                  data-testid="broiler-meta-save"
                                  onClick={() => saveSessionMetadata(s)}
                                  disabled={metaBusy}
                                  style={{
                                    padding: '4px 12px',
                                    borderRadius: 6,
                                    border: 'none',
                                    background: metaBusy ? '#9ca3af' : '#1e40af',
                                    color: 'white',
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: metaBusy ? 'not-allowed' : 'pointer',
                                    fontFamily: 'inherit',
                                  }}
                                >
                                  {metaBusy ? 'Saving…' : 'Save Metadata'}
                                </button>
                              </div>
                            )}
                            {metaErr && (
                              <div data-testid="broiler-meta-err" style={{fontSize: 11, color: '#b91c1c'}}>
                                {metaErr}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    <div style={{display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap'}}>
                      {isComplete && !gridUnlocked && (
                        <button
                          onClick={() => setGridUnlocked(true)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 6,
                            border: '1px solid #1e40af',
                            background: '#eff6ff',
                            color: '#1e40af',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          {'\u270e Edit Weights'}
                        </button>
                      )}
                      {species === 'broiler' && isComplete && (
                        <button
                          type="button"
                          data-testid="broiler-reopen-session"
                          onClick={() => reopenSession(s)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 6,
                            border: '1px solid #d1d5db',
                            background: 'white',
                            color: '#0f766e',
                            fontSize: 11,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          Reopen Session
                        </button>
                      )}
                      {!isComplete && (
                        <button
                          onClick={() => completeFromAdmin(s)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 6,
                            border: '1px solid #047857',
                            background: '#047857',
                            color: 'white',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          {'\u2713 Complete Weigh-In'}
                        </button>
                      )}
                      <button
                        onClick={() => deleteSession(s)}
                        style={{
                          marginLeft: 'auto',
                          padding: '4px 10px',
                          borderRadius: 6,
                          border: '1px solid #F09595',
                          background: 'white',
                          color: '#b91c1c',
                          fontSize: 11,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        Delete Weigh-In
                      </button>
                    </div>
                    {actionErr && actionErr.id === s.id && (
                      <div data-testid="broiler-reopen-err" style={{fontSize: 11, color: '#b91c1c', marginBottom: 10}}>
                        {actionErr.message}
                      </div>
                    )}

                    {gridLabels.length > 0 && (
                      <React.Fragment>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(' + gridLabels.length + ', 1fr)',
                            gap: 8,
                            marginBottom: 10,
                          }}
                        >
                          {gridLabels.map(function (label, col) {
                            return (
                              <div key={col}>
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: '#374151',
                                    textAlign: 'center',
                                    padding: '4px 0',
                                    marginBottom: 4,
                                    background: '#eef2ff',
                                    borderRadius: 6,
                                  }}
                                >
                                  {species === 'broiler' ? 'Schooner ' + label : 'Col ' + label}
                                </div>
                                {Array.from({length: 15}).map(function (_, row) {
                                  var idx = col * 15 + row;
                                  return (
                                    <div
                                      key={row}
                                      style={{display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3}}
                                    >
                                      <span
                                        style={{
                                          fontSize: 10,
                                          color: '#9ca3af',
                                          minWidth: 18,
                                          textAlign: 'right',
                                          fontVariantNumeric: 'tabular-nums',
                                        }}
                                      >
                                        {row + 1}
                                      </span>
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.1"
                                        value={gridInputs[idx] || ''}
                                        disabled={fieldsLocked}
                                        readOnly={fieldsLocked}
                                        onChange={function (e) {
                                          var v = e.target.value;
                                          setGridInputs(function (prev) {
                                            var next = prev.slice();
                                            next[idx] = v;
                                            return next;
                                          });
                                        }}
                                        placeholder="0"
                                        style={fieldsLocked ? inpLockedStyle : inpEditableStyle}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                        <div style={{marginBottom: 10}}>
                          <label
                            style={{display: 'block', fontSize: 12, color: '#374151', marginBottom: 4, fontWeight: 600}}
                          >
                            Session note
                          </label>
                          <textarea
                            value={gridNote}
                            disabled={fieldsLocked}
                            readOnly={fieldsLocked}
                            onChange={(ev) => setGridNote(ev.target.value)}
                            rows={2}
                            placeholder="Optional"
                            style={{...(fieldsLocked ? inpLockedStyle : inpEditableStyle), resize: 'vertical'}}
                          />
                        </div>
                        {gridErr && (
                          <div
                            style={{
                              color: '#b91c1c',
                              fontSize: 12,
                              marginBottom: 8,
                              padding: '6px 10px',
                              background: '#fef2f2',
                              borderRadius: 6,
                            }}
                          >
                            {gridErr}
                          </div>
                        )}
                        {!fieldsLocked && (
                          <button
                            onClick={() => saveAdminGrid(s)}
                            disabled={savingGrid}
                            style={{
                              padding: '8px 16px',
                              borderRadius: 7,
                              border: 'none',
                              background: savingGrid ? '#9ca3af' : '#1e40af',
                              color: 'white',
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: savingGrid ? 'not-allowed' : 'pointer',
                              fontFamily: 'inherit',
                            }}
                          >
                            {savingGrid ? 'Saving\u2026' : 'Save Weights'}
                          </button>
                        )}
                        {isComplete && !gridUnlocked && (
                          <div style={{fontSize: 11, color: '#6b7280', fontStyle: 'italic'}}>
                            Click <strong>{'\u270e Edit Weights'}</strong> above to make changes.
                          </div>
                        )}
                      </React.Fragment>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default LivestockWeighInsView;
