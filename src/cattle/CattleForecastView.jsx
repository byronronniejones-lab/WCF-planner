// CattleForecastView — flagship visual planning surface for the cattle program.
// Replaces Nick's manual spreadsheet finisher forecast workflow.
//
// Locked behaviors live in src/lib/cattleForecast.js (pure deterministic math).
// This file is UI wiring + read/write through src/lib/cattleForecastApi.js.
//
// Edit-permission tiering (management/admin vs farm_team) is enforced HERE,
// in the UI, per the build packet decision. RLS on the three forecast tables
// is broad-authenticated; the database itself doesn't filter writes by role.
import React from 'react';
import UsersModal from '../auth/UsersModal.jsx';
import CowDetail from './CowDetail.jsx';
import {loadCattleWeighInsCached} from '../lib/cattleCache.js';
import {
  buildForecast,
  monthLabel,
  parseMonthKey,
  ADG_SOURCES,
  WATCHLIST_REASONS,
  FORECAST_DISPLAY_WEIGHT_MIN_DEFAULT,
  FORECAST_DISPLAY_WEIGHT_MAX_DEFAULT,
  FORECAST_FALLBACK_ADG_DEFAULT,
  FORECAST_BIRTH_WEIGHT_LB_DEFAULT,
  FORECAST_HORIZON_YEARS_DEFAULT,
} from '../lib/cattleForecast.js';
import {
  loadForecastSettings,
  saveForecastSettings,
  loadHeiferIncludes,
  saveHeiferIncludes,
  loadHidden,
  addHidden,
  removeHidden,
} from '../lib/cattleForecastApi.js';
import {CATTLE_HERD_KEYS, cowTagSet} from '../lib/cattleHerdFilters.js';

const HERD_LABELS = {
  mommas: 'Mommas',
  backgrounders: 'Backgrounders',
  finishers: 'Finishers',
  bulls: 'Bulls',
  processed: 'Processed',
  deceased: 'Deceased',
  sold: 'Sold',
};

const HERD_COLORS = {
  mommas: {bg: '#fef2f2', tx: '#991b1b', bd: '#fca5a5'},
  backgrounders: {bg: '#ffedd5', tx: '#9a3412', bd: '#fdba74'},
  finishers: {bg: '#fff1f2', tx: '#9f1239', bd: '#fda4af'},
  bulls: {bg: '#fee2e2', tx: '#7f1d1d', bd: '#fca5a5'},
  processed: {bg: '#f3f4f6', tx: '#374151', bd: '#d1d5db'},
  deceased: {bg: '#f9fafb', tx: '#6b7280', bd: '#e5e7eb'},
  sold: {bg: '#eff6ff', tx: '#1e40af', bd: '#bfdbfe'},
};

const ADG_SOURCE_LABELS = {
  [ADG_SOURCES.ROLLING]: 'rolling 3-week',
  [ADG_SOURCES.TWO_RECENT]: 'two recent',
  [ADG_SOURCES.ONE_PLUS_FALLBACK]: '1 weigh-in + global',
  [ADG_SOURCES.DOB_PLUS_FALLBACK]: 'DOB + global',
  [ADG_SOURCES.GLOBAL_ONLY]: 'global only',
  [ADG_SOURCES.NONE]: '—',
};

const WATCHLIST_REASON_LABELS = {
  [WATCHLIST_REASONS.NO_WEIGHT_NO_DOB]: 'No weight + no DOB',
  [WATCHLIST_REASONS.NEGATIVE_ADG_NO_FINISH]: 'Negative ADG, no finish month',
  [WATCHLIST_REASONS.NEVER_REACHES_WINDOW]: 'Never reaches display window',
  [WATCHLIST_REASONS.ALREADY_OVER_MAX]: 'Already over max weight',
  [WATCHLIST_REASONS.ALL_ELIGIBLE_HIDDEN]: 'All eligible months hidden',
};

