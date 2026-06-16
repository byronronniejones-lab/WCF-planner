// ============================================================================
// src/lib/pastureGeometry.js  —  Pasture Map CP2
// ----------------------------------------------------------------------------
// Pure geometry helpers for the draw/edit/measure HUD and client-side
// validation. No Leaflet, no React, no network — safe to unit-test in node.
// turf provides spherical area + self-intersection (kinks); perimeter is a
// plain haversine over the ring so we don't pull in another turf module.
// ============================================================================
import {area as turfArea} from '@turf/area';
import {kinks as turfKinks} from '@turf/kinks';

export const SQM_PER_ACRE = 4046.8564224;

export function haversineM([lon1, lat1], [lon2, lat2]) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Perimeter (meters) of a coordinate ring. closed=true adds the closing segment
// when the ring isn't already closed (first !== last).
export function ringPerimeterM(ring, closed) {
  if (!Array.isArray(ring) || ring.length < 2) return 0;
  let m = 0;
  for (let i = 1; i < ring.length; i++) m += haversineM(ring[i - 1], ring[i]);
  if (closed && ring.length >= 3) {
    const f = ring[0];
    const l = ring[ring.length - 1];
    if (f[0] !== l[0] || f[1] !== l[1]) m += haversineM(l, f);
  }
  return m;
}

export function geometryAcres(geometry) {
  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return null;
  try {
    return Math.round((turfArea({type: 'Feature', geometry, properties: {}}) / SQM_PER_ACRE) * 100) / 100;
  } catch {
    return null;
  }
}

// Metrics for a finished polygon geometry: acres, perimeter (ft), and a client
// self-intersection flag. `valid` is false for non-rings or self-intersecting
// shapes — the create/update RPCs remain the authoritative backstop.
export function polygonMetrics(geometry) {
  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
    return {acres: null, perimeterFt: null, valid: false, selfIntersects: false};
  }
  const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0];
  let selfIntersects = false;
  try {
    const k = turfKinks({type: 'Feature', geometry, properties: {}});
    selfIntersects = !!(k && k.features && k.features.length > 0);
  } catch {
    selfIntersects = false;
  }
  return {
    acres: geometryAcres(geometry),
    perimeterFt: Math.round(ringPerimeterM(ring, true) * 3.28084),
    valid: !!ring && ring.length >= 4 && !selfIntersects,
    selfIntersects,
  };
}
