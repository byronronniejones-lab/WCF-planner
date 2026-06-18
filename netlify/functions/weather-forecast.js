// Netlify Function: weather forecast proxy.
// Open-Meteo GFS/HRRR supplies structured current/hourly/daily fields.
// NWS supplies official active alerts. No generated rain commentary is returned.

const DEFAULT_LAT = '30.833938';
const DEFAULT_LON = '-86.430030';
const DEFAULT_LABEL = 'WCF';
const TIMEZONE = 'America/Chicago';
const NWS_UA = 'WCF Planner weather (https://github.com/byronronniejones-lab/WCF-planner)';

export async function handler() {
  const lat = process.env.WCF_WEATHER_LAT || DEFAULT_LAT;
  const lon = process.env.WCF_WEATHER_LON || DEFAULT_LON;
  const label = process.env.WCF_WEATHER_LABEL || DEFAULT_LABEL;
  const loc = {lat: parseFloat(lat), lon: parseFloat(lon), label};

  try {
    const [openMeteo, nwsAlerts] = await Promise.all([fetchOpenMeteoForecast(lat, lon), fetchNwsAlerts(lat, lon)]);

    if (!openMeteo) {
      return {statusCode: 502, body: JSON.stringify({error: 'upstream_error', message: 'Forecast provider error'})};
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=900, s-maxage=900',
      },
      body: JSON.stringify(normalize(openMeteo, nwsAlerts, loc)),
    };
  } catch (e) {
    console.error('weather-forecast error:', e);
    return {statusCode: 500, body: JSON.stringify({error: 'internal', message: 'Weather fetch failed'})};
  }
}

async function fetchOpenMeteoForecast(lat, lon) {
  try {
    const hourly = [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'precipitation_probability',
      'precipitation',
      'weather_code',
      'wind_speed_10m',
      'wind_gusts_10m',
    ].join(',');
    const daily = [
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_probability_max',
      'precipitation_sum',
      'weather_code',
      'wind_speed_10m_max',
      'wind_gusts_10m_max',
    ].join(',');
    const current = [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'weather_code',
      'wind_speed_10m',
      'wind_gusts_10m',
    ].join(',');
    const url =
      `https://api.open-meteo.com/v1/gfs?latitude=${lat}&longitude=${lon}` +
      `&current=${current}&hourly=${hourly}&daily=${daily}` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
      `&timezone=${encodeURIComponent(TIMEZONE)}&forecast_days=10`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error('Open-Meteo GFS error:', res.status, await res.text());
      return null;
    }
    return res.json();
  } catch (e) {
    console.error('Open-Meteo GFS fetch error:', e);
    return null;
  }
}

