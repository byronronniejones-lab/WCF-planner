import React from 'react';
import './homeRedesign.css';
import InlineNotice from '../shared/InlineNotice.jsx';
import {sb} from '../lib/supabase.js';
import {loadProductionSources} from '../lib/productionApi.js';
import {
  PAGE_PRODUCTION_PROGRAMS,
  PROGRAM_BY_KEY,
  buildProductionModel,
  formatEventQuantity,
  formatProductionDelta,
  formatProductionNumber,
  totalsForYear,
} from '../lib/production.js';

function Chevron({className}) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function sourceName(event) {
  return event.source === 'legacy' ? 'Legacy spreadsheet' : 'Planner';
}

function auditLabel(status) {
  return {
    matched: 'Matched',
    matched_loose: 'Matched',
    legacy_only: 'Legacy only',
    possible_duplicate: 'Review',
    conflict: 'Conflict',
  }[status || ''];
}

function auditClass(status) {
  if (status === 'legacy_only' || status === 'matched' || status === 'matched_loose') return 'badge-ok';
  if (status === 'conflict') return 'badge-danger';
  return 'badge-warn';
}

function formatDate(date) {
  if (!date) return '--';
  const [y, m, d] = date.split('-');
  return `${m}/${d}/${y.slice(2)}`;
}

function ProgramTotalsTable({programKey, rows}) {
  const program = PROGRAM_BY_KEY[programKey];
  return (
    <section className="production-program" data-production-program={programKey}>
      <h3>{program.label}</h3>
      <div className="production-table-wrap">
        <table className="production-table">
          <thead>
            <tr>
              <th>Year</th>
              <th>{program.quantityLabel}</th>
              <th>YoY</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan="3" className="production-empty-cell">
                  No records
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.year}>
                  <td>{row.year}</td>
                  <td>{formatProductionNumber(programKey, row.quantity)}</td>
                  <td className={row.yoy > 0 ? 'is-up' : row.yoy < 0 ? 'is-down' : undefined}>
                    {formatProductionDelta(programKey, row.yoy)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EventsTable({events}) {
  return (
    <div className="production-table-wrap">
      <table className="production-table production-events-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Program</th>
            <th>Batch</th>
            <th>Count</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 ? (
            <tr>
              <td colSpan="5" className="production-empty-cell">
                No records
              </td>
            </tr>
          ) : (
            events.map((event) => (
              <tr key={event.id}>
                <td>{formatDate(event.date)}</td>
                <td>{PROGRAM_BY_KEY[event.program]?.label || event.program}</td>
                <td>{event.batchName || '--'}</td>
                <td>{formatEventQuantity(event)}</td>
                <td>{sourceName(event)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function AuditTable({auditRows}) {
  return (
    <div className="production-table-wrap">
      <table className="production-table production-audit-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Program</th>
            <th>Batch</th>
            <th>Count</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {auditRows.length === 0 ? (
            <tr>
              <td colSpan="5" className="production-empty-cell">
                No records
              </td>
            </tr>
          ) : (
            auditRows.map((row, index) => {
              const event = row.legacyEvent;
              return (
                <tr key={`${event.id}:${row.status}:${index}`} title={row.reason}>
                  <td>{formatDate(event.date)}</td>
                  <td>{PROGRAM_BY_KEY[event.program]?.label || event.program}</td>
                  <td>{event.batchName || '--'}</td>
                  <td>{formatEventQuantity(event)}</td>
                  <td>
                    <span className={`badge-soft ${auditClass(row.status)}`}>{auditLabel(row.status)}</span>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function ProductionPage({Header, setView}) {
  const currentYear = String(new Date().getFullYear());
  const [sources, setSources] = React.useState(null);
  const [selectedYear, setSelectedYear] = React.useState(currentYear);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await loadProductionSources(sb);
      setSources(loaded);
    } catch (error) {
      setSources(null);
      setLoadError({
        kind: 'error',
        message:
          'Could not load production data. Please refresh the page. (' + ((error && error.message) || error) + ')',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const model = React.useMemo(() => buildProductionModel(sources || {}), [sources]);
  const years = React.useMemo(() => {
    const all = new Set(model.years);
    all.add(currentYear);
    return [...all].sort();
  }, [model.years, currentYear]);
  const selectedTotals = totalsForYear(model.events, selectedYear);
  const processingEvents = model.events.filter((event) => event.year === selectedYear && event.program !== 'egg');
  const eggEvents = model.events.filter((event) => event.year === selectedYear && event.program === 'egg');
  const auditRows = model.audit.filter((row) => row.legacyEvent.year === selectedYear);

  return (
    <div className="home theme-crisp production-page" data-production-loaded={loading ? 'false' : 'true'}>
      <Header />
      <main className="home-col production-col">
        <div className="production-topline">
          <button type="button" className="btn-clear" onClick={() => setView('home')}>
            Back to Home
          </button>
          <span>{loading ? 'Loading' : `${model.events.length.toLocaleString()} events`}</span>
        </div>

        <section className="production-title">
          <div>
            <h1>Production</h1>
          </div>
          <label className="production-year-picker">
            <span>Year</span>
            <select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)}>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </section>

        <InlineNotice notice={loadError} onDismiss={() => setLoadError(null)} />

        <section className="card stats production-year-card">
          <div className="stats-head">
            <div className="card-label">Production - {selectedYear}</div>
            <button type="button" className="btn-clear" data-production-retry="1" onClick={load} disabled={loading}>
              {loadError ? 'Retry' : 'Refresh'}
            </button>
          </div>
          <div className="stat-row" data-home-grid="production">
            {['broiler', 'egg', 'pig', 'cattle', 'sheep'].map((programKey) => (
              <div className="stat" key={programKey}>
                <div className="stat-n">
                  {selectedTotals.has(programKey)
                    ? formatProductionNumber(programKey, selectedTotals.get(programKey))
                    : '--'}
                </div>
                <div className="stat-l">
                  <span className={`sdot sdot-${programKey === 'egg' ? 'layer' : programKey}`} />
                  {PROGRAM_BY_KEY[programKey].label.replace('/doz', '')}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card production-totals-card">
          <div className="stats-head">
            <div className="card-label">Program Totals</div>
          </div>
          <div className="production-program-grid">
            {PAGE_PRODUCTION_PROGRAMS.map((programKey) => (
              <ProgramTotalsTable key={programKey} programKey={programKey} rows={model.programRows[programKey] || []} />
            ))}
          </div>
        </section>

        <details className="card production-details">
          <summary>
            <span className="card-label">Processing Events</span>
            <span className="count-pill count-warn">{processingEvents.length}</span>
            <Chevron className="go" />
          </summary>
          <EventsTable events={processingEvents} />
        </details>

        <details className="card production-details">
          <summary>
            <span className="card-label">Egg Events</span>
            <span className="count-pill count-warn">{eggEvents.length}</span>
            <Chevron className="go" />
          </summary>
          <EventsTable events={eggEvents} />
        </details>

        <details className="card production-details">
          <summary>
            <span className="card-label">Legacy / Audit Review</span>
            <span className="count-pill count-warn">{auditRows.length}</span>
            <Chevron className="go" />
          </summary>
          <AuditTable auditRows={auditRows} />
        </details>
      </main>
    </div>
  );
}