const inpS = {
  fontSize: 13,
  padding: '7px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

const lbl = {fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 3, fontWeight: 500};

const tile = {
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: '14px 16px',
};

const sectionHeader = {fontSize: 13, fontWeight: 600, color: '#4b5563', letterSpacing: 0.3, marginBottom: 8};

const CattleForecastView = ({
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
}) => {
  const {useState, useEffect, useMemo} = React;

  // Role gate — UI-only.
  const role = authState && authState.role;
  const canEdit = role === 'admin' || role === 'management';

  // Loaded state.
  const [cattle, setCattle] = useState([]);
  const [weighIns, setWeighIns] = useState([]);
  const [calvingRecs, setCalvingRecs] = useState([]);
  const [comments, setComments] = useState([]);
  const [breedOpts, setBreedOpts] = useState([]);
  const [originOpts, setOriginOpts] = useState([]);
  const [realBatches, setRealBatches] = useState([]);
  const [settings, setSettings] = useState(null);
  // settingsDraft is what the editable controls bind to. settings (above)
  // is what buildForecast actually consumes — only swapped on Save Settings.
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [includes, setIncludes] = useState(new Set());
  const [hidden, setHidden] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [yearFilter, setYearFilter] = useState(null); // null = current year by default
  const [monthFilter, setMonthFilter] = useState(null);
  const [showHeiferModal, setShowHeiferModal] = useState(false);

  async function loadAll() {
    const [cR, wAll, calR, comR, brR, orR, bR, s, inc, hid] = await Promise.all([
      sb.from('cattle').select('*').order('tag'),
      loadCattleWeighInsCached(sb),
      sb.from('cattle_calving_records').select('*').order('calving_date', {ascending: false}),
      sb.from('cattle_comments').select('*').order('created_at', {ascending: false}),
      sb.from('cattle_breeds').select('*').order('label'),
      sb.from('cattle_origins').select('*').order('label'),
      sb.from('cattle_processing_batches').select('*').order('actual_process_date', {ascending: false}),
      loadForecastSettings(sb),
      loadHeiferIncludes(sb),
      loadHidden(sb),
    ]);
    if (cR.data) setCattle(cR.data);
    setWeighIns(wAll || []);
    if (calR.data) setCalvingRecs(calR.data);
    if (comR.data) setComments(comR.data);
    if (brR.data) setBreedOpts(brR.data);
    if (orR.data) setOriginOpts(orR.data);
    if (bR.data) setRealBatches(bR.data);
    setSettings(s);
    setSettingsDraft(s);
    setIncludes(inc);
    setHidden(hid);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // loadAll captured in a stable closure — disable exhaustive-deps for the
    // mount-once contract that matches the rest of the cattle module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial year filter = current year
  useEffect(() => {
    if (yearFilter == null && !loading) {
      setYearFilter(new Date().getUTCFullYear());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Build forecast on every relevant input change. Heavy but tractable
  // (n cattle ~500, n months ~48 → ~24k iterations).
  const forecast = useMemo(() => {
    if (!settings) return null;
    return buildForecast({
      cattle,
      weighIns,
      settings,
      includes,
      hidden,
      realBatches,
      todayMs: Date.now(),
    });
  }, [cattle, weighIns, settings, includes, hidden, realBatches]);

  // ── settings panel handlers ────────────────────────────────────────────────
  function patchDraft(patch) {
    setSettingsDraft((prev) => ({...(prev || {}), ...patch}));
  }
  async function saveSettingsClick() {
    if (!canEdit) return;
    setSavingSettings(true);
    try {
      await saveForecastSettings(sb, settingsDraft, {updatedBy: authState?.name || authState?.user?.email || null});
      setSettings(settingsDraft);
    } catch (e) {
      alert('Could not save Forecast settings: ' + (e.message || e));
    } finally {
      setSavingSettings(false);
    }
  }
  function discardSettingsDraft() {
    setSettingsDraft(settings);
  }

  // ── hide/unhide ────────────────────────────────────────────────────────────
  async function toggleHidden(cattleId, monthKey, currentlyHidden) {
    if (!canEdit) return;
    const teamMember = authState?.name || authState?.user?.email || null;
    try {
      if (currentlyHidden) {
        await removeHidden(sb, {cattleId, monthKey});
        setHidden((prev) => prev.filter((h) => !(h.cattle_id === cattleId && h.month_key === monthKey)));
      } else {
        await addHidden(sb, {cattleId, monthKey, hiddenBy: teamMember});
        setHidden((prev) => [...prev, {cattle_id: cattleId, month_key: monthKey, hidden_by: teamMember}]);
      }
    } catch (e) {
      alert('Could not update hide state: ' + (e.message || e));
    }
  }

  // ── heifer-modal save ─────────────────────────────────────────────────────
  async function saveHeiferIncludesAndClose(nextSet) {
    if (!canEdit) {
      setShowHeiferModal(false);
      return;
    }
    try {
      await saveHeiferIncludes(sb, nextSet, {includedBy: authState?.name || authState?.user?.email || null});
      setIncludes(new Set(nextSet));
    } catch (e) {
      alert('Could not save heifer selections: ' + (e.message || e));
      return;
    }
    setShowHeiferModal(false);
  }

  // ── year / month filter UX ────────────────────────────────────────────────
  const yearsInView = useMemo(() => {
    if (!forecast) return [];
    const ys = new Set();
    for (const b of forecast.monthBuckets) ys.add(b.year);
    // Past actual years from real batches (so we can show historical context).
    for (const rb of realBatches || []) {
      const dt = rb.actual_process_date || rb.planned_process_date;
      if (!dt) continue;
      const y = parseInt(String(dt).slice(0, 4), 10);
      if (Number.isFinite(y)) ys.add(y);
    }
    return [...ys].sort((a, b) => a - b);
  }, [forecast, realBatches]);

  const filteredMonthBuckets = useMemo(() => {
    if (!forecast) return [];
    return forecast.monthBuckets.filter((b) => (yearFilter == null ? true : b.year === yearFilter));
  }, [forecast, yearFilter]);

  // Past actual batches grouped by year for the historical year view.
  const actualBatchesByYear = useMemo(() => {
    const map = new Map();
    for (const rb of realBatches || []) {
      const dt = rb.actual_process_date || rb.planned_process_date;
      if (!dt) continue;
      const y = parseInt(String(dt).slice(0, 4), 10);
      if (!Number.isFinite(y)) continue;
      if (!map.has(y)) map.set(y, []);
      map.get(y).push(rb);
    }
    return map;
  }, [realBatches]);

  // Tag → cow (for showing tags in summary panels).
  const cowsById = useMemo(() => new Map(cattle.map((c) => [c.id, c])), [cattle]);

  // ── render ─────────────────────────────────────────────────────────────────
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
      <div
        style={{
          padding: '1.25rem',
          maxWidth: 1200,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        {/* Title + actions */}
        <div style={{display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap'}} data-cattle-forecast-root>
          <div style={{fontSize: 20, fontWeight: 700, color: '#111827'}}>Cattle Forecast</div>
          {!canEdit && (
            <span
              style={{
                fontSize: 11,
                padding: '3px 8px',
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: 6,
                color: '#1e40af',
                fontWeight: 600,
              }}
              data-forecast-readonly
            >
              READ-ONLY
            </span>
          )}
          <span style={{flex: 1}} />
          {canEdit && (
            <button
              onClick={() => setShowHeiferModal(true)}
              data-include-heifers-btn
              style={{
                padding: '7px 14px',
                borderRadius: 7,
                border: '1px solid #991b1b',
                background: 'white',
                color: '#991b1b',
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              Include Momma Herd Heifers
              {includes.size > 0 && (
                <span
                  style={{
                    marginLeft: 6,
                    padding: '1px 7px',
                    borderRadius: 10,
                    background: '#991b1b',
                    color: 'white',
                    fontSize: 11,
                  }}
                >
                  {includes.size}
                </span>
              )}
            </button>
          )}
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              color: '#374151',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
              data-show-hidden-toggle
            />
            Show hidden
          </label>
          <button
            onClick={() => setShowSettings((v) => !v)}
            style={{
              padding: '7px 14px',
              borderRadius: 7,
              border: '1px solid #d1d5db',
              background: 'white',
              color: '#374151',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {showSettings ? 'Hide settings' : 'Settings'}
          </button>
        </div>

        {loading && <div style={{textAlign: 'center', padding: '3rem', color: '#9ca3af'}}>Loading{'…'}</div>}

        {!loading && forecast && (
          <>
            {/* ── All-years summary strip ─────────────────────────────── */}
            <div data-forecast-summary-strip>
              <div style={sectionHeader}>SUMMARY</div>
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10}}>
                <SummaryTile
                  label="Eligible cattle"
                  value={forecast.summary.totalEligible.toLocaleString()}
                  sub={forecast.summary.totalCount + ' total on farm'}
                />
                <SummaryTile
                  label="Ready this year"
                  value={forecast.summary.readyThisYear.toLocaleString()}
                  color="#991b1b"
                />
                <SummaryTile label="Next year" value={forecast.summary.readyNextYear.toLocaleString()} />
                <SummaryTile label="2 yr out" value={forecast.summary.readyTwoYears.toLocaleString()} />
                <SummaryTile label="3 yr out" value={forecast.summary.readyThreeYears.toLocaleString()} />
                <SummaryTile
                  label="Watchlist"
                  value={forecast.summary.watchlistCount.toLocaleString()}
                  color={forecast.summary.watchlistCount > 0 ? '#92400e' : '#374151'}
                />
              </div>
            </div>

            {/* ── Next Processor Batch panel ──────────────────────────── */}
            <div style={{...tile, borderLeft: '4px solid #991b1b'}} data-next-processor-panel>
              <div style={{display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap'}}>
                <span
                  style={{
                    fontSize: 11,
                    padding: '3px 8px',
                    background: '#991b1b',
                    color: 'white',
                    borderRadius: 4,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  Next Processor Batch
                </span>
                {forecast.nextProcessorBatch ? (
                  <>
                    <span style={{fontSize: 16, fontWeight: 700, color: '#111827'}}>
                      {forecast.nextProcessorBatch.name}
                    </span>
                    <span style={{fontSize: 13, color: '#6b7280'}}>
                      {forecast.nextProcessorBatch.label} · {forecast.nextProcessorBatch.animalIds.length}{' '}
                      {forecast.nextProcessorBatch.animalIds.length === 1 ? 'cow' : 'cows'}
                    </span>
                    {forecast.nextProcessorBatch.projectedTotalLbs > 0 && (
                      <span style={{fontSize: 12, color: '#065f46', fontWeight: 600}}>
                        {Math.round(forecast.nextProcessorBatch.projectedTotalLbs).toLocaleString()} lb projected
                      </span>
                    )}
                  </>
                ) : (
                  <span style={{fontSize: 13, color: '#6b7280', fontStyle: 'italic'}}>
                    No virtual batch — no eligible cattle land in the display window.
                  </span>
                )}
              </div>
              {forecast.nextProcessorBatch && forecast.nextProcessorBatch.animalIds.length > 0 && (
                <div style={{marginTop: 10}}>
                  <div
                    style={{
                      fontSize: 10,
                      color: '#9ca3af',
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                      marginBottom: 4,
                    }}
                  >
                    Allowed tags (Send-to-Processor must match this set)
                  </div>
                  <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}} data-next-processor-tags>
                    {[...forecast.nextProcessorBatch.allowedTagSet].sort().map((tag) => (
                      <span
                        key={tag}
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          padding: '3px 9px',
                          borderRadius: 999,
                          background: '#fef2f2',
                          color: '#991b1b',
                          border: '1px solid #fca5a5',
                        }}
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Settings panel (collapsible; read-only for farm_team) ── */}
            {showSettings && settingsDraft && (
              <div style={tile} data-forecast-settings-panel>
                <div style={sectionHeader}>SETTINGS</div>
                {!canEdit && (
                  <div
                    style={{
                      fontSize: 11,
                      color: '#1e40af',
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      borderRadius: 6,
                      padding: '6px 10px',
                      marginBottom: 10,
                    }}
                  >
                    Read-only view. Management or admin can edit forecast settings.
                  </div>
                )}
                <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10}}>
                  <NumField
                    label="Display weight min (lb)"
                    value={settingsDraft.displayMin}
                    disabled={!canEdit}
                    onChange={(v) => patchDraft({displayMin: v})}
                  />
                  <NumField
                    label="Display weight max (lb)"
                    value={settingsDraft.displayMax}
                    disabled={!canEdit}
                    onChange={(v) => patchDraft({displayMax: v})}
                  />
                  <NumField
                    label="Fallback ADG (lb/day)"
                    value={settingsDraft.fallbackAdg}
                    step="0.01"
                    disabled={!canEdit}
                    onChange={(v) => patchDraft({fallbackAdg: v})}
                  />
                  <NumField
                    label="Birth weight (lb)"
                    value={settingsDraft.birthWeight}
                    disabled={!canEdit}
                    onChange={(v) => patchDraft({birthWeight: v})}
                  />
                  <NumField
                    label="Horizon (years)"
                    value={settingsDraft.horizonYears}
                    min="1"
                    max="5"
                    disabled={!canEdit}
                    onChange={(v) => patchDraft({horizonYears: v})}
                  />
                  <NumField
                    label="Monthly capacity (optional)"
                    value={settingsDraft.monthlyCapacity}
                    disabled={!canEdit}
                    onChange={(v) => patchDraft({monthlyCapacity: v})}
                  />
                </div>
                {canEdit && (
                  <div style={{display: 'flex', gap: 8, marginTop: 12, alignItems: 'center'}}>
                    <button
                      onClick={saveSettingsClick}
                      disabled={savingSettings}
                      data-save-settings-btn
                      style={{
                        padding: '7px 16px',
                        borderRadius: 7,
                        border: 'none',
                        background: '#991b1b',
                        color: 'white',
                        fontWeight: 600,
                        fontSize: 12,
                        cursor: savingSettings ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit',
                        opacity: savingSettings ? 0.6 : 1,
                      }}
                    >
                      {savingSettings ? 'Saving…' : 'Save Settings'}
                    </button>
                    <button
                      onClick={discardSettingsDraft}
                      style={{
                        padding: '7px 14px',
                        borderRadius: 7,
                        border: '1px solid #d1d5db',
                        background: 'white',
                        color: '#6b7280',
                        fontSize: 12,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      Discard
                    </button>
                    <span style={{fontSize: 11, color: '#9ca3af', fontStyle: 'italic'}}>
                      Settings edits don't recompute the forecast until saved.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* ── Year selector ───────────────────────────────────────── */}
            {yearsInView.length > 0 && (
              <div style={{display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap'}}>
                <span style={{fontSize: 11, color: '#6b7280', fontWeight: 600, marginRight: 4}}>YEAR</span>
                {yearsInView.map((y) => (
                  <button
                    key={y}
                    onClick={() => {
                      setYearFilter(y);
                      setMonthFilter(null);
                    }}
                    data-year-button={y}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 600,
                      border: yearFilter === y ? '1px solid #991b1b' : '1px solid #d1d5db',
                      background: yearFilter === y ? '#fef2f2' : 'white',
                      color: yearFilter === y ? '#991b1b' : '#374151',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {y}
                  </button>
                ))}
              </div>
            )}

            {/* ── Visual main chart: projected head count by month ────── */}
            {filteredMonthBuckets.length > 0 && (
              <ForecastChart buckets={filteredMonthBuckets} actualBatches={actualBatchesByYear.get(yearFilter) || []} />
            )}

            {/* ── Month buckets (assigned visible cattle) ─────────────── */}
            <div data-forecast-month-buckets>
              <div style={sectionHeader}>MONTHS</div>
              <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
                {filteredMonthBuckets.map((b) => (
                  <MonthBucketTile
                    key={b.monthKey}
                    bucket={b}
                    forecast={forecast}
                    cowsById={cowsById}
                    canEdit={canEdit}
                    showHidden={showHidden}
                    hidden={hidden}
                    onToggleHidden={toggleHidden}
                    monthFilter={monthFilter}
                    setMonthFilter={setMonthFilter}
                  />
                ))}
              </div>
            </div>

            {/* ── Watchlist ─────────────────────────────────────────────── */}
            {forecast.watchlist.length > 0 && (
              <Watchlist
                rows={forecast.watchlist}
                canEdit={canEdit}
                showHidden={showHidden}
                onToggleHidden={toggleHidden}
              />
            )}

            {/* ── Past actuals — historical actual batches for context ── */}
            {yearFilter != null && actualBatchesByYear.has(yearFilter) && (
              <PastActuals batches={actualBatchesByYear.get(yearFilter)} fmt={fmt} />
            )}
          </>
        )}
      </div>

      {/* Include Momma Herd Heifers modal */}
      {showHeiferModal && (
        <IncludeHeifersModal
          cattle={cattle}
          weighIns={weighIns}
          calvingRecs={calvingRecs}
          comments={comments}
          breedOpts={breedOpts}
          originOpts={originOpts}
          fmt={fmt}
          authState={authState}
          initialIncludes={includes}
          canEdit={canEdit}
          onConfirm={saveHeiferIncludesAndClose}
          onClose={() => setShowHeiferModal(false)}
          sb={sb}
          reload={loadAll}
        />
      )}
    </div>
  );
};

// ── small UI subcomponents ────────────────────────────────────────────────────

function SummaryTile({label, value, sub, color = '#991b1b'}) {
  return (
    <div style={tile}>
      <div style={{fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4}}>
        {label}
      </div>
      <div style={{fontSize: 22, fontWeight: 700, color, lineHeight: 1}}>{value}</div>
      {sub && <div style={{fontSize: 11, color: '#9ca3af', marginTop: 3}}>{sub}</div>}
    </div>
  );
}

function NumField({label, value, onChange, disabled, step = '1', min, max}) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input
        type="number"
        value={value == null ? '' : value}
        step={step}
        min={min}
        max={max}
        disabled={!!disabled}
        onChange={(e) => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
        style={{...inpS, background: disabled ? '#f9fafb' : 'white'}}
      />
    </div>
  );
}

function ForecastChart({buckets, actualBatches}) {
  // Simple inline SVG bar chart — projected head count per month for the
  // selected year. Keeps deps zero (no chart library).
  const max = Math.max(1, ...buckets.map((b) => b.count));
  // Max also informed by actual batches for visual scale across both.
  const actualByMonth = new Map();
  for (const rb of actualBatches || []) {
    const dt = rb.actual_process_date || rb.planned_process_date;
    if (!dt) continue;
    const k = String(dt).slice(0, 7);
    actualByMonth.set(k, (actualByMonth.get(k) || 0) + (Array.isArray(rb.cows_detail) ? rb.cows_detail.length : 0));
  }
  const allCounts = [...buckets.map((b) => b.count), ...actualByMonth.values()];
  const yMax = Math.max(1, ...allCounts);
  const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const cellWidth = 70;
  const cellHeight = 140;
  const totalWidth = cellWidth * buckets.length + 30;
  return (
    <div style={tile}>
      <div style={sectionHeader}>PROJECTED HEAD COUNT BY MONTH</div>
      <div style={{overflowX: 'auto'}} data-forecast-chart>
        <svg width={Math.max(totalWidth, 600)} height={cellHeight + 60} style={{display: 'block'}}>
          {/* y-axis baseline */}
          <line x1="20" y1={cellHeight + 20} x2={totalWidth + 10} y2={cellHeight + 20} stroke="#e5e7eb" />
          {buckets.map((b, i) => {
            const x = 30 + i * cellWidth;
            const month = parseMonthKey(b.monthKey).month;
            const projHeight = (b.count / yMax) * cellHeight;
            const actualCount = actualByMonth.get(b.monthKey) || 0;
            const actualHeight = (actualCount / yMax) * cellHeight;
            return (
              <g key={b.monthKey}>
                {/* Projected bar (lighter) */}
                {b.count > 0 && (
                  <rect
                    x={x}
                    y={cellHeight + 20 - projHeight}
                    width={cellWidth - 18}
                    height={projHeight}
                    fill="#fda4af"
                    stroke="#9f1239"
                    strokeWidth="1"
                    data-chart-projected={b.monthKey}
                  >
                    <title>{`${b.label}: ${b.count} projected`}</title>
                  </rect>
                )}
                {/* Actual bar (overlays, darker, narrower) */}
                {actualCount > 0 && (
                  <rect
                    x={x + 6}
                    y={cellHeight + 20 - actualHeight}
                    width={cellWidth - 30}
                    height={actualHeight}
                    fill="#7f1d1d"
                    data-chart-actual={b.monthKey}
                  >
                    <title>{`${b.label}: ${actualCount} actual`}</title>
                  </rect>
                )}
                {/* Count label above bar */}
                {b.count > 0 && (
                  <text
                    x={x + (cellWidth - 18) / 2}
                    y={cellHeight + 20 - projHeight - 4}
                    textAnchor="middle"
                    fontSize="10"
                    fill="#7f1d1d"
                    fontWeight="600"
                  >
                    {b.count}
                  </text>
                )}
                {/* Month label below */}
                <text x={x + (cellWidth - 18) / 2} y={cellHeight + 38} textAnchor="middle" fontSize="11" fill="#6b7280">
                  {labels[month - 1]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{display: 'flex', gap: 14, marginTop: 6, fontSize: 11, color: '#6b7280'}}>
        <LegendSwatch color="#fda4af" border="#9f1239" label="Projected (virtual)" />
        <LegendSwatch color="#7f1d1d" label="Actual (sent to processor)" />
      </div>
    </div>
  );
}

function LegendSwatch({color, border, label}) {
  return (
    <span style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
      <span
        style={{
          display: 'inline-block',
          width: 12,
          height: 12,
          background: color,
          border: border ? '1px solid ' + border : 'none',
          borderRadius: 2,
        }}
      />
      {label}
    </span>
  );
}

function MonthBucketTile({
  bucket,
  forecast,
  cowsById,
  canEdit,
  showHidden,
  hidden,
  onToggleHidden,
  monthFilter,
  setMonthFilter,
}) {
  const {useState} = React;
  const [expanded, setExpanded] = useState(monthFilter === bucket.monthKey);
  const isFiltered = monthFilter === bucket.monthKey;
  const visibleCount = bucket.count;
  return (
    <div
      style={{
        background: 'white',
        border: '1px solid ' + (isFiltered ? '#991b1b' : '#e5e7eb'),
        borderRadius: 12,
        overflow: 'hidden',
      }}
      data-month-bucket={bucket.monthKey}
    >
      <div
        onClick={() => {
          setExpanded((v) => !v);
          setMonthFilter(isFiltered ? null : bucket.monthKey);
        }}
        style={{
          padding: '12px 18px',
          background: isFiltered ? '#fef2f2' : '#fafafa',
          borderBottom: expanded ? '1px solid #f3f4f6' : 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          cursor: 'pointer',
        }}
      >
        <span style={{fontSize: 12, color: '#9ca3af'}}>{expanded ? '▼' : '▶'}</span>
        <span style={{fontSize: 14, fontWeight: 700, color: '#111827'}}>{bucket.label}</span>
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 999,
            background: visibleCount > 0 ? '#fef2f2' : '#f3f4f6',
            color: visibleCount > 0 ? '#991b1b' : '#6b7280',
            fontWeight: 600,
          }}
        >
          {visibleCount} {visibleCount === 1 ? 'cow' : 'cows'}
        </span>
        {bucket.projectedTotalLbs > 0 && (
          <span style={{fontSize: 11, color: '#065f46', fontWeight: 600}}>
            {Math.round(bucket.projectedTotalLbs).toLocaleString()} lb projected
          </span>
        )}
        {bucket.overCapacity && (
          <span
            style={{
              fontSize: 10,
              padding: '1px 7px',
              borderRadius: 4,
              background: '#fef2f2',
              color: '#b91c1c',
              fontWeight: 700,
              textTransform: 'uppercase',
            }}
          >
            Over capacity
          </span>
        )}
      </div>
      {expanded && (
        <div style={{padding: '12px 18px'}}>
          {(() => {
            // Two row sets:
            //   - assigned: cattle whose first-eligible-unhidden month is THIS one
            //   - hiddenHere: cattle hidden FOR this month, even if their
            //     current assignment rolled forward to a later month.
            //     Required so admin can unhide a row whose assignment moved
            //     when the operator hid it.
            const assigned = bucket.animalIds.slice();
            const hiddenHereOnly = (bucket.hiddenAnimalIds || []).filter((cid) => !assigned.includes(cid));
            if (assigned.length === 0 && (!showHidden || hiddenHereOnly.length === 0)) {
              return (
                <div style={{fontSize: 12, color: '#9ca3af', fontStyle: 'italic'}}>No projected cattle this month.</div>
              );
            }
            return (
              <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 12}} data-month-bucket-table>
                <thead>
                  <tr
                    style={{
                      textAlign: 'left',
                      color: '#9ca3af',
                      fontSize: 10,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}
                  >
                    <th style={{padding: '4px 8px'}}>Tag</th>
                    <th style={{padding: '4px 8px'}}>Sex</th>
                    <th style={{padding: '4px 8px'}}>Herd</th>
                    <th style={{padding: '4px 8px', textAlign: 'right'}}>Latest</th>
                    <th style={{padding: '4px 8px', textAlign: 'right'}}>Projected</th>
                    <th style={{padding: '4px 8px'}}>ADG src</th>
                    <th style={{padding: '4px 8px', textAlign: 'right'}}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Assigned rows */}
                  {assigned.map((cid) => {
                    const cow = cowsById.get(cid);
                    if (!cow) return null;
                    const row = forecast.animalRows.find((r) => r.cow.id === cid);
                    return (
                      <tr key={cid} data-month-row={cid} style={{borderTop: '1px solid #f3f4f6'}}>
                        <td style={{padding: '6px 8px', fontWeight: 700, color: '#111827'}}>#{cow.tag || '?'}</td>
                        <td style={{padding: '6px 8px', color: '#6b7280'}}>{cow.sex || '—'}</td>
                        <td style={{padding: '6px 8px', color: '#6b7280'}}>{HERD_LABELS[cow.herd] || cow.herd}</td>
                        <td style={{padding: '6px 8px', textAlign: 'right', color: '#111827'}}>
                          {row?.latest ? Math.round(row.latest.weight).toLocaleString() + ' lb' : '—'}
                        </td>
                        <td style={{padding: '6px 8px', textAlign: 'right', color: '#065f46', fontWeight: 600}}>
                          {row?.projectedWeightAtReady
                            ? Math.round(row.projectedWeightAtReady).toLocaleString() + ' lb'
                            : '—'}
                        </td>
                        <td style={{padding: '6px 8px', color: '#6b7280', fontSize: 11}}>
                          {ADG_SOURCE_LABELS[row?.adgSource] || '—'}
                          {row?.negativeAdg && (
                            <span style={{color: '#b91c1c', fontWeight: 700, marginLeft: 4}}>(neg)</span>
                          )}
                        </td>
                        <td style={{padding: '6px 8px', textAlign: 'right'}}>
                          {canEdit ? (
                            <button
                              onClick={() => onToggleHidden(cid, bucket.monthKey, false)}
                              data-toggle-hide={cid}
                              style={{
                                fontSize: 11,
                                padding: '3px 8px',
                                borderRadius: 5,
                                border: '1px solid #fecaca',
                                background: '#fef2f2',
                                color: '#b91c1c',
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                                fontWeight: 600,
                              }}
                            >
                              Hide
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Hidden-here-only rows — surfaced when Show hidden is on,
                      even if their current assignment rolled to another month.
                      Each row's Unhide button removes the hide for THIS month. */}
                  {showHidden &&
                    hiddenHereOnly.map((cid) => {
                      const cow = cowsById.get(cid);
                      if (!cow) return null;
                      const row = forecast.animalRows.find((r) => r.cow.id === cid);
                      return (
                        <tr
                          key={'hidden-' + cid}
                          data-month-hidden-row={cid}
                          style={{borderTop: '1px solid #f3f4f6', opacity: 0.55, background: '#fafafa'}}
                        >
                          <td style={{padding: '6px 8px', fontWeight: 700, color: '#111827'}}>#{cow.tag || '?'}</td>
                          <td style={{padding: '6px 8px', color: '#6b7280'}}>{cow.sex || '—'}</td>
                          <td style={{padding: '6px 8px', color: '#6b7280'}}>{HERD_LABELS[cow.herd] || cow.herd}</td>
                          <td style={{padding: '6px 8px', textAlign: 'right', color: '#9ca3af'}}>
                            {row?.latest ? Math.round(row.latest.weight).toLocaleString() + ' lb' : '—'}
                          </td>
                          <td style={{padding: '6px 8px', textAlign: 'right', color: '#9ca3af'}}>
                            {row?.readyMonth ? 'rolled to ' + monthLabel(row.readyMonth) : 'no eligible month'}
                          </td>
                          <td style={{padding: '6px 8px', color: '#9ca3af', fontSize: 11, fontStyle: 'italic'}}>
                            hidden here
                          </td>
                          <td style={{padding: '6px 8px', textAlign: 'right'}}>
                            {canEdit ? (
                              <button
                                onClick={() => onToggleHidden(cid, bucket.monthKey, true)}
                                data-toggle-unhide={cid}
                                style={{
                                  fontSize: 11,
                                  padding: '3px 8px',
                                  borderRadius: 5,
                                  border: '1px solid #bfdbfe',
                                  background: '#eff6ff',
                                  color: '#1e40af',
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                  fontWeight: 600,
                                }}
                              >
                                Unhide
                              </button>
                            ) : (
                              <span style={{fontSize: 10, color: '#9ca3af'}}>hidden</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function Watchlist({rows, canEdit, showHidden, onToggleHidden}) {
  return (
    <div style={tile} data-forecast-watchlist>
      <div style={sectionHeader}>
        WATCHLIST
        <span style={{fontWeight: 400, color: '#9ca3af', marginLeft: 6}}>({rows.length})</span>
      </div>
      <div style={{fontSize: 11, color: '#6b7280', marginBottom: 8}}>
        Cattle that don't land cleanly in a forecast month — review and adjust manually.
      </div>
      <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 12}}>
        <thead>
          <tr
            style={{textAlign: 'left', color: '#9ca3af', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5}}
          >
            <th style={{padding: '4px 8px'}}>Tag</th>
            <th style={{padding: '4px 8px'}}>Herd</th>
            <th style={{padding: '4px 8px'}}>Reasons</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cow.id} style={{borderTop: '1px solid #f3f4f6'}}>
              <td style={{padding: '6px 8px', fontWeight: 700, color: '#111827'}}>#{r.cow.tag || '?'}</td>
              <td style={{padding: '6px 8px', color: '#6b7280'}}>{HERD_LABELS[r.cow.herd] || r.cow.herd}</td>
              <td style={{padding: '6px 8px', color: '#92400e'}}>
                {r.watchlistReasons.length > 0
                  ? r.watchlistReasons.map((x) => WATCHLIST_REASON_LABELS[x] || x).join(', ')
                  : 'No eligible month'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PastActuals({batches, fmt}) {
  if (!batches || batches.length === 0) return null;
  return (
    <div style={tile} data-forecast-past-actuals>
      <div style={sectionHeader}>PAST ACTUAL BATCHES</div>
      <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
        {batches.map((rb) => {
          const cows = Array.isArray(rb.cows_detail) ? rb.cows_detail : [];
          return (
            <div
              key={rb.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 8px',
                background: rb.status === 'complete' ? '#f9fafb' : '#fef2f2',
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              <strong>{rb.name}</strong>
              <span
                style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  background: rb.status === 'complete' ? '#374151' : '#1d4ed8',
                  color: 'white',
                  borderRadius: 4,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                }}
              >
                {rb.status}
              </span>
              <span style={{color: '#6b7280'}}>
                {cows.length} {cows.length === 1 ? 'cow' : 'cows'}
              </span>
              <span style={{color: '#6b7280'}}>{fmt(rb.actual_process_date || rb.planned_process_date)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── IncludeHeifersModal ───────────────────────────────────────────────────────
function IncludeHeifersModal({
  cattle,
  weighIns,
  calvingRecs,
  comments,
  breedOpts,
  originOpts,
  fmt,
  authState,
  initialIncludes,
  canEdit,
  onConfirm,
  onClose,
  sb,
  reload,
}) {
  const {useState, useMemo} = React;
  const heifers = useMemo(() => cattle.filter((c) => c.herd === 'mommas' && c.sex === 'heifer'), [cattle]);
  const [staged, setStaged] = useState(new Set(initialIncludes));
  const [expandedId, setExpandedId] = useState(null);
  const [confirming, setConfirming] = useState(false);

  function toggle(id) {
    if (!canEdit) return;
    setStaged((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Inline auto-save patch (mirrors CattleHerdsView.patchCow)
  async function patchCow(cowId, fields) {
    if (!cowId || !fields) return;
    const r = await sb.from('cattle').update(fields).eq('id', cowId);
    if (r.error) {
      alert('Save failed: ' + r.error.message);
      return;
    }
    if (reload) await reload();
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,.45)',
        zIndex: 500,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '1rem',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: 12,
          width: '100%',
          maxWidth: 920,
          boxShadow: '0 8px 32px rgba(0,0,0,.2)',
          marginTop: 40,
        }}
        data-include-heifers-modal
      >
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{fontSize: 15, fontWeight: 600, color: '#991b1b'}}>Include Momma Herd Heifers</div>
          <button
            onClick={onClose}
            style={{background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#9ca3af'}}
          >
            {'×'}
          </button>
        </div>
        <div style={{padding: '8px 20px 4px', fontSize: 11, color: '#6b7280'}}>
          {heifers.length} heifer{heifers.length === 1 ? '' : 's'} currently in mommas. Selected heifers are included in
          the forecast using global ADG. Previously selected heifers are highlighted; click rows to expand and edit
          details. Save the exact checked set with <strong>Confirm Selections</strong>.
        </div>
        <div style={{padding: '12px 20px 0', maxHeight: '60vh', overflowY: 'auto'}}>
          {heifers.length === 0 ? (
            <div style={{fontSize: 12, color: '#9ca3af', fontStyle: 'italic', padding: '1rem 0'}}>
              No heifers currently classified in the mommas herd.
            </div>
          ) : (
            heifers.map((h) => {
              const checked = staged.has(h.id);
              const wasIncluded = initialIncludes.has(h.id);
              const isExpanded = expandedId === h.id;
              const cTags = cowTagSet(h);
              const cowWeighIns = weighIns.filter((w) => cTags.has(String(w.tag)));
              const cowCalving = calvingRecs.filter((r) => r.dam_tag === h.tag);
              const cowComments = comments
                .filter((cm) => cm.cattle_id === h.id || cm.cattle_tag === h.tag)
                .slice(0, 20);
              return (
                <div
                  key={h.id}
                  data-heifer-row={h.id}
                  style={{
                    border: '1px solid ' + (checked ? '#fca5a5' : '#e5e7eb'),
                    borderRadius: 8,
                    marginBottom: 8,
                    overflow: 'hidden',
                    background: wasIncluded ? '#fef2f2' : 'white',
                  }}
                >
                  <div
                    style={{
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!canEdit}
                      onChange={() => toggle(h.id)}
                      data-heifer-checkbox={h.id}
                    />
                    <span style={{fontWeight: 700, fontSize: 13, color: '#111827', minWidth: 60}}>#{h.tag || '?'}</span>
                    <span style={{fontSize: 11, color: '#6b7280'}}>{h.breed || '—'}</span>
                    <span style={{fontSize: 11, color: '#6b7280'}}>{h.origin || '—'}</span>
                    {wasIncluded && (
                      <span
                        style={{
                          fontSize: 10,
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: '#991b1b',
                          color: 'white',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                        }}
                      >
                        previously selected
                      </span>
                    )}
                    <span style={{flex: 1}} />
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : h.id)}
                      style={{
                        fontSize: 11,
                        padding: '3px 9px',
                        borderRadius: 5,
                        border: '1px solid #d1d5db',
                        background: 'white',
                        color: '#374151',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      {isExpanded ? 'Collapse' : 'Details'}
                    </button>
                  </div>
                  {isExpanded && (
                    <CowDetail
                      cow={h}
                      weighIns={cowWeighIns}
                      calving={cowCalving}
                      comments={cowComments}
                      calves={cattle.filter((x) => x.dam_tag === h.tag)}
                      dam={cattle.find((x) => x.tag === h.dam_tag)}
                      cattleList={cattle}
                      fmt={fmt}
                      HERDS={[...CATTLE_HERD_KEYS]}
                      HERD_LABELS={HERD_LABELS}
                      HERD_COLORS={HERD_COLORS}
                      onEdit={() => {}}
                      onTransfer={() => {}}
                      onDelete={() => {}}
                      onComment={() => {}}
                      onEditComment={() => {}}
                      onDeleteComment={() => {}}
                      onAddCalving={() => {}}
                      onDeleteCalving={() => {}}
                      onNavigateToCow={() => {}}
                      onNavigateBack={() => setExpandedId(null)}
                      canNavigateBack={false}
                      backToTag={null}
                      onPatch={(fields) => patchCow(h.id, fields)}
                      onClose={() => setExpandedId(null)}
                      originOpts={originOpts}
                      breedOpts={breedOpts}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <span style={{fontSize: 11, color: '#6b7280'}}>
            {staged.size} selected
            {staged.size !== initialIncludes.size && (
              <span style={{marginLeft: 6, color: '#92400e', fontStyle: 'italic'}}>
                ({initialIncludes.size} previously)
              </span>
            )}
          </span>
          <span style={{flex: 1}} />
          {canEdit && (
            <button
              onClick={async () => {
                setConfirming(true);
                await onConfirm(staged);
                setConfirming(false);
              }}
              disabled={confirming}
              data-confirm-heifers-btn
              style={{
                padding: '7px 16px',
                borderRadius: 7,
                border: 'none',
                background: '#991b1b',
                color: 'white',
                fontWeight: 600,
                fontSize: 12,
                cursor: confirming ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                opacity: confirming ? 0.6 : 1,
              }}
            >
              {confirming ? 'Saving…' : 'Confirm Selections'}
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '7px 14px',
              borderRadius: 7,
              border: '1px solid #d1d5db',
              background: 'white',
              color: '#6b7280',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {canEdit ? 'Cancel' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CattleForecastView;
