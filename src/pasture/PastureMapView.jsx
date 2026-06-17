// ============================================================================
// src/pasture/PastureMapView.jsx  —  Pasture Map
// ----------------------------------------------------------------------------
// CP1: import OnX-KML land, classify, close outlines, delete, GPS locate.
// CP2: select/pan, measure, and (management/admin) draw new polygons + edit
// existing boundaries on the map. Drawn areas require an in-app name + kind
// before save (no raw prompt/alert/confirm). farm_team can view + measure only.
// CP3/CP4: move ledger, occupancy/rest display, planned moves, and reports.
// All writes go through SECDEF RPCs. No daily-report wiring here.
// ============================================================================
import React from 'react';
import PastureMapCanvas from './PastureMapCanvas.jsx';
import {parseKmlToPlacemarks, parseAcreageNote, closeOutlineToPolygon} from '../lib/pastureKml.js';
import {
  listLandAreas,
  importLandAreaBatch,
  classifyLandArea,
  closeLandAreaOutline,
  deleteLandArea,
  createLandArea,
  updateLandAreaGeometry,
  listPastureMoves,
  recordPastureMove,
  listPasturePlannedMoves,
  createPasturePlannedMove,
  updatePasturePlannedMoveStatus,
  listPastureHistoryReport,
  listPastureRestReport,
  listPastureStockingReport,
  newImportBatchId,
  newLandAreaId,
  newPastureMoveId,
  newPasturePlanId,
} from '../lib/pastureMapApi.js';
import {
  cachePastureSnapshot,
  classifyPastureOfflineError,
  discardPastureOperation,
  enqueuePastureOperation,
  getPastureQueueState,
  loadPastureSnapshot,
  retryPastureOperation,
  syncPastureQueue,
} from '../lib/pastureOffline.js';
import './pastureMap.css';

const KIND_LABEL = {
  unclassified: 'Unclassified',
  pasture: 'Pasture',
  feeder_pig_area: 'Feeder Pig Area',
  section: 'Section',
  paddock: 'Paddock',
  infrastructure: 'Infrastructure',
  scratch: 'Scratch',
  outline_candidate: 'Outline (needs close)',
};

// Kinds a freshly drawn polygon may be saved as (no outline_candidate/scratch).
const DRAW_KINDS = ['unclassified', 'pasture', 'paddock', 'feeder_pig_area', 'section', 'infrastructure'];

const ANIMAL_TYPE_LABEL = {
  cattle_herd: 'Cattle herd',
  sheep_flock: 'Sheep flock',
  breeder_pigs: 'Breeder pigs',
  feeder_pigs: 'Feeder pigs',
};

const GROUP_PRESETS = {
  cattle_herd: [
    {key: 'mommas', label: 'Mommas'},
    {key: 'backgrounders', label: 'Backgrounders'},
    {key: 'finishers', label: 'Finishers'},
    {key: 'bulls', label: 'Bulls'},
  ],
  sheep_flock: [
    {key: 'ewes', label: 'Ewes'},
    {key: 'rams', label: 'Rams'},
    {key: 'feeders', label: 'Feeders'},
  ],
  breeder_pigs: [{key: 'breeder-pigs', label: 'Breeder pigs'}],
  feeder_pigs: [{key: 'feeder-pigs', label: 'Feeder pigs'}],
};

