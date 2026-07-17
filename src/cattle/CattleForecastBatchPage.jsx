// Forecast-only planned batch detail — a LIVE projection keyed by the stable
// forecast monthKey, mounted at /cattle/batches/forecast/<monthKey>. This is
// deliberately NOT a persisted cattle_processing_batches record page: there
// is no record row, no collaboration stream, no rename/date controls. Every
// visit (including direct links and refresh) reconstructs the same projection
// from live data through the canonical helpers (loadCattleForecastBundle →
// buildForecast → projectPlannedRoster), so this page can never disagree
// with the consolidated Planned list.
//
// When the month's planned batch has since been SCHEDULED, this page points
// at the persisted record instead of rendering a shadow copy. When the month
// no longer has a cohort (cattle rolled forward / were hidden / were sent),
// it fails closed with an explicit empty state — never zero/fabricated rows.
import React from 'react';
import {useNavigate} from 'react-router-dom';
// eslint-disable-next-line no-unused-vars -- JSX-only use (eslint flat config has no react/jsx-uses-vars rule)
import RecordPageLoadError from '../shared/RecordPageLoadError.jsx';
/* eslint-disable no-unused-vars -- shell primitives are used in JSX only */
import {
  RecordPageFrame,
  RecordPageLoading,
  RecordPageBody,
  RecordBackLink,
  RecordTitle,
} from '../shared/RecordPageShell.jsx';
/* eslint-enable no-unused-vars */
// eslint-disable-next-line no-unused-vars -- JSX-only use (eslint flat config has no react/jsx-uses-vars rule)
import Badge from '../shared/Badge.jsx';
// eslint-disable-next-line no-unused-vars -- JSX-only use (eslint flat config has no react/jsx-uses-vars rule)
import ProjectedRosterTable from './ProjectedRosterTable.jsx';
import {parseMonthKey, projectPlannedRoster} from '../lib/cattleForecast.js';
import {loadCattleForecastBundle, forecastFromBundle} from '../lib/cattleForecastApi.js';

export default function CattleForecastBatchPage({sb, fmt, Header, monthKey}) {
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(null);
  const [forecast, setForecast] = React.useState(null);

  const validMonth = !!parseMonthKey(monthKey || '');

  async function loadAll() {
    setLoading(true);
    setLoadError(null);
    try {
      const bundle = await loadCattleForecastBundle(sb);
      setForecast(forecastFromBundle(bundle));
    } catch (e) {
      setForecast(null);
      setLoadError({
        kind: 'error',
        message:
          'Could not load the cattle forecast for this planned batch. Please refresh the page. (' +
          ((e && e.message) || e) +
          ')',
      });
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (!validMonth) {
      setLoading(false);
      return;
    }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey]);

  const back = () => navigate('/cattle/batches');

  if (loading) {
    return <RecordPageLoading Header={Header} />;
  }
  if (!validMonth) {
    return (
      <RecordPageFrame Header={Header}>
        <RecordPageBody maxWidth={900}>
          <RecordBackLink label="Back to Processing Batches" onBack={back} />
          <div
            data-forecast-batch-invalid-month="1"
            style={{
              background: 'white',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '1.25rem',
              color: 'var(--ink-muted)',
              fontSize: 13,
            }}
          >
            Not a valid forecast month.
          </div>
        </RecordPageBody>
      </RecordPageFrame>
    );
  }
  if (loadError) {
    return (
      <RecordPageLoadError
        Header={Header}
        backLabel="Back to Processing Batches"
        onBack={back}
        notice={loadError}
        onRetry={loadAll}
        maxWidth={900}
        data-forecast-batch-load-error="true"
      />
    );
  }

  const scheduled = (forecast?.scheduledBatches || []).find((s) => s && s.monthKey === monthKey) || null;
  const virtual = (forecast?.virtualBatches || []).find((v) => v && v.monthKey === monthKey) || null;
  const roster = projectPlannedRoster(forecast, monthKey);

  // The month's planned batch became a persisted scheduled record — point at
  // the real record page rather than rendering a shadow copy of it here.
  if (scheduled) {
    return (
      <RecordPageFrame Header={Header}>
        <RecordPageBody maxWidth={900} data-forecast-batch-scheduled-pointer={scheduled.id}>
          <RecordBackLink label="Back to Processing Batches" onBack={back} />
          <div
            style={{
              background: 'white',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '1.25rem',
              fontSize: 13,
              color: 'var(--ink)',
            }}
          >
            This month&apos;s planned batch is now scheduled as <strong>{scheduled.name}</strong>
            {scheduled.planned_process_date ? ' for ' + fmt(scheduled.planned_process_date) : ''}.
            <div style={{marginTop: 10}}>
              <button
                type="button"
                data-forecast-batch-open-scheduled={scheduled.id}
                onClick={() => navigate('/cattle/batches/' + scheduled.id)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 10,
                  border: '1px solid var(--brand)',
                  background: 'white',
                  color: 'var(--brand)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Open {scheduled.name}
              </button>
            </div>
          </div>
        </RecordPageBody>
      </RecordPageFrame>
    );
  }

  if (!virtual || !roster.ok) {
    return (
      <RecordPageFrame Header={Header}>
        <RecordPageBody maxWidth={900}>
          <RecordBackLink label="Back to Processing Batches" onBack={back} />
          <div
            data-forecast-batch-empty="1"
            style={{
              background: 'white',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '1.25rem',
              color: 'var(--ink-muted)',
              fontSize: 13,
            }}
          >
            No forecast cohort currently lands in {roster.ok ? roster.label : monthKey}. Cattle may have rolled to a
            different month, been hidden, or already been sent to the processor.
          </div>
        </RecordPageBody>
      </RecordPageFrame>
    );
  }

  return (
    <RecordPageFrame Header={Header}>
      <RecordPageBody maxWidth={900} data-forecast-batch-loaded="true">
        <RecordBackLink label="Back to Processing Batches" onBack={back} />

        <div style={{display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12}}>
          <RecordTitle fontSize={22} margin={0}>
            {virtual.name}
          </RecordTitle>
          <Badge variant="neutral" style={{textTransform: 'uppercase'}}>
            Forecast
          </Badge>
          <span style={{fontSize: 12, color: 'var(--ink-muted)'}}>{virtual.label}</span>
          <span style={{fontSize: 12, color: 'var(--ink-muted)'}}>
            {roster.count} {roster.count === 1 ? 'cow' : 'cows'} projected
          </span>
          <span style={{fontSize: 12, fontWeight: 600, color: 'var(--text-primary)'}}>
            {Math.round(roster.projectedTotalLbs).toLocaleString()} lb projected
          </span>
        </div>

        <div
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '10px 14px',
            marginBottom: 12,
            fontSize: 12,
            color: 'var(--ink-muted)',
          }}
        >
          Forecast-only planned batch — a live projection from the cattle forecast, not a saved record. It updates as
          weigh-ins land, and becomes a record when scheduled from the Planned list or sent from WeighIns.
        </div>

        <div
          style={{
            background: 'white',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '14px 18px',
            marginBottom: 12,
          }}
        >
          <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8}}>
            <span style={{fontSize: 13, fontWeight: 700, color: 'var(--ink)'}}>Projected roster</span>
            <Badge variant="info" style={{textTransform: 'uppercase'}}>
              Projected
            </Badge>
          </div>
          <ProjectedRosterTable roster={roster} />
        </div>
      </RecordPageBody>
    </RecordPageFrame>
  );
}