async function fetchNwsAlerts(lat, lon) {
  try {
    const url = `https://api.weather.gov/alerts/active?point=${encodeURIComponent(`${lat},${lon}`)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': NWS_UA,
        Accept: 'application/geo+json',
      },
    });
    if (!res.ok) return [];
    const raw = await res.json();
    return (raw.features || []).slice(0, 6).map((feature) => {
      const p = feature.properties || {};
      return {
        id: p.id || feature.id || '',
        event: p.event || 'Weather Alert',
        severity: p.severity || '',
        urgency: p.urgency || '',
        certainty: p.certainty || '',
        headline: p.headline || p.event || 'Weather Alert',
        effective: p.effective || null,
        expires: p.expires || null,
        instruction: p.instruction || '',
      };
    });
  } catch (e) {
    console.error('NWS alerts fetch error:', e);
    return [];
  }
}

function normalize(raw, alerts, loc) {
  const h = raw.hourly || {};
  const hourly = (h.time || []).slice(0, 48).map((time, i) => ({
    time,
    temp: round1(h.temperature_2m?.[i]),
    humidity: round1(h.relative_humidity_2m?.[i]),
    feelsLike: round1(h.apparent_temperature?.[i]),
    precipProb: round1(h.precipitation_probability?.[i]),
    precipAmount: round2(h.precipitation?.[i]),
    windSpeed: round1(h.wind_speed_10m?.[i]),
    windGust: round1(h.wind_gusts_10m?.[i]),
    weatherCode: mapWmoToTomorrow(h.weather_code?.[i]),
  }));

  const d = raw.daily || {};
  const daily = (d.time || []).map((date, i) => ({
    date,
    tempMax: round1(d.temperature_2m_max?.[i]),
    tempMin: round1(d.temperature_2m_min?.[i]),
    precipProbMax: round1(d.precipitation_probability_max?.[i]),
    precipAmount: round2(d.precipitation_sum?.[i]),
    weatherCodeMax: mapWmoToTomorrow(d.weather_code?.[i]),
    windSpeedMax: round1(d.wind_speed_10m_max?.[i]),
    windGustMax: round1(d.wind_gusts_10m_max?.[i]),
  }));

  const c = raw.current || {};
  const firstHour = hourly[0] || null;
  const nowMs = Date.parse(c.time ? `${c.time}:00` : firstHour?.time || Date.now());
  const rainWindows = buildRainWindows(hourly, Number.isFinite(nowMs) ? nowMs : Date.now());
  const freezeWarning = buildFreezeWarning(daily);

  return {
    location: loc,
    current: {
      temp: round1(c.temperature_2m) ?? firstHour?.temp ?? null,
      feelsLike: round1(c.apparent_temperature) ?? firstHour?.feelsLike ?? null,
      humidity: round1(c.relative_humidity_2m) ?? firstHour?.humidity ?? null,
      windSpeed: round1(c.wind_speed_10m) ?? firstHour?.windSpeed ?? null,
      windGust: round1(c.wind_gusts_10m) ?? firstHour?.windGust ?? null,
      weatherCode: mapWmoToTomorrow(c.weather_code) || firstHour?.weatherCode || 0,
      observedAt: c.time || firstHour?.time || null,
    },
    today: daily[0]
      ? {
          high: daily[0].tempMax,
          low: daily[0].tempMin,
          precipProb: daily[0].precipProbMax,
          precipAmount: daily[0].precipAmount,
          windSpeedMax: daily[0].windSpeedMax,
          windGustMax: daily[0].windGustMax,
        }
      : null,
    rainWindows,
    dryWindow: buildDryWindow(hourly, Number.isFinite(nowMs) ? nowMs : Date.now()),
    freezeWarning,
    alerts,
    daily,
    dailySource: 'open-meteo-gfs',
    hourly,
    radarUrl: 'https://radar.weather.gov/',
    sources: {
      forecast: 'Open-Meteo GFS/HRRR',
      alerts: 'National Weather Service',
      radar: 'National Weather Service',
    },
    fetchedAt: new Date().toISOString(),
  };
}

export function buildRainWindows(hourly = [], nowMs = Date.now()) {
  return {
    next6h: summarizeRainWindow(hourly, nowMs, 6),
    next24h: summarizeRainWindow(hourly, nowMs, 24),
    next48h: summarizeRainWindow(hourly, nowMs, 48),
  };
}

function summarizeRainWindow(hourly, nowMs, hours) {
  const endMs = nowMs + hours * 3600 * 1000;
  const rows = hourly.filter((row) => {
    const t = Date.parse(row.time);
    return Number.isFinite(t) && t >= nowMs && t <= endMs;
  });
  const maxProb = rows.reduce((max, row) => Math.max(max, row.precipProb || 0), 0);
  const precipAmount = rows.reduce((sum, row) => sum + (row.precipAmount || 0), 0);
  const wetRows = rows.filter((row) => (row.precipProb || 0) >= 35 || (row.precipAmount || 0) >= 0.01);
  const firstWet = wetRows[0] || null;
  const lastWet = wetRows[wetRows.length - 1] || null;
  return {
    hours,
    maxProb: round1(maxProb),
    precipAmount: round2(precipAmount),
    startTime: firstWet?.time || null,
    endTime: lastWet?.time || null,
    confidence: confidenceFor(maxProb, precipAmount, wetRows.length),
  };
}

export function buildDryWindow(hourly = [], nowMs = Date.now()) {
  const rows = hourly.filter((row) => {
    const t = Date.parse(row.time);
    return Number.isFinite(t) && t >= nowMs && t <= nowMs + 24 * 3600 * 1000;
  });
  let best = [];
  let run = [];
  for (const row of rows) {
    const dry = (row.precipProb || 0) < 25 && (row.precipAmount || 0) < 0.01 && (row.windGust || 0) < 25;
    if (dry) {
      run.push(row);
      if (run.length > best.length) best = [...run];
    } else {
      run = [];
    }
  }
  return {
    startTime: best[0]?.time || null,
    endTime: best[best.length - 1]?.time || null,
    hours: best.length,
  };
}

function confidenceFor(maxProb, precipAmount, wetHourCount) {
  if (maxProb >= 70 || precipAmount >= 0.25) return 'high';
  if (maxProb >= 45 || precipAmount >= 0.05 || wetHourCount >= 3) return 'medium';
  if (maxProb >= 25 || precipAmount > 0) return 'low';
  return 'none';
}

function buildFreezeWarning(daily) {
  for (const d of daily.slice(0, 3)) {
    if (d.tempMin != null && d.tempMin <= 33) {
      return {
        date: d.date,
        temp: Math.round(d.tempMin),
      };
    }
  }
  return null;
}

// WMO weather codes (Open-Meteo) -> existing icon/label codes.
function mapWmoToTomorrow(wmo) {
  if (wmo == null) return 0;
  if (wmo === 0) return 1000;
  if (wmo <= 1) return 1100;
  if (wmo === 2) return 1101;
  if (wmo === 3) return 1001;
  if (wmo >= 45 && wmo <= 48) return 2000;
  if (wmo >= 51 && wmo <= 55) return 4000;
  if (wmo >= 56 && wmo <= 57) return 6000;
  if (wmo >= 61 && wmo <= 63) return 4001;
  if (wmo === 65) return 4201;
  if (wmo >= 66 && wmo <= 67) return 6001;
  if (wmo >= 71 && wmo <= 75) return 5000;
  if (wmo === 77) return 7000;
  if (wmo >= 80 && wmo <= 82) return 4001;
  if (wmo >= 85 && wmo <= 86) return 5100;
  if (wmo >= 95 && wmo <= 99) return 8000;
  return 1001;
}

function round1(v) {
  return v != null && Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : null;
}

function round2(v) {
  return v != null && Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null;
}
