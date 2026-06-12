/**
 * Pedestrian grid-walk distance with a penalty when the path would cross railroad lines.
 * Uses OpenStreetMap rail polylines from `data/railways.json`.
 */

import { gridWalkMiles } from "./data-loader.mjs";

/** Default detour when a walk segment crosses rail (see `config.json` → `railWalkBarrier`). */
export const FALLBACK_RAIL_CROSSING_EXTRA_MILES = 0.35;

/** @typedef {{ latitude: number; longitude: number }} LatLng */

/**
 * @param {unknown} v
 * @returns {number | null}
 */
function finiteNum(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * @param {unknown} doc — `data/railways.json`
 * @returns {Array<Array<[number, number]>>} segment list as `[lng, lat]` pairs
 */
export function parseRailwaySegments(doc) {
  const lines = doc != null && typeof doc === "object" ? doc.lines : null;
  if (!Array.isArray(lines)) return [];
  /** @type {Array<Array<[number, number]>>} */
  const segs = [];
  for (const line of lines) {
    const coords = line?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      const lat1 = finiteNum(a?.latitude);
      const lng1 = finiteNum(a?.longitude);
      const lat2 = finiteNum(b?.latitude);
      const lng2 = finiteNum(b?.longitude);
      if (lat1 == null || lng1 == null || lat2 == null || lng2 == null)
        continue;
      segs.push([
        [lng1, lat1],
        [lng2, lat2],
      ]);
    }
  }
  return segs;
}

/**
 * @param {[number, number]} a — `[lng, lat]`
 * @param {[number, number]} b
 * @param {[number, number]} c
 * @param {[number, number]} d
 */
function segmentsIntersectLngLat(a, b, c, d) {
  const orient = (px, py, qx, qy, rx, ry) =>
    (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const onSeg = (px, py, qx, qy, rx, ry) =>
    Math.min(px, qx) <= rx &&
    rx <= Math.max(px, qx) &&
    Math.min(py, qy) <= ry &&
    ry <= Math.max(py, qy);

  const o1 = orient(...a, ...b, ...c);
  const o2 = orient(...a, ...b, ...d);
  const o3 = orient(...c, ...d, ...a);
  const o4 = orient(...c, ...d, ...b);

  if (o1 === 0 && onSeg(...a, ...b, ...c)) return true;
  if (o2 === 0 && onSeg(...a, ...b, ...d)) return true;
  if (o3 === 0 && onSeg(...c, ...d, ...a)) return true;
  if (o4 === 0 && onSeg(...c, ...d, ...b)) return true;

  return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0;
}

/**
 * Whether any segment of the walk path intersects a railroad line.
 * Checks the direct chord plus both L-shaped grid-walk routes (N–S then E–W / E–W then N–S).
 *
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @param {Array<Array<[number, number]>>} railSegments
 */
export function walkPathCrossesRailSegments(
  lat1,
  lng1,
  lat2,
  lng2,
  railSegments,
) {
  if (!Array.isArray(railSegments) || railSegments.length === 0) return false;

  /** @type {Array<[[number, number], [number, number]]>} */
  const walkSegs = [
    [
      [lng1, lat1],
      [lng2, lat2],
    ],
    [
      [lng1, lat1],
      [lng2, lat1],
    ],
    [
      [lng2, lat1],
      [lng2, lat2],
    ],
    [
      [lng1, lat1],
      [lng1, lat2],
    ],
    [
      [lng1, lat2],
      [lng2, lat2],
    ],
  ];

  for (const [a, b] of walkSegs) {
    for (const [c, d] of railSegments) {
      if (segmentsIntersectLngLat(a, b, c, d)) return true;
    }
  }
  return false;
}

/**
 * @param {unknown} configObj — `appData.railWalkBarrier`
 */
export function resolveRailWalkBarrier(configObj) {
  const o = configObj != null && typeof configObj === "object" ? configObj : {};
  const extra = /** @type {{ extraMilesWhenCrossing?: unknown }} */ (o)
    .extraMilesWhenCrossing;
  return {
    extraMilesWhenCrossing:
      typeof extra === "number" && Number.isFinite(extra) && extra >= 0
        ? extra
        : FALLBACK_RAIL_CROSSING_EXTRA_MILES,
  };
}

/**
 * Grid-walk miles, plus a configured detour when the path would cross railroad tracks.
 *
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @param {{
 *   railways?: unknown;
 *   railWalkBarrier?: unknown;
 *   railSegments?: Array<Array<[number, number]>>;
 * }} [opts]
 */
export function gridWalkMilesForPedestrians(lat1, lng1, lat2, lng2, opts = {}) {
  const base = gridWalkMiles(lat1, lng1, lat2, lng2);
  const segs =
    opts.railSegments ??
    parseRailwaySegments(
      opts.railways != null ? opts.railways : /** @type {unknown} */ (null),
    );
  if (segs.length === 0) return base;
  if (!walkPathCrossesRailSegments(lat1, lng1, lat2, lng2, segs)) return base;
  const { extraMilesWhenCrossing } = resolveRailWalkBarrier(
    opts.railWalkBarrier,
  );
  return base + extraMilesWhenCrossing;
}
