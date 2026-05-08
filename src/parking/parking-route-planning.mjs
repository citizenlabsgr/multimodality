/**
 * Parking map route overlay — walking pace vs DASH pace for comparing
 * straight-line walk to park + DASH + walk (same formulas as `#/parking` overlays).
 */

/** When `config.json` omits `parkingRoutePace` or a field is invalid. */
export const FALLBACK_PARKING_WALK_MINUTES_PER_MILE = 20;
export const FALLBACK_PARKING_DASH_MILES_PER_HOUR = 12;

/**
 * @param {unknown} configObj — `appData.parkingRoutePace` or subset
 * @returns {{ walkMinutesPerMile: number; dashMilesPerHour: number }}
 */
export function resolveParkingRoutePace(configObj) {
  const o = configObj != null && typeof configObj === "object" ? configObj : {};
  const w = /** @type {{ walkMinutesPerMile?: unknown }} */ (o)
    .walkMinutesPerMile;
  const d = /** @type {{ dashMilesPerHour?: unknown }} */ (o).dashMilesPerHour;
  return {
    walkMinutesPerMile:
      typeof w === "number" && Number.isFinite(w) && w > 0
        ? w
        : FALLBACK_PARKING_WALK_MINUTES_PER_MILE,
    dashMilesPerHour:
      typeof d === "number" && Number.isFinite(d) && d > 0
        ? d
        : FALLBACK_PARKING_DASH_MILES_PER_HOUR,
  };
}

/**
 * Compare straight-line walk-all-the-way vs walk + DASH shuttle + walk using the same
 * linear time model as the map overlay. When `useDashOverlay` is false, the UI shows
 * a single straight walk estimate instead.
 *
 * @param {{
 *   directMi: number;
 *   w1: number;
 *   w2: number;
 *   shuttleMi: number;
 *   walkMinutesPerMile?: number;
 *   dashMilesPerHour?: number;
 * }} args
 * @returns {{ tDirectMin: number; tDashMin: number; useDashOverlay: boolean }}
 */
export function compareParkingWalkVersusDashMinutes(args) {
  const pace = resolveParkingRoutePace({
    walkMinutesPerMile: args.walkMinutesPerMile,
    dashMilesPerHour: args.dashMilesPerHour,
  });
  const { walkMinutesPerMile, dashMilesPerHour } = pace;
  const { directMi, w1, w2, shuttleMi } = args;
  const tDirectMin = directMi * walkMinutesPerMile;
  const shuttleMinPerMi = 60 / dashMilesPerHour;
  const tDashMin =
    w1 * walkMinutesPerMile +
    shuttleMi * shuttleMinPerMi +
    w2 * walkMinutesPerMile;
  return {
    tDirectMin,
    tDashMin,
    useDashOverlay: tDashMin < tDirectMin - 1e-9,
  };
}
