/**
 * Parking map route overlay — walking pace vs DASH pace for comparing
 * straight-line walk to park + DASH + walk (same formulas as `#/visit` overlays).
 */

/** When `config.json` omits `parkingRoutePace` or a field is invalid. */
export const FALLBACK_PARKING_WALK_MINUTES_PER_MILE = 24;
export const FALLBACK_PARKING_DASH_MILES_PER_HOUR = 12;
/** Typical wait at the stop before the next DASH shuttle (`#/visit` multimodal time). */
export const FALLBACK_PARKING_DASH_BOARDING_WAIT_MINUTES = 5;
/** Urban driving pace for `#/visit` drive-step estimates from the user's location. */
export const FALLBACK_PARKING_DRIVE_MILES_PER_HOUR = 25;

/**
 * @param {unknown} configObj — `appData.parkingRoutePace` or subset
 * @returns {{ walkMinutesPerMile: number; dashMilesPerHour: number; dashBoardingWaitMinutes: number; driveMilesPerHour: number }}
 */
export function resolveParkingRoutePace(configObj) {
  const o = configObj != null && typeof configObj === "object" ? configObj : {};
  const w = /** @type {{ walkMinutesPerMile?: unknown }} */ (o)
    .walkMinutesPerMile;
  const d = /** @type {{ dashMilesPerHour?: unknown }} */ (o).dashMilesPerHour;
  const wait = /** @type {{ dashBoardingWaitMinutes?: unknown }} */ (o)
    .dashBoardingWaitMinutes;
  const drive = /** @type {{ driveMilesPerHour?: unknown }} */ (o)
    .driveMilesPerHour;
  return {
    walkMinutesPerMile:
      typeof w === "number" && Number.isFinite(w) && w > 0
        ? w
        : FALLBACK_PARKING_WALK_MINUTES_PER_MILE,
    dashMilesPerHour:
      typeof d === "number" && Number.isFinite(d) && d > 0
        ? d
        : FALLBACK_PARKING_DASH_MILES_PER_HOUR,
    dashBoardingWaitMinutes:
      typeof wait === "number" && Number.isFinite(wait) && wait >= 0
        ? wait
        : FALLBACK_PARKING_DASH_BOARDING_WAIT_MINUTES,
    driveMilesPerHour:
      typeof drive === "number" && Number.isFinite(drive) && drive > 0
        ? drive
        : FALLBACK_PARKING_DRIVE_MILES_PER_HOUR,
  };
}

/**
 * Compare grid-walk door-to-door vs walk + DASH shuttle + walk using the same
 * linear time model as `#/visit` (`directMi`, `w1`, `w2`: grid-walk miles, N–S + E–W).
 * `useDashOverlay` is true when DASH is strictly faster on that model — used for recommendation
 * sort; the parking map may still draw a multimodal path when both walk legs fit the user’s cap
 * even if this flag is false.
 *
 * @param {{
 *   directMi: number;
 *   w1: number;
 *   w2: number;
 *   shuttleMi: number;
 *   walkMinutesPerMile?: number;
 *   dashMilesPerHour?: number;
 *   dashBoardingWaitMinutes?: number;
 * }} args
 * @returns {{ tDirectMin: number; tDashMin: number; useDashOverlay: boolean }}
 */
export function compareParkingWalkVersusDashMinutes(args) {
  const pace = resolveParkingRoutePace({
    walkMinutesPerMile: args.walkMinutesPerMile,
    dashMilesPerHour: args.dashMilesPerHour,
    dashBoardingWaitMinutes: args.dashBoardingWaitMinutes,
  });
  const { walkMinutesPerMile, dashMilesPerHour, dashBoardingWaitMinutes } =
    pace;
  const { directMi, w1, w2, shuttleMi } = args;
  const tDirectMin = directMi * walkMinutesPerMile;
  const shuttleMinPerMi = 60 / dashMilesPerHour;
  const tDashMin =
    dashBoardingWaitMinutes +
    w1 * walkMinutesPerMile +
    shuttleMi * shuttleMinPerMi +
    w2 * walkMinutesPerMile;
  return {
    tDirectMin,
    tDashMin,
    useDashOverlay: tDashMin < tDirectMin - 1e-9,
  };
}
