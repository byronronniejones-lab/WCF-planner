// Unit tests for the pure CP2 geometry helpers (no Leaflet/DOM needed).
import {describe, it, expect} from 'vitest';
import {polygonMetrics, ringPerimeterM, geometryAcres, haversineM} from './pastureGeometry.js';

// ~1 km square near WCF (same fixture the migration smokes use).
const SQUARE = {
  type: 'Polygon',
  coordinates: [
    [
      [-86.44, 30.84],
      [-86.43, 30.84],
      [-86.43, 30.85],
      [-86.44, 30.85],
      [-86.44, 30.84],
    ],
  ],
};
const BOWTIE = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1],
      [0, 0],
    ],
  ],
};

describe('polygonMetrics', () => {
  it('reports acres, perimeter, and validity for a clean square', () => {
    const m = polygonMetrics(SQUARE);
    expect(m.acres).toBeGreaterThan(100);
    expect(m.acres).toBeLessThan(500);
    expect(m.perimeterFt).toBeGreaterThan(0);
    expect(m.valid).toBe(true);
    expect(m.selfIntersects).toBe(false);
  });

  it('flags a self-intersecting (bowtie) polygon as invalid', () => {
    const m = polygonMetrics(BOWTIE);
    expect(m.selfIntersects).toBe(true);
    expect(m.valid).toBe(false);
  });

  it('returns nulls for non-polygon geometry', () => {
    const m = polygonMetrics({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    });
    expect(m.acres).toBeNull();
    expect(m.valid).toBe(false);
  });
});

describe('geometryAcres', () => {
  it('is null for a line', () => {
    expect(
      geometryAcres({
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).toBeNull();
  });
});

describe('ringPerimeterM / haversineM', () => {
  it('haversine ~111 km for 1 degree of latitude', () => {
    const d = haversineM([0, 0], [0, 1]);
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });
  it('closed ring adds the closing segment', () => {
    const open = ringPerimeterM(
      [
        [0, 0],
        [0, 1],
        [1, 1],
      ],
      false,
    );
    const closed = ringPerimeterM(
      [
        [0, 0],
        [0, 1],
        [1, 1],
      ],
      true,
    );
    expect(closed).toBeGreaterThan(open);
  });
});
