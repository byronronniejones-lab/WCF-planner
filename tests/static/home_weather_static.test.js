import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';
import {officialRadarUrl, weatherIcon, weatherLabel} from '../../src/lib/weather.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const weatherLib = fs.readFileSync(path.join(ROOT, 'src/lib/weather.js'), 'utf8');
const cardSrc = fs.readFileSync(path.join(ROOT, 'src/weather/HomeWeatherCard.jsx'), 'utf8');
const dashSrc = fs.readFileSync(path.join(ROOT, 'src/dashboard/HomeDashboard.jsx'), 'utf8');
const forecastFn = fs.readFileSync(path.join(ROOT, 'netlify/functions/weather-forecast.js'), 'utf8');
const radarFramesPath = path.join(ROOT, 'netlify/functions/weather-radar-frames.js');
const tileFnPath = path.join(ROOT, 'netlify/functions/weather-tile.js');

describe('weather helper (src/lib/weather.js)', () => {
  it('exports the structured weather helpers only', () => {
    expect(weatherLib).toContain('export async function loadForecast');
    expect(weatherLib).toContain('export function officialRadarUrl');
    expect(weatherLib).toContain('export function weatherIcon');
    expect(weatherLib).toContain('export function weatherLabel');
    expect(weatherLib).not.toContain('loadRadarFrames');
    expect(weatherLib).not.toContain('rainviewerTileUrl');
    expect(weatherLib).not.toContain('latLonToTile');
  });

  it('does not reference RainViewer, OSM tiles, Tomorrow.io, or old tile functions', () => {
    expect(weatherLib).not.toMatch(/RainViewer|rainviewer|openstreetmap|api\.tomorrow\.io|weather-tile/);
    expect(cardSrc).not.toMatch(/RainViewer|rainviewer|openstreetmap|api\.tomorrow\.io|weather-tile/);
  });
});

describe('weather helper functions', () => {
  it('weatherIcon returns an emoji for known codes', () => {
    expect(weatherIcon(1000)).toBe('☀️');
    expect(weatherIcon(4001)).toBe('🌧️');
    expect(weatherIcon(8000)).toBe('⛈️');
  });

  it('weatherLabel returns descriptive text', () => {
    expect(weatherLabel(1000)).toBe('Clear');
    expect(weatherLabel(4001)).toBe('Rain');
    expect(weatherLabel(8000)).toBe('Thunderstorm');
  });

  it('officialRadarUrl points to NWS radar', () => {
    expect(officialRadarUrl({radarUrl: 'https://radar.weather.gov/'})).toBe('https://radar.weather.gov/');
    expect(officialRadarUrl(null)).toBe('https://radar.weather.gov/');
  });
});

describe('weather forecast proxy', () => {
  it('uses Open-Meteo GFS/HRRR plus NWS alerts without a Tomorrow.io key gate', () => {
    expect(forecastFn).toContain('api.open-meteo.com/v1/gfs');
    expect(forecastFn).toContain('fetchNwsAlerts');
    expect(forecastFn).toContain('alerts/active?point=');
    expect(forecastFn).toContain('Open-Meteo GFS/HRRR');
    expect(forecastFn).toContain('National Weather Service');
    expect(forecastFn).not.toContain('TOMORROW_IO_API_KEY');
    expect(forecastFn).not.toContain('api.tomorrow.io');
  });

  it('returns structured rain windows and no generated rain summary prose', () => {
    expect(forecastFn).toContain('buildRainWindows');
    expect(forecastFn).toContain('next6h');
    expect(forecastFn).toContain('next24h');
    expect(forecastFn).toContain('next48h');
    expect(forecastFn).not.toContain('rainSummary');
  });

  it('does not contain banned vague rain copy', () => {
    for (const banned of [
      'Showers possible overnight',
      'Showers likely overnight',
      'Rain chance present, timing unclear',
      'Low hourly rain signal today',
      'Rain timing uncertain',
      'Rain likely this evening',
      'Rain possible',
    ]) {
      expect(forecastFn).not.toContain(banned);
      expect(cardSrc).not.toContain(banned);
    }
  });
});

describe('HomeWeatherCard component', () => {
  it('imports from weather.js helper', () => {
    expect(cardSrc).toContain("from '../lib/weather.js'");
  });

  it('has collapsed and expanded states using a real button for the collapsed card', () => {
    expect(cardSrc).toContain('data-weather-card="collapsed"');
    expect(cardSrc).toContain('data-weather-card="expanded"');
    expect(cardSrc).toContain('className="card weather-card lift"');
    expect(cardSrc).toMatch(/<button[\s\S]*data-weather-card="collapsed"/);
  });

  it('does not render a narrative rain summary field', () => {
    expect(cardSrc).not.toContain('rainSummary');
    expect(cardSrc).toContain('data-weather-rain-structured="1"');
    expect(cardSrc).toContain('<RainRow label="Next 6h"');
    expect(cardSrc).toContain('6h rain');
  });

  it('shows source metadata, NWS alerts, structured work values, and official radar link', () => {
    expect(cardSrc).toContain('NWS Alerts');
    expect(cardSrc).toContain('Open NWS Radar');
    expect(cardSrc).toContain('officialRadarUrl');
    expect(cardSrc).toContain('Dry block');
    expect(cardSrc).toContain('Updated');
  });

  it('soft-fails hidden when no forecast data', () => {
    expect(cardSrc).toMatch(/if \(!forecast\) return null/);
  });
});

describe('Radar contract', () => {
  it('deletes weak in-app radar endpoints and keeps only an official radar link', () => {
    expect(fs.existsSync(tileFnPath)).toBe(false);
    expect(fs.existsSync(radarFramesPath)).toBe(false);
    expect(weatherLib).toContain('https://radar.weather.gov/');
    expect(cardSrc).toContain('Open NWS Radar');
  });
});

describe('HomeDashboard integration', () => {
  it('imports HomeWeatherCard', () => {
    expect(dashSrc).toContain('HomeWeatherCard');
    expect(dashSrc).toContain("from '../weather/HomeWeatherCard.jsx'");
  });
});
