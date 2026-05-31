import { test, expect } from "@playwright/test";
import {
  compareParkingWalkVersusDashMinutes,
  resolveParkingRoutePace,
  FALLBACK_PARKING_WALK_MINUTES_PER_MILE,
  FALLBACK_PARKING_DASH_MILES_PER_HOUR,
  FALLBACK_PARKING_DASH_BOARDING_WAIT_MINUTES,
  FALLBACK_PARKING_DRIVE_MILES_PER_HOUR,
} from "../src/visit/route-planning.mjs";

test.describe("Parking route planning", () => {
  test("defaults match ~2.5 mph walk, 12 mph DASH, boarding wait, and 25 mph drive", () => {
    const pace = resolveParkingRoutePace({});
    expect(pace.walkMinutesPerMile).toBe(
      FALLBACK_PARKING_WALK_MINUTES_PER_MILE,
    );
    expect(pace.dashMilesPerHour).toBe(FALLBACK_PARKING_DASH_MILES_PER_HOUR);
    expect(pace.dashBoardingWaitMinutes).toBe(
      FALLBACK_PARKING_DASH_BOARDING_WAIT_MINUTES,
    );
    expect(pace.driveMilesPerHour).toBe(FALLBACK_PARKING_DRIVE_MILES_PER_HOUR);
  });

  test("prefers walking direct when it takes less time than park + DASH + walk", () => {
    // Same geometry as Market/Weston stop → Van Andel (GTFS loop): shuttle arc dominates.
    const r = compareParkingWalkVersusDashMinutes({
      directMi: 0.236722611668108,
      w1: 0,
      w2: 0.09723222161504061,
      shuttleMi: 0.7379129479103455,
      walkMinutesPerMile: 20,
      dashMilesPerHour: 12,
      dashBoardingWaitMinutes: 0,
    });
    expect(r.tDashMin).toBeGreaterThan(r.tDirectMin);
    expect(r.useDashOverlay).toBe(false);
  });

  test("prefers DASH overlay when total shuttle trip is faster than walking direct", () => {
    // Same geometry as NW Bridge area parking → Van Andel.
    const r = compareParkingWalkVersusDashMinutes({
      directMi: 0.6537390992008514,
      w1: 0.0003657598373491911,
      w2: 0.09723222161504061,
      shuttleMi: 0.8459853328570723,
      walkMinutesPerMile: 20,
      dashMilesPerHour: 12,
      dashBoardingWaitMinutes: 0,
    });
    expect(r.tDashMin).toBeLessThan(r.tDirectMin);
    expect(r.useDashOverlay).toBe(true);
  });

  test("ties go to walking direct (no DASH overlay)", () => {
    const r = compareParkingWalkVersusDashMinutes({
      directMi: 1,
      w1: 0,
      w2: 0,
      shuttleMi: 4,
      walkMinutesPerMile: 20,
      dashMilesPerHour: 12,
      dashBoardingWaitMinutes: 0,
    });
    expect(r.tDirectMin).toBe(20);
    expect(r.tDashMin).toBe(20);
    expect(r.useDashOverlay).toBe(false);
  });

  test("default boarding wait is included in DASH total time", () => {
    const r = compareParkingWalkVersusDashMinutes({
      directMi: 1,
      w1: 0,
      w2: 0,
      shuttleMi: 4,
      walkMinutesPerMile: 20,
      dashMilesPerHour: 12,
    });
    expect(r.tDirectMin).toBe(20);
    expect(r.tDashMin).toBe(20 + FALLBACK_PARKING_DASH_BOARDING_WAIT_MINUTES);
    expect(r.useDashOverlay).toBe(false);
  });

  test("reads optional pace overrides", () => {
    const pace = resolveParkingRoutePace({
      walkMinutesPerMile: 18,
      dashMilesPerHour: 10,
      dashBoardingWaitMinutes: 3,
      driveMilesPerHour: 30,
    });
    expect(pace.walkMinutesPerMile).toBe(18);
    expect(pace.dashMilesPerHour).toBe(10);
    expect(pace.dashBoardingWaitMinutes).toBe(3);
    expect(pace.driveMilesPerHour).toBe(30);

    const r = compareParkingWalkVersusDashMinutes({
      directMi: 1,
      w1: 0.2,
      w2: 0.2,
      shuttleMi: 0.5,
      walkMinutesPerMile: 18,
      dashMilesPerHour: 10,
      dashBoardingWaitMinutes: 0,
    });
    expect(r.tDirectMin).toBe(18);
    expect(r.tDashMin).toBeCloseTo(0.2 * 18 + 0.5 * 6 + 0.2 * 18, 5);
  });
});