function slugKey(label) {
  return (label || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function localDateTimeValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

function tomorrowMorningValue() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return localDateTimeValue(d);
}

function initialMoveForm() {
  return {
    animalType: 'cattle_herd',
    groupKey: 'mommas',
    groupLabel: 'Mommas',
    movedAt: localDateTimeValue(),
    animalCount: '',
    notes: '',
  };
}

function initialPlanForm() {
  return {
    animalType: 'cattle_herd',
    groupKey: 'mommas',
    groupLabel: 'Mommas',
    plannedFor: tomorrowMorningValue(),
    animalCount: '',
    notes: '',
  };
}

function resolveGroup(form) {
  const groupLabel = (form.groupLabel || '').trim();
  const groupKey = ((form.groupKey || '').trim() || slugKey(groupLabel)).trim();
  return {groupLabel, groupKey};
}

function parseOptionalCount(value) {
  if (value === '' || value == null) return null;
  const count = Number.parseInt(value, 10);
  if (!Number.isFinite(count) || count <= 0) return NaN;
  return count;
}

function isSameLocalDate(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function restCopy(area) {
  if (!area) return 'No area selected';
  if (area.rest_state === 'occupied') return 'Occupied now';
  if (area.rest_state === 'resting')
    return area.rest_days == null ? 'Resting' : `${area.rest_days} day${area.rest_days === 1 ? '' : 's'} resting`;
  if (area.rest_state === 'rested')
    return area.rest_days == null ? 'Rested' : `${area.rest_days} day${area.rest_days === 1 ? '' : 's'} rested`;
  if (area.rest_state === 'baseline') return 'No move history yet';
  return 'No active occupancy';
}

function densityCopy(area) {
  const acres = Number(area && area.effective_acres);
  if (
    !area ||
    !Array.isArray(area.current_occupants) ||
    !area.current_occupants.length ||
    !Number.isFinite(acres) ||
    acres <= 0
  ) {
    return '';
  }
  const total = area.current_occupants.reduce((sum, o) => {
    const n = Number(o.animal_count);
    return Number.isFinite(n) && n > 0 ? sum + n : sum;
  }, 0);
  if (!total) return '';
  const density = Math.round((total / acres) * 100) / 100;
  return `${total.toLocaleString()} animals on ${Math.round(acres * 100) / 100} ac · ${density.toLocaleString()} / ac`;
}

function formatMoveTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
}

function useFacts(area) {
  if (!area) return [];
  const facts = [];
  facts.push(area.last_touched_at ? `Last used ${formatMoveTime(area.last_touched_at)}` : 'Last used: no move history');
  if (area.last_moved_out_at) facts.push(`Rest started ${formatMoveTime(area.last_moved_out_at)}`);
  if (area.rest_state === 'occupied') facts.push('Days rested: 0');
  else if (area.rest_days != null) facts.push(`${area.rest_days} day${area.rest_days === 1 ? '' : 's'} rested`);
  else facts.push('Days rested: not started');
  return facts;
}

// Vertex-edit only applies to areas that already have a polygon (drawn/imported
// or a closed outline). Outline candidates have no polygon layer yet, so Edit is
// disabled for them — they must be closed first.
function hasPolygonGeom(a) {
  if (!a) return false;
  if (a.current_version && a.current_version.geometry) return true;
  const rg = a.raw_geometry;
  return !!(rg && (rg.type === 'Polygon' || rg.type === 'MultiPolygon'));
}

export default function PastureMapView({Header, authState}) {
  const role = authState && authState.role;
  const isManager = role === 'management' || role === 'admin';
  const canRecordMoves = role === 'farm_team' || role === 'management' || role === 'admin';

  const [areas, setAreas] = React.useState([]);
  const [moves, setMoves] = React.useState([]);
  const [plans, setPlans] = React.useState([]);
  const [restReport, setRestReport] = React.useState({areas: [], counts: {}});
  const [stockingReport, setStockingReport] = React.useState({areas: []});
  const [historyRows, setHistoryRows] = React.useState([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [offlineStatus, setOfflineStatus] = React.useState('');
  const [queueState, setQueueState] = React.useState({queued: [], stuck: [], queuedCount: 0, stuckCount: 0});
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState('');
  const [busyId, setBusyId] = React.useState(null);
  const [preview, setPreview] = React.useState(null);
  const [importing, setImporting] = React.useState(false);
  const fileRef = React.useRef(null);

  // CP2 state
  const [mode, setMode] = React.useState('select'); // select | measure | draw | edit
  const [selectedId, setSelectedId] = React.useState(null);
  const [drawForm, setDrawForm] = React.useState(null); // {geometry, metrics, name, kind}
  const [editGeom, setEditGeom] = React.useState(null); // {geometry, metrics}
  const [moveForm, setMoveForm] = React.useState(() => initialMoveForm());
  const [planForm, setPlanForm] = React.useState(() => initialPlanForm());
  const [activePlanId, setActivePlanId] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [planSaving, setPlanSaving] = React.useState(false);
  const [planBusyId, setPlanBusyId] = React.useState(null);
  async function refreshQueueState() {
    try {
      setQueueState(await getPastureQueueState());
    } catch {
      /* IDB unavailable; the save path will surface a concrete error. */
    }
  }

  async function reload() {
    setLoading(true);
    setErr('');
    try {
      await syncPastureQueue();
      const [areaRes, moveRes, planRes, restRes, stockingRes] = await Promise.all([
        listLandAreas(false),
        listPastureMoves(75),
        listPasturePlannedMoves({status: 'planned', limit: 75}),
        listPastureRestReport(),
        listPastureStockingReport(),
      ]);
      setAreas((areaRes && areaRes.land_areas) || []);
      setMoves((moveRes && moveRes.moves) || []);
      setPlans((planRes && planRes.planned_moves) || []);
      setRestReport(restRes || {areas: [], counts: {}});
      setStockingReport(stockingRes || {areas: []});
      cachePastureSnapshot({
        areas: (areaRes && areaRes.land_areas) || [],
        moves: (moveRes && moveRes.moves) || [],
        plans: (planRes && planRes.planned_moves) || [],
        restReport: restRes || {areas: [], counts: {}},
        stockingReport: stockingRes || {areas: []},
      });
      setOfflineStatus('');
      await refreshQueueState();
    } catch (e) {
      const cached = loadPastureSnapshot();
      if (cached) {
        setAreas(cached.areas || []);
        setMoves(cached.moves || []);
        setPlans(cached.plans || []);
        setRestReport(cached.restReport || {areas: [], counts: {}});
        setStockingReport(cached.stockingReport || {areas: []});
        setOfflineStatus(
          cached.savedAt
            ? `Showing saved field map from ${formatMoveTime(cached.savedAt)}. New work will queue on this device.`
            : 'Showing saved field map. New work will queue on this device.',
        );
        await refreshQueueState();
      } else {
        setErr(e.message || 'Failed to load land areas');
      }
    } finally {
      setLoading(false);
    }
  }
  React.useEffect(() => {
    reload();
  }, []);

  React.useEffect(() => {
    function handleOnline() {
      reload();
    }
    if (typeof window !== 'undefined') window.addEventListener('online', handleOnline);
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener('online', handleOnline);
    };
  }, []);

  React.useEffect(() => {
    let alive = true;
    if (!selectedId) {
      setHistoryRows([]);
      setHistoryLoading(false);
      return () => {
        alive = false;
      };
    }
    setHistoryLoading(true);
    listPastureHistoryReport({landAreaId: selectedId, limit: 20})
      .then((res) => {
        if (alive) setHistoryRows((res && res.history) || []);
      })
      .catch((e) => {
        if (alive) setErr(e.message || 'Could not load pasture history.');
      })
      .finally(() => {
        if (alive) setHistoryLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selectedId, moves.length]);

  function switchMode(next) {
    setErr('');
    setDrawForm(null);
    setEditGeom(null);
    setMode(next);
  }
  function startEdit() {
    const a = areas.find((x) => x.id === selectedId);
    if (!a) {
      setErr('Select an area first (tap it on the map or in the list), then Edit.');
      return;
    }
    if (!hasPolygonGeom(a)) {
      setErr('That area is an outline with no polygon yet — use "Close outline" first, then Edit.');
      return;
    }
    setErr('');
    setEditGeom(null);
    setMode('edit');
  }

  // ── CP1 import ──
  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setErr('');
    try {
      const text = await file.text();
      const placemarks = parseKmlToPlacemarks(text);
      if (!placemarks.length) {
        setErr('No placemarks found in that KML. Export Area Shapes/Lines from the OnX Web Map.');
        return;
      }
      setPreview({
        fileName: file.name,
        placemarks,
        polygons: placemarks.filter((p) => !p.is_outline_candidate).length,
        lines: placemarks.filter((p) => p.is_outline_candidate).length,
      });
    } catch (e2) {
      setErr('Could not parse that file as KML: ' + (e2.message || e2));
    }
  }
  async function confirmImport() {
    if (!preview) return;
    setImporting(true);
    setErr('');
    try {
      await importLandAreaBatch({
        batchId: newImportBatchId(),
        source: 'onx_kml',
        fileName: preview.fileName,
        placemarks: preview.placemarks,
      });
      setPreview(null);
      await reload();
    } catch (e) {
      setErr(e.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function withBusy(id, fn) {
    setBusyId(id);
    setErr('');
    try {
      await fn();
      await reload();
    } catch (e) {
      setErr(e.message || 'Action failed');
    } finally {
      setBusyId(null);
    }
  }
  const classify = (a, kind) => withBusy(a.id, () => classifyLandArea(a.id, kind));
  const removeArea = (a) => withBusy(a.id, () => deleteLandArea(a.id));
  function closeOutline(a) {
    const res = closeOutlineToPolygon(a.raw_geometry);
    if (!res.valid) {
      setErr(`Cannot close "${a.name}": ${res.reason}.`);
      return;
    }
    return withBusy(a.id, () => closeLandAreaOutline(a.id, res.polygon, 'unclassified'));
  }

  // ── CP2 draw / edit ──
  function onDrawComplete(geometry, metrics) {
    setDrawForm({geometry, metrics, name: '', kind: 'unclassified'});
  }
  function onEditGeometry(geometry, metrics) {
    setEditGeom({geometry, metrics});
  }
  function updateMoveType(type) {
    const preset = (GROUP_PRESETS[type] || [])[0] || {key: '', label: ''};
    setMoveForm((f) => ({...f, animalType: type, groupKey: preset.key, groupLabel: preset.label}));
  }
  function updateMovePreset(key) {
    if (key === '__custom') {
      setMoveForm((f) => ({...f, groupKey: '', groupLabel: ''}));
      return;
    }
    const preset = (GROUP_PRESETS[moveForm.animalType] || []).find((p) => p.key === key);
    if (preset) setMoveForm((f) => ({...f, groupKey: preset.key, groupLabel: preset.label}));
  }
  function updatePlanType(type) {
    const preset = (GROUP_PRESETS[type] || [])[0] || {key: '', label: ''};
    setPlanForm((f) => ({...f, animalType: type, groupKey: preset.key, groupLabel: preset.label}));
  }
  function updatePlanPreset(key) {
    if (key === '__custom') {
      setPlanForm((f) => ({...f, groupKey: '', groupLabel: ''}));
      return;
    }
    const preset = (GROUP_PRESETS[planForm.animalType] || []).find((p) => p.key === key);
    if (preset) setPlanForm((f) => ({...f, groupKey: preset.key, groupLabel: preset.label}));
  }
  async function saveMove() {
    if (!selectedId) {
      setErr('Select an area first, then record the move.');
      return;
    }
    const {groupLabel, groupKey} = resolveGroup(moveForm);
    if (!groupLabel || !groupKey) {
      setErr('Group name is required for a pasture move.');
      return;
    }
    const movedDate = new Date(moveForm.movedAt);
    if (Number.isNaN(movedDate.getTime())) {
      setErr('Move date/time is required.');
      return;
    }
    const count = parseOptionalCount(moveForm.animalCount);
    if (Number.isNaN(count)) {
      setErr('Animal count must be a positive whole number.');
      return;
    }
    setSaving(true);
    setErr('');
    const movePayload = {
      moveId: newPastureMoveId(),
      animalType: moveForm.animalType,
      groupKey,
      groupLabel,
      toLandAreaId: selectedId,
      movedAt: movedDate.toISOString(),
      animalCount: count,
      notes: moveForm.notes,
      activePlanId,
    };
    try {
      const savedMove = await recordPastureMove(movePayload);
      if (activePlanId && savedMove && savedMove.id) {
        await updatePasturePlannedMoveStatus({
          planId: activePlanId,
          status: 'completed',
          completedMoveId: savedMove.id,
        });
      }
      setActivePlanId(null);
      setMoveForm((f) => ({...f, movedAt: localDateTimeValue(), animalCount: '', notes: ''}));
      await reload();
    } catch (e) {
      if (classifyPastureOfflineError(e) === 'transient') {
        try {
          await enqueuePastureOperation({id: movePayload.moveId, op: 'record_move', payload: movePayload});
          await refreshQueueState();
          setOfflineStatus('Move saved on this device and will sync when the connection returns.');
          setMoveForm((f) => ({...f, movedAt: localDateTimeValue(), animalCount: '', notes: ''}));
          setActivePlanId(null);
        } catch (queueErr) {
          setErr(queueErr.message || 'Could not queue pasture move.');
        }
      } else {
        setErr(e.message || 'Could not record pasture move.');
      }
    } finally {
      setSaving(false);
    }
  }
  async function savePlan() {
    if (!selectedId) {
      setErr('Select an area first, then plan the move.');
      return;
    }
    const {groupLabel, groupKey} = resolveGroup(planForm);
    if (!groupLabel || !groupKey) {
      setErr('Group name is required for a planned move.');
      return;
    }
    const plannedDate = new Date(planForm.plannedFor);
    if (Number.isNaN(plannedDate.getTime())) {
      setErr('Planned date/time is required.');
      return;
    }
    const count = parseOptionalCount(planForm.animalCount);
    if (Number.isNaN(count)) {
      setErr('Animal count must be a positive whole number.');
      return;
    }
    setPlanSaving(true);
    setErr('');
    try {
      await createPasturePlannedMove({
        planId: newPasturePlanId(),
        animalType: planForm.animalType,
        groupKey,
        groupLabel,
        toLandAreaId: selectedId,
        plannedFor: plannedDate.toISOString(),
        animalCount: count,
        notes: planForm.notes,
      });
      setPlanForm((f) => ({...f, plannedFor: tomorrowMorningValue(), animalCount: '', notes: ''}));
      await reload();
    } catch (e) {
      setErr(e.message || 'Could not save planned move.');
    } finally {
      setPlanSaving(false);
    }
  }
  function applyPlan(plan) {
    setSelectedId(plan.to_land_area_id);
    setActivePlanId(plan.id);
    setMoveForm({
      animalType: plan.animal_type,
      groupKey: plan.group_key,
      groupLabel: plan.group_label,
      movedAt: localDateTimeValue(new Date(plan.planned_for)),
      animalCount: plan.animal_count == null ? '' : String(plan.animal_count),
      notes: plan.notes || '',
    });
    setErr('');
  }
  async function cancelPlan(plan) {
    setPlanBusyId(plan.id);
    setErr('');
    try {
      await updatePasturePlannedMoveStatus({planId: plan.id, status: 'canceled'});
      if (activePlanId === plan.id) setActivePlanId(null);
      await reload();
    } catch (e) {
      setErr(e.message || 'Could not cancel planned move.');
    } finally {
      setPlanBusyId(null);
    }
  }
  async function retryQueuedPastureOperation(csid) {
    setQueueState(await retryPastureOperation(csid));
    await reload();
  }
  async function discardQueuedPastureOperation(csid) {
    setQueueState(await discardPastureOperation(csid));
  }
  async function saveDraw() {
    if (!drawForm) return;
    if (!drawForm.name.trim()) {
      setErr('Name is required to save a new area.');
      return;
    }
    if (drawForm.metrics && drawForm.metrics.selfIntersects) {
      setErr('That polygon is self-intersecting. Redraw it before saving.');
      return;
    }
    setSaving(true);
    setErr('');
    const areaId = newLandAreaId();
    const createPayload = {
      id: areaId,
      name: drawForm.name.trim(),
      polygon: drawForm.geometry,
      kind: drawForm.kind,
      source: 'drawn',
    };
    try {
      await createLandArea(createPayload);
      setDrawForm(null);
      setMode('select');
      await reload();
    } catch (e) {
      if (classifyPastureOfflineError(e) === 'transient') {
        try {
          await enqueuePastureOperation({id: areaId, op: 'create_area', payload: createPayload});
          const queuedArea = {
            id: areaId,
            kind: drawForm.kind,
            name: drawForm.name.trim(),
            status: 'active',
            review_status: 'reviewed',
            geometry_status: 'valid',
            baseline_no_history: true,
            source: 'drawn',
            raw_geometry: drawForm.geometry,
            current_version: {
              id: `queued-${areaId}`,
              version_number: 1,
              computed_acres: drawForm.metrics && drawForm.metrics.acres != null ? drawForm.metrics.acres : null,
              geometry: drawForm.geometry,
            },
            computed_acres: drawForm.metrics && drawForm.metrics.acres != null ? drawForm.metrics.acres : null,
            effective_acres: drawForm.metrics && drawForm.metrics.acres != null ? drawForm.metrics.acres : null,
            rest_state: 'baseline',
            current_occupants: [],
            current_occupancy_count: 0,
            queued_offline: true,
          };
          const nextAreas = [...areas.filter((a) => a.id !== areaId), queuedArea];
          setAreas(nextAreas);
          cachePastureSnapshot({areas: nextAreas, moves, plans, restReport, stockingReport});
          await refreshQueueState();
          setSelectedId(areaId);
          setDrawForm(null);
          setMode('select');
          setOfflineStatus('New paddock saved on this device and will sync when the connection returns.');
        } catch (queueErr) {
          setErr(queueErr.message || 'Could not queue the drawn area.');
        }
      } else {
        setErr(e.message || 'Could not save the drawn area.');
      }
    } finally {
      setSaving(false);
    }
  }
  function cancelDraw() {
    setDrawForm(null);
    setMode('select');
  }
  async function saveEdit() {
    if (!selectedId) return;
    if (!editGeom) {
      // No vertex change captured — nothing to save.
      setMode('select');
      await reload();
      return;
    }
    if (editGeom.metrics && editGeom.metrics.selfIntersects) {
      setErr('The edited boundary is self-intersecting. Fix it before saving.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      await updateLandAreaGeometry(selectedId, editGeom.geometry);
      setEditGeom(null);
      setMode('select');
      await reload();
    } catch (e) {
      setErr(e.message || 'Could not save the edited boundary.');
    } finally {
      setSaving(false);
    }
  }
  async function cancelEdit() {
    setEditGeom(null);
    setMode('select');
    await reload(); // discard in-place vertex drags by re-rendering from the DB
  }

  const counts = areas.reduce((m, a) => ((m[a.kind] = (m[a.kind] || 0) + 1), m), {});
  const selectedArea = areas.find((a) => a.id === selectedId) || null;
  const selectedEditable = hasPolygonGeom(selectedArea);
  const selectedDensity = densityCopy(selectedArea);
  const sameDayMoveWarning = React.useMemo(() => {
    const {groupKey} = resolveGroup(moveForm);
    const movedDate = new Date(moveForm.movedAt);
    if (!groupKey || Number.isNaN(movedDate.getTime())) return '';
    const prior = moves.find((m) => {
      const priorDate = new Date(m.moved_at);
      return m.animal_type === moveForm.animalType && m.group_key === groupKey && isSameLocalDate(priorDate, movedDate);
    });
    return prior
      ? `Same-day move already recorded at ${formatMoveTime(prior.moved_at)}. Check the time before saving.`
      : '';
  }, [moves, moveForm]);
  const restCounts = restReport && restReport.counts ? restReport.counts : {};
  const stockingRows = (stockingReport && stockingReport.areas) || [];

  return (
    <div className="pm-view">
      <Header />
      <main className="pm-main">
        <div className="pm-head">
          <div>
            <h1 className="pm-title">Pasture Map</h1>
            <div className="pm-sub">
              {loading ? 'Loading…' : `${areas.length} land area${areas.length === 1 ? '' : 's'}`}
              {counts.outline_candidate
                ? ` · ${counts.outline_candidate} outline${counts.outline_candidate === 1 ? '' : 's'} to close`
                : ''}
              {counts.unclassified ? ` · ${counts.unclassified} to classify` : ''}
            </div>
          </div>
          {isManager && (
            <div className="pm-head-actions">
              <input
                ref={fileRef}
                type="file"
                accept=".kml,application/vnd.google-earth.kml+xml"
                onChange={onFile}
                style={{display: 'none'}}
                data-pasture-import-input="1"
              />
              <button
                type="button"
                className="pm-btn pm-btn-primary"
                onClick={() => fileRef.current && fileRef.current.click()}
              >
                Import OnX KML
              </button>
            </div>
          )}
        </div>

        {err && (
          <div className="pm-error" role="alert">
            {err}
          </div>
        )}

        {(offlineStatus || queueState.queuedCount > 0 || queueState.stuckCount > 0) && (
          <div className="pm-offline-panel" data-pasture-offline-panel="1">
            <div className="pm-offline-copy">
              {offlineStatus || 'Pasture field work is saved locally until it syncs.'}
              {queueState.queuedCount > 0 && (
                <span data-pasture-offline-queued="1"> {queueState.queuedCount} queued.</span>
              )}
              {queueState.stuckCount > 0 && (
                <span data-pasture-offline-stuck="1"> {queueState.stuckCount} needs attention.</span>
              )}
            </div>
            {queueState.stuckCount > 0 && (
              <div className="pm-offline-actions">
                {queueState.stuck.slice(0, 3).map((row) => (
                  <span key={row.csid} className="pm-offline-row">
                    <span>{row.record && row.record.op ? row.record.op.replace('_', ' ') : row.csid}</span>
                    <button
                      type="button"
                      className="pm-btn pm-btn-sm"
                      onClick={() => retryQueuedPastureOperation(row.csid)}
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      className="pm-btn pm-btn-sm"
                      onClick={() => discardQueuedPastureOperation(row.csid)}
                    >
                      Discard
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {preview && (
          <div className="pm-preview" data-pasture-import-preview="1">
            <div className="pm-preview-body">
              <strong>{preview.fileName}</strong> — {preview.placemarks.length} placemarks: {preview.polygons} polygon
              {preview.polygons === 1 ? '' : 's'} (import directly), {preview.lines} line
              {preview.lines === 1 ? '' : 's'} (import as outline candidates to close). Imported shapes land{' '}
              <em>unclassified</em> for review.
            </div>
            <div className="pm-preview-actions">
              <button type="button" className="pm-btn" onClick={() => setPreview(null)} disabled={importing}>
                Cancel
              </button>
              <button type="button" className="pm-btn pm-btn-primary" onClick={confirmImport} disabled={importing}>
                {importing ? 'Importing…' : `Import ${preview.placemarks.length}`}
              </button>
            </div>
          </div>
        )}

        <div className="pm-body">
          <section className="pm-map-col">
            {/* CP2 mode toolbar — stable height so the map doesn't jump. */}
            <div className="pm-toolbar" data-pasture-toolbar="1">
              <button
                type="button"
                className={'pm-mode' + (mode === 'select' ? ' is-active' : '')}
                onClick={() => switchMode('select')}
                data-mode="select"
              >
                Select
              </button>
              <button
                type="button"
                className={'pm-mode' + (mode === 'measure' ? ' is-active' : '')}
                onClick={() => switchMode('measure')}
                data-mode="measure"
              >
                Measure
              </button>
              {isManager && (
                <>
                  <button
                    type="button"
                    className={'pm-mode' + (mode === 'draw' ? ' is-active' : '')}
                    onClick={() => switchMode('draw')}
                    data-mode="draw"
                  >
                    Draw
                  </button>
                  <button
                    type="button"
                    className={'pm-mode' + (mode === 'edit' ? ' is-active' : '')}
                    onClick={startEdit}
                    disabled={!selectedId || !selectedEditable}
                    title={selectedId && !selectedEditable ? 'Close this outline first to edit its polygon' : undefined}
                    data-mode="edit"
                  >
                    Edit{selectedArea ? ` · ${selectedArea.name || 'selected'}` : ''}
                  </button>
                </>
              )}
              <span className="pm-toolbar-hint">
                {mode === 'draw'
                  ? 'Tap to add points; tap the first point to finish.'
                  : mode === 'edit'
                    ? 'Drag the white handles to reshape.'
                    : mode === 'measure'
                      ? 'Draw a shape to read its acres/perimeter.'
                      : 'Tap an area to select it.'}
              </span>
            </div>

            {/* Draw save form — in-app, never a raw prompt. */}
            {isManager && drawForm && (
              <div className="pm-drawform" data-pasture-drawform="1">
                <div className="pm-drawform-row">
                  <label className="pm-field">
                    <span>Name</span>
                    <input
                      type="text"
                      value={drawForm.name}
                      maxLength={200}
                      placeholder="e.g. ET-12"
                      onChange={(e) => setDrawForm((f) => ({...f, name: e.target.value}))}
                      data-pasture-drawform-name="1"
                      autoFocus
                    />
                  </label>
                  <label className="pm-field">
                    <span>Kind</span>
                    <select
                      value={drawForm.kind}
                      onChange={(e) => setDrawForm((f) => ({...f, kind: e.target.value}))}
                      data-pasture-drawform-kind="1"
                    >
                      {DRAW_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="pm-drawform-metric">
                    {drawForm.metrics && drawForm.metrics.acres != null ? `${drawForm.metrics.acres} ac` : ''}
                  </span>
                </div>
                {drawForm.metrics && drawForm.metrics.selfIntersects && (
                  <div className="pm-drawform-warn">Self-intersecting polygon — redraw before saving.</div>
                )}
                <div className="pm-drawform-actions">
                  <button type="button" className="pm-btn" onClick={cancelDraw} disabled={saving}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="pm-btn pm-btn-primary"
                    onClick={saveDraw}
                    disabled={saving || !drawForm.name.trim() || (drawForm.metrics && drawForm.metrics.selfIntersects)}
                    data-pasture-drawform-save="1"
                  >
                    {saving ? 'Saving…' : 'Save area'}
                  </button>
                </div>
              </div>
            )}

            {/* Edit save/cancel bar. */}
            {isManager && mode === 'edit' && selectedArea && !drawForm && (
              <div className="pm-editbar" data-pasture-editbar="1">
                <span className="pm-editbar-label">
                  Editing <strong>{selectedArea.name || 'area'}</strong>
                  {editGeom && editGeom.metrics && editGeom.metrics.acres != null
                    ? ` · ${editGeom.metrics.acres} ac`
                    : ''}
                </span>
                <div className="pm-editbar-actions">
                  <button type="button" className="pm-btn" onClick={cancelEdit} disabled={saving}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="pm-btn pm-btn-primary"
                    onClick={saveEdit}
                    disabled={saving || (editGeom && editGeom.metrics && editGeom.metrics.selfIntersects)}
                    data-pasture-editbar-save="1"
                  >
                    {saving ? 'Saving…' : 'Save boundary'}
                  </button>
                </div>
              </div>
            )}

            <PastureMapCanvas
              areas={areas}
              mode={mode}
              canWrite={isManager}
              editAreaId={mode === 'edit' ? selectedId : null}
              onSelect={setSelectedId}
              onDrawComplete={onDrawComplete}
              onEditGeometry={onEditGeometry}
            />
          </section>

          <section className="pm-list-col">
            {selectedArea && (
              <div className="pm-selected-panel" data-pasture-selected-panel="1">
                <div className="pm-selected-head">
                  <div>
                    <div className="pm-selected-kicker">Selected area</div>
                    <div className="pm-selected-title">{selectedArea.name || 'Unnamed'}</div>
                  </div>
                  <span className={'pm-rest-pill pm-rest-' + (selectedArea.rest_state || 'baseline')}>
                    {restCopy(selectedArea)}
                  </span>
                </div>
                {Array.isArray(selectedArea.current_occupants) && selectedArea.current_occupants.length > 0 && (
                  <div className="pm-occupants" data-pasture-occupancy={selectedArea.id}>
                    {selectedArea.current_occupants.map((o) => (
                      <span key={o.move_id + o.group_key} className="pm-occupant-pill">
                        {ANIMAL_TYPE_LABEL[o.animal_type] || o.animal_type}: {o.group_label}
                      </span>
                    ))}
                  </div>
                )}
                {selectedDensity && (
                  <div className="pm-density-line" data-pasture-density="1">
                    {selectedDensity}
                  </div>
                )}
                <div className="pm-use-facts" data-pasture-use-facts="1">
                  {useFacts(selectedArea).map((fact) => (
                    <span key={fact}>{fact}</span>
                  ))}
                </div>
                {canRecordMoves && (
                  <div className="pm-move-form" data-pasture-move-form="1">
                    <div className="pm-move-title">Record move here</div>
                    <div className="pm-move-grid">
                      <label className="pm-field">
                        <span>Animal group</span>
                        <select value={moveForm.animalType} onChange={(e) => updateMoveType(e.target.value)}>
                          {Object.entries(ANIMAL_TYPE_LABEL).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="pm-field">
                        <span>Known group</span>
                        <select
                          value={
                            (GROUP_PRESETS[moveForm.animalType] || []).some((p) => p.key === moveForm.groupKey)
                              ? moveForm.groupKey
                              : '__custom'
                          }
                          onChange={(e) => updateMovePreset(e.target.value)}
                        >
                          {(GROUP_PRESETS[moveForm.animalType] || []).map((p) => (
                            <option key={p.key} value={p.key}>
                              {p.label}
                            </option>
                          ))}
                          <option value="__custom">Custom</option>
                        </select>
                      </label>
                      <label className="pm-field">
                        <span>Group name</span>
                        <input
                          type="text"
                          value={moveForm.groupLabel}
                          maxLength={160}
                          onChange={(e) =>
                            setMoveForm((f) => ({...f, groupLabel: e.target.value, groupKey: slugKey(e.target.value)}))
                          }
                          data-pasture-move-group="1"
                        />
                      </label>
                      <label className="pm-field">
                        <span>Moved at</span>
                        <input
                          type="datetime-local"
                          value={moveForm.movedAt}
                          onChange={(e) => setMoveForm((f) => ({...f, movedAt: e.target.value}))}
                          data-pasture-move-at="1"
                        />
                      </label>
                      <label className="pm-field">
                        <span>Count</span>
                        <input
                          type="number"
                          min="1"
                          value={moveForm.animalCount}
                          onChange={(e) => setMoveForm((f) => ({...f, animalCount: e.target.value}))}
                          data-pasture-move-count="1"
                        />
                      </label>
                      <label className="pm-field pm-field-wide">
                        <span>Notes</span>
                        <input
                          type="text"
                          value={moveForm.notes}
                          maxLength={500}
                          onChange={(e) => setMoveForm((f) => ({...f, notes: e.target.value}))}
                          data-pasture-move-notes="1"
                        />
                      </label>
                    </div>
                    {activePlanId && <div className="pm-plan-note">Using planned move {activePlanId}</div>}
                    {sameDayMoveWarning && (
                      <div className="pm-same-day" data-pasture-same-day-prompt="1">
                        {sameDayMoveWarning}
                      </div>
                    )}
                    <div className="pm-move-actions">
                      <button
                        type="button"
                        className="pm-btn pm-btn-primary"
                        onClick={saveMove}
                        disabled={saving || !selectedId}
                        data-pasture-move-save="1"
                      >
                        {saving ? 'Saving...' : 'Save move'}
                      </button>
                    </div>
                  </div>
                )}
                {canRecordMoves && (
                  <div className="pm-plan-form" data-pasture-plan-form="1">
                    <div className="pm-move-title">Plan future move here</div>
                    <div className="pm-move-grid">
                      <label className="pm-field">
                        <span>Animal group</span>
                        <select value={planForm.animalType} onChange={(e) => updatePlanType(e.target.value)}>
                          {Object.entries(ANIMAL_TYPE_LABEL).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="pm-field">
                        <span>Known group</span>
                        <select
                          value={
                            (GROUP_PRESETS[planForm.animalType] || []).some((p) => p.key === planForm.groupKey)
                              ? planForm.groupKey
                              : '__custom'
                          }
                          onChange={(e) => updatePlanPreset(e.target.value)}
                        >
                          {(GROUP_PRESETS[planForm.animalType] || []).map((p) => (
                            <option key={p.key} value={p.key}>
                              {p.label}
                            </option>
                          ))}
                          <option value="__custom">Custom</option>
                        </select>
                      </label>
                      <label className="pm-field">
                        <span>Group name</span>
                        <input
                          type="text"
                          value={planForm.groupLabel}
                          maxLength={160}
                          onChange={(e) =>
                            setPlanForm((f) => ({...f, groupLabel: e.target.value, groupKey: slugKey(e.target.value)}))
                          }
                          data-pasture-plan-group="1"
                        />
                      </label>
                      <label className="pm-field">
                        <span>Planned for</span>
                        <input
                          type="datetime-local"
                          value={planForm.plannedFor}
                          onChange={(e) => setPlanForm((f) => ({...f, plannedFor: e.target.value}))}
                          data-pasture-plan-at="1"
                        />
                      </label>
                      <label className="pm-field">
                        <span>Count</span>
                        <input
                          type="number"
                          min="1"
                          value={planForm.animalCount}
                          onChange={(e) => setPlanForm((f) => ({...f, animalCount: e.target.value}))}
                          data-pasture-plan-count="1"
                        />
                      </label>
                      <label className="pm-field pm-field-wide">
                        <span>Notes</span>
                        <input
                          type="text"
                          value={planForm.notes}
                          maxLength={500}
                          onChange={(e) => setPlanForm((f) => ({...f, notes: e.target.value}))}
                          data-pasture-plan-notes="1"
                        />
                      </label>
                    </div>
                    <div className="pm-move-actions">
                      <button
                        type="button"
                        className="pm-btn"
                        onClick={savePlan}
                        disabled={planSaving || !selectedId}
                        data-pasture-plan-save="1"
                      >
                        {planSaving ? 'Saving...' : 'Save plan'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {plans.length > 0 && (
              <div className="pm-planned-moves" data-pasture-planned-moves="1">
                <div className="pm-recent-title">Planned moves</div>
                {plans.slice(0, 8).map((p) => (
                  <div key={p.id} className="pm-plan-row">
                    <div className="pm-plan-main">
                      <strong>{p.group_label}</strong>
                      <span>
                        to {p.to_land_area_name || 'selected area'} {formatMoveTime(p.planned_for)}
                        {p.animal_count ? ` · ${p.animal_count} animals` : ''}
                      </span>
                    </div>
                    <div className="pm-plan-actions">
                      <button type="button" className="pm-btn pm-btn-sm" onClick={() => applyPlan(p)}>
                        Use
                      </button>
                      <button
                        type="button"
                        className="pm-btn pm-btn-sm"
                        onClick={() => cancelPlan(p)}
                        disabled={planBusyId === p.id}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {moves.length > 0 && (
              <div className="pm-recent-moves" data-pasture-recent-moves="1">
                <div className="pm-recent-title">Recent moves</div>
                {moves.slice(0, 6).map((m) => (
                  <div key={m.id} className="pm-recent-row">
                    <strong>{m.group_label}</strong>
                    <span>
                      {m.to_land_area_name ? `to ${m.to_land_area_name}` : 'off map'} {formatMoveTime(m.moved_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="pm-report-panel" data-pasture-reports="1">
              <div className="pm-report-block" data-pasture-rest-report="1">
                <div className="pm-recent-title">Rest report</div>
                <div className="pm-report-metrics">
                  <span>Occupied {Number(restCounts.occupied || 0)}</span>
                  <span>Resting {Number(restCounts.resting || 0)}</span>
                  <span>Ready {Number(restCounts.rested || 0)}</span>
                  <span>No history {Number(restCounts.baseline || 0)}</span>
                </div>
              </div>
              <div className="pm-report-block" data-pasture-stocking-report="1">
                <div className="pm-recent-title">Animal-days / acre</div>
                {stockingRows.length === 0 ? (
                  <div className="pm-report-empty">No animal-day history yet.</div>
                ) : (
                  stockingRows.slice(0, 5).map((r) => (
                    <div key={r.land_area_id} className="pm-report-row">
                      <strong>{r.land_area_name}</strong>
                      <span>
                        {r.animal_days_per_acre == null ? 'No acres' : `${r.animal_days_per_acre} / ac`} ·{' '}
                        {r.animal_days} animal-days
                      </span>
                    </div>
                  ))
                )}
              </div>
              {selectedArea && (
                <div className="pm-report-block" data-pasture-history-report="1">
                  <div className="pm-recent-title">Selected history</div>
                  {historyLoading ? (
                    <div className="pm-report-empty">Loading history...</div>
                  ) : historyRows.length === 0 ? (
                    <div className="pm-report-empty">No moves recorded here yet.</div>
                  ) : (
                    historyRows.slice(0, 5).map((h) => (
                      <div key={h.id} className="pm-report-row">
                        <strong>{h.group_label}</strong>
                        <span>
                          {h.to_land_area_name ? `to ${h.to_land_area_name}` : 'off map'} {formatMoveTime(h.moved_at)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {!loading && areas.length === 0 && (
              <div className="pm-empty">
                No land areas yet.{' '}
                {isManager
                  ? 'Import an OnX KML export or draw one to get started.'
                  : 'Ask a manager to set up the farm map.'}
              </div>
            )}
            <ul className="pm-list">
              {areas.map((a) => {
                const noteAc = parseAcreageNote(a.raw_notes);
                const acres = a.effective_acres;
                const mismatch =
                  noteAc != null && acres != null && Math.abs(noteAc - acres) / Math.max(noteAc, 1) > 0.05;
                const isOutline = a.kind === 'outline_candidate' || a.geometry_status === 'outline_candidate';
                const busy = busyId === a.id;
                const isSel = a.id === selectedId;
                return (
                  <li
                    key={a.id}
                    className={'pm-item' + (isSel ? ' is-selected' : '')}
                    data-pasture-area={a.id}
                    data-kind={a.kind}
                  >
                    <button
                      type="button"
                      className="pm-item-main pm-item-select"
                      onClick={() => setSelectedId(a.id)}
                      data-pasture-area-select={a.id}
                    >
                      <div className="pm-item-name">{a.name || 'Unnamed'}</div>
                      <div className="pm-item-meta">
                        <span className={'pm-chip pm-chip-' + a.kind}>{KIND_LABEL[a.kind] || a.kind}</span>
                        {a.review_status === 'pending_review' && (
                          <span className="pm-chip pm-chip-review">Needs review</span>
                        )}
                        {a.queued_offline && <span className="pm-chip pm-chip-queued">Queued</span>}
                        {acres != null && <span className="pm-acres">{acres} ac</span>}
                        {mismatch && <span className="pm-note-acres">OnX note: {noteAc} ac</span>}
                        {a.geometry_status === 'invalid' && (
                          <span className="pm-chip pm-chip-invalid">Invalid geometry</span>
                        )}
                        <span
                          className={'pm-rest-pill pm-rest-' + (a.rest_state || 'baseline')}
                          data-pasture-rest-state={a.rest_state || 'baseline'}
                        >
                          {restCopy(a)}
                        </span>
                        {Array.isArray(a.current_occupants) &&
                          a.current_occupants.map((o) => (
                            <span key={o.move_id + o.group_key} className="pm-occupant-inline">
                              {o.group_label}
                            </span>
                          ))}
                      </div>
                    </button>
                    {isManager && (
                      <div className="pm-item-actions">
                        {isOutline ? (
                          <button
                            type="button"
                            className="pm-btn pm-btn-sm"
                            onClick={() => closeOutline(a)}
                            disabled={busy}
                          >
                            Close outline
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="pm-btn pm-btn-sm"
                              onClick={() => classify(a, 'pasture')}
                              disabled={busy}
                            >
                              Pasture
                            </button>
                            <button
                              type="button"
                              className="pm-btn pm-btn-sm"
                              onClick={() => classify(a, 'paddock')}
                              disabled={busy}
                            >
                              Paddock
                            </button>
                            <button
                              type="button"
                              className="pm-btn pm-btn-sm"
                              onClick={() => classify(a, 'infrastructure')}
                              disabled={busy}
                            >
                              Infra
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className="pm-btn pm-btn-sm pm-btn-danger"
                          onClick={() => removeArea(a)}
                          disabled={busy}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
