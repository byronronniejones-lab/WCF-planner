import React from 'react';
import {loadForecast, officialRadarUrl, weatherIcon, weatherLabel} from '../lib/weather.js';

function round(value) {
  return value == null ? '--' : Math.round(value).toLocaleString();
}

function percent(value) {
  return value == null ? '--' : `${Math.round(value)}%`;
}

function inches(value) {
  if (value == null) return '--';
  if (value === 0) return '0"';
  return `${Math.round(value * 100) / 100}"`;
}

function fmtDay(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T12:00:00`);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[d.getDay()];
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const h = d.getHours();
  const suffix = h >= 12 ? 'p' : 'a';
  return `${h % 12 || 12}${suffix}`;
}

function fmtStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
}

function fmtRange(start, end) {
  if (!start || !end) return '--';
  if (start === end) return fmtTime(start);
  return `${fmtTime(start)}-${fmtTime(end)}`;
}

function WeatherMetric({label, value}) {
  return (
    <div className="wx-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RainRow({label, window}) {
  return (
    <div className="wx-rain-row">
      <span>{label}</span>
      <strong>{percent(window?.maxProb)}</strong>
      <span>{fmtRange(window?.startTime, window?.endTime)}</span>
      <span>{inches(window?.precipAmount)}</span>
      <span className={`wx-confidence wx-confidence-${window?.confidence || 'none'}`}>
        {(window?.confidence || 'none').toUpperCase()}
      </span>
    </div>
  );
}

export default function HomeWeatherCard() {
  const [forecast, setForecast] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [expanded, setExpanded] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);

  const load = React.useCallback(async (force) => {
    try {
      const data = await loadForecast({force});
      setForecast(data);
    } catch (_e) {
      /* soft-fail */
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load(true);
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }

  if (loading) return null;
  if (!forecast) return null;

  const {current, today, rainWindows, dryWindow, freezeWarning, daily, alerts = [], sources = {}} = forecast;
  if (!current || !today) return null;

  const alertCount = alerts.length;
  const gust = current.windGust != null ? current.windGust : today.windGustMax;
  const radarUrl = officialRadarUrl(forecast);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        data-weather-card="collapsed"
        className="card weather-card lift"
        style={{width: '100%', textAlign: 'left', color: 'inherit', flexWrap: 'wrap'}}
      >
        <span className="wx-ic" aria-hidden="true">
          {weatherIcon(current.weatherCode)}
        </span>
        <span className="wx-temp">{round(current.temp)}°</span>
        <span className="wx-hilo">
          H:{round(today.high)}° L:{round(today.low)}°
        </span>
        <span className="wx-chip">
          Wind {round(current.windSpeed)}/{round(gust)}
        </span>
        <span className="wx-chip">6h rain {percent(rainWindows?.next6h?.maxProb)}</span>
        {alertCount > 0 && (
          <span className="wx-alert-chip">
            {alertCount} NWS alert{alertCount === 1 ? '' : 's'}
          </span>
        )}
        {freezeWarning && <span className="wx-freeze-chip">Freeze {round(freezeWarning.temp)}°</span>}
        <svg
          className="go"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>

      {expanded && (
        <div
          data-weather-card="expanded"
          className="wx-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setExpanded(false);
          }}
        >
          <div className="wx-modal">
            <div className="wx-modal-head">
              <div>
                <div className="wx-modal-title">
                  <span aria-hidden="true">{weatherIcon(current.weatherCode)}</span>
                  <span>{round(current.temp)}°F</span>
                  <span className="wx-modal-condition">{weatherLabel(current.weatherCode)}</span>
                </div>
                <div className="wx-source-line">
                  Updated {fmtStamp(forecast.fetchedAt)} · {sources.forecast || 'Open-Meteo'} ·{' '}
                  {sources.alerts || 'NWS'}
                </div>
              </div>
              <div className="wx-modal-actions">
                <button type="button" className="btn-clear" onClick={handleRefresh} disabled={refreshing}>
                  {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
                <button
                  type="button"
                  className="btn-clear"
                  aria-label="Close weather"
                  onClick={() => setExpanded(false)}
                >
                  ×
                </button>
              </div>
            </div>

            <div className="wx-panel-grid">
              <section className="wx-panel">
                <h2>Now</h2>
                <div className="wx-metric-grid">
                  <WeatherMetric label="Feels" value={`${round(current.feelsLike)}°`} />
                  <WeatherMetric label="Humidity" value={percent(current.humidity)} />
                  <WeatherMetric label="Wind" value={`${round(current.windSpeed)} mph`} />
                  <WeatherMetric label="Gust" value={`${round(gust)} mph`} />
                </div>
              </section>

              <section className="wx-panel" data-weather-rain-structured="1">
                <h2>Rain</h2>
                <div className="wx-rain-head">
                  <span>Window</span>
                  <span>Max</span>
                  <span>Time</span>
                  <span>Amt</span>
                  <span>Conf</span>
                </div>
                <RainRow label="Next 6h" window={rainWindows?.next6h} />
                <RainRow label="Next 24h" window={rainWindows?.next24h} />
                <RainRow label="Next 48h" window={rainWindows?.next48h} />
              </section>

              <section className="wx-panel">
                <h2>Work</h2>
                <div className="wx-metric-grid">
                  <WeatherMetric label="Dry block" value={dryWindow?.hours ? `${dryWindow.hours}h` : '--'} />
                  <WeatherMetric label="Dry time" value={fmtRange(dryWindow?.startTime, dryWindow?.endTime)} />
                  <WeatherMetric label="Today rain" value={percent(today.precipProb)} />
                  <WeatherMetric label="Today amt" value={inches(today.precipAmount)} />
                </div>
              </section>

              <section className="wx-panel">
                <h2>NWS Alerts</h2>
                {alertCount === 0 ? (
                  <div className="wx-empty">None active</div>
                ) : (
                  <div className="wx-alert-list">
                    {alerts.slice(0, 3).map((alert) => (
                      <div className="wx-alert-row" key={alert.id || alert.headline}>
                        <strong>{alert.event}</strong>
                        <span>{alert.severity || 'Alert'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <section className="wx-panel wx-radar-panel">
              <div>
                <h2>Radar</h2>
                <div className="wx-source-line">{sources.radar || 'National Weather Service'}</div>
              </div>
              <a className="btn-clear wx-radar-link" href={radarUrl} target="_blank" rel="noreferrer">
                Open NWS Radar
              </a>
            </section>

            <section className="wx-panel">
              <h2>10-Day</h2>
              <div className="wx-daily-list">
                {(daily || []).map((d, i) => (
                  <div className="wx-daily-row" key={d.date}>
                    <span>{i === 0 ? 'Today' : fmtDay(d.date)}</span>
                    <span aria-hidden="true">{weatherIcon(d.weatherCodeMax)}</span>
                    <strong>
                      {round(d.tempMax)}°/{round(d.tempMin)}°
                    </strong>
                    <span>{percent(d.precipProbMax)}</span>
                    <span>{round(d.windGustMax)} mph</span>
                    {d.tempMin != null && d.tempMin <= 33 ? <em>Freeze</em> : <em />}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
