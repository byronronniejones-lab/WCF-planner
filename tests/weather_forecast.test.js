import {describe, expect, it} from 'vitest';
import {buildDryWindow, buildRainWindows} from '../netlify/functions/weather-forecast.js';

function hour(baseMs, offset, patch = {}) {
  return {
    time: new Date(baseMs + offset * 3600 * 1000).toISOString(),
    precipProb: 0,
    precipAmount: 0,
    windGust: 12,
    ...patch,
  };
}

describe('weather rain windows', () => {
  it('summarizes max probability, amount, timing, and confidence without prose', () => {
    const base = Date.parse('2026-06-18T12:00:00Z');
    const hourly = [
      hour(base, 0),
      hour(base, 1, {precipProb: 28}),
      hour(base, 2, {precipProb: 56, precipAmount: 0.03}),
      hour(base, 3, {precipProb: 72, precipAmount: 0.08}),
      hour(base, 4, {precipProb: 48, precipAmount: 0.02}),
      hour(base, 5),
      hour(base, 6),
    ];

    const windows = buildRainWindows(hourly, base);

    expect(windows.next6h).toMatchObject({
      hours: 6,
      maxProb: 72,
      precipAmount: 0.13,
      startTime: hourly[2].time,
      endTime: hourly[4].time,
      confidence: 'high',
    });
  });

  it('returns a structured dry work block when rain and gusts are low', () => {
    const base = Date.parse('2026-06-18T12:00:00Z');
    const hourly = [
      hour(base, 0, {precipProb: 60}),
      hour(base, 1),
      hour(base, 2),
      hour(base, 3),
      hour(base, 4, {windGust: 30}),
      hour(base, 5),
    ];

    const dry = buildDryWindow(hourly, base);

    expect(dry).toEqual({
      startTime: hourly[1].time,
      endTime: hourly[3].time,
      hours: 3,
    });
  });
});
